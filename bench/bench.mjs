// Formula speed: the 2.0 engine vs BI's pre-2.0 path (expr-eval) vs
// hand-written JavaScript. 1M rows streamed one at a time, nothing held.
//
//   node --expose-gc bench/bench.mjs <case> [rows]
//   bench/run.sh                                   every case, 3 runs, medians
//
// The expr-eval cases need BI's report-engine checked out beside this repo
// (or BI_REPORT_ENGINE=/path/to/report-engine); without it they're skipped.
import { PerformanceObserver, performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const xf = createRequire(import.meta.url)(path.join(here, '..', 'index.js'))
const RE = process.env.BI_REPORT_ENGINE || path.join(here, '..', '..', '..', 'xeplr-suite', 'xeplr-bi', 'report-engine')
const haveBI = fs.existsSync(path.join(RE, 'index.js'))
const bi = haveBI ? {
  ...(await import(path.join(RE, 'index.js'))),
  ...(await import(path.join(RE, 'formulaFunctions.js'))),
  Parser: (await import(path.join(RE, 'node_modules/expr-eval/dist/index.mjs'))).Parser
} : null

const CASE = process.argv[2]
const N = Number(process.argv[3] || 1_000_000)

const CITIES = ['Pune', 'Delhi', 'Mumbai', 'Chennai', 'Kolkata', 'Jaipur', 'Surat', 'Indore', 'Bhopal', 'Nagpur']
function* rows(n) {
  for (let i = 0; i < n; i++) {
    const m = (i % 12) + 1
    yield {
      city: '  ' + CITIES[i % 10] + ' ',
      order_date: `2026-${String(m).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      revenue: (i * 37) % 1000,
      cost: (i * 13) % 400
    }
  }
}

const FORMULAS = [
  { alias: 'profit', expression: 'revenue - cost' },
  { alias: 'cityU', expression: 'upper(trim(city))' },
  { alias: 'band', expression: 'if(revenue > 500, "big", if(revenue > 100, "mid", "small"))' },
  { alias: 'mon', expression: 'monthname(order_date)' }
]
const F = xf.functions().reduce((m, f) => (f.fn && (m[f.name] = f.fn), m), {})
const num = (v) => { const n = Number(v); return Number.isNaN(n) ? null : n }
const HAND = [
  ['profit', (r) => num(r.revenue) - num(r.cost)],
  ['cityU', (r) => F.upper(F.trim(r.city))],
  ['band', (r) => (r.revenue > 500 ? 'big' : r.revenue > 100 ? 'mid' : 'small')],
  ['mon', (r) => F.monthname(r.order_date)]
]
const ENGINE = FORMULAS.map((f) => [f.alias, xf.compile(f.expression)])

function enrich(list) {
  return (n) => {
    let s = 0
    for (const r of rows(n)) {
      const e = { ...r }
      for (const [a, fn] of list) e[a] = fn(r)
      s += e.profit
    }
    return s
  }
}

const CASES = {
  // expr-eval as BI runs it today: enrichRow re-parses every formula per row.
  biToday: bi && ((n) => { let s = 0; for (const r of rows(n)) s += bi.enrichRow(r, FORMULAS).profit; return s }),
  // expr-eval parsed once.
  biParseOnce: bi && (() => {
    const p = bi.installFormulaFunctions(new bi.Parser({ operators: { assignment: false } }))
    const parsed = FORMULAS.map((f) => [f.alias, p.parse(f.expression)])
    return enrich(parsed.map(([a, e]) => [a, (r) => e.evaluate(bi.formulaScope(r))]))
  })(),
  // 2.0, compiled once.
  engine: enrich(ENGINE),
  // 2.0 called with TEXT on every row, as enrichRow does — the cache's job.
  engineText: enrich(FORMULAS.map((f) => [f.alias, (r) => xf.compile(f.expression)(r)])),
  // Hand-written JavaScript: the ceiling.
  hand: enrich(HAND),

  // The August example — revenue per city for August, and whether it's over 10K.
  augustBiToday: bi && ((n) => {
    const acc = bi.createPivotAccumulator({
      rowDimensions: ['city'], pivotColumn: null, grandTotal: false,
      valueColumns: [{ key: 'aug', aggregate: 'Sum' }, { key: 'flag', aggregate: 'Sum' }],
      formulas: [
        { alias: 'aug', expression: 'sumif(month(order_date) == 8, revenue)' },
        { alias: 'flag', expression: 'if(sumif(month(order_date) == 8, revenue) > 10000, 1, 0)' }
      ]
    })
    for (const r of rows(n)) acc.accumulate(r)
    const out = acc.finalize()
    return 'augTotal=' + out.reduce((t, o) => t + o.aug, 0) + ' citiesOver10k=' + out.reduce((t, o) => t + o.flag, 0)
  }),
  // The same with 2.0 compiling the condition and the value — the scoreboard
  // BI's accumulator keeps, fed by the new engine's closures.
  augustEngine: (() => {
    const cond = xf.compile('month(order_date) == 8')
    const value = xf.compile('revenue')
    const over = xf.compile('total > 10000')
    return (n) => {
      const board = new Map()
      for (const r of rows(n)) if (cond(r)) board.set(r.city, (board.get(r.city) || 0) + (Number(value(r)) || 0))
      const v = [...board.values()]
      return 'augTotal=' + v.reduce((t, x) => t + x, 0) + ' citiesOver10k=' + v.filter((x) => over({ total: x })).length
    }
  })(),
  augustHand: (n) => {
    const board = new Map()
    for (const r of rows(n)) if (F.month(r.order_date) === 8) board.set(r.city, (board.get(r.city) || 0) + num(r.revenue))
    const v = [...board.values()]
    return 'augTotal=' + v.reduce((t, x) => t + x, 0) + ' citiesOver10k=' + v.filter((x) => x > 10000).length
  }
}

if (!(CASE in CASES)) { console.error('cases: ' + Object.keys(CASES).join(' ')); process.exit(2) }
if (!CASES[CASE]) { console.log(JSON.stringify({ case: CASE, skipped: 'BI report-engine not found' })); process.exit(0) }

let gcMs = 0, gcCount = 0
new PerformanceObserver((l) => { for (const e of l.getEntries()) { gcMs += e.duration; gcCount++ } }).observe({ entryTypes: ['gc'] })
CASES[CASE](20000)                                     // JIT warm-up
global.gc(); gcMs = 0; gcCount = 0
const t0 = performance.now()
const result = CASES[CASE](N)
const ms = performance.now() - t0
await new Promise((r) => setTimeout(r, 50))
console.log(JSON.stringify({ case: CASE, rows: N, ms: Math.round(ms), rowsPerSec: Math.round(N / ms * 1000), gcCount, gcMs: Math.round(gcMs), peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024), result }))
