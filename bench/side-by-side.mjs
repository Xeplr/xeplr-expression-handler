// Same formula, same row: BI's pre-2.0 path (expr-eval) vs this engine.
// Every difference must have a known, agreed cause, or this exits 1.
//
//   node bench/side-by-side.mjs [extra-formulas.json]
//
// Formulas come from BI's own source and tests (and, optionally, a JSON array
// of saved formula texts — e.g. exported from report_dataset_formulas). Needs
// BI checked out beside this repo, or BI_ROOT=/path/to/xeplr-bi.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const BI = process.env.BI_ROOT || path.join(here, '..', '..', '..', 'xeplr-suite', 'xeplr-bi')
if (!fs.existsSync(path.join(BI, 'report-engine', 'index.js'))) { console.log('BI not found at ' + BI + ' — set BI_ROOT'); process.exit(0) }
const RE = path.join(BI, 'report-engine')
const { Parser } = await import(path.join(RE, 'node_modules/expr-eval/dist/index.mjs'))
const { installFormulaFunctions, formulaScope, AGGREGATE_FUNCTIONS } = await import(path.join(RE, 'formulaFunctions.js'))
const xf = createRequire(import.meta.url)(path.join(here, '..', 'index.js'))
const parser = installFormulaFunctions(new Parser({ operators: { assignment: false } }))

// ── the corpus: every formula written in BI's source and tests ──
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue; const p = path.join(d, e.name); e.isDirectory() ? walk(p) : /\.(m?js|jsx)$/.test(e.name) && files.push(p) } }
;['report-engine', 'ui/test', 'ui/src/reportBuilder', 'ui/src/shared', 'query-engine', 'backend'].forEach((d) => fs.existsSync(path.join(BI, d)) && walk(path.join(BI, d)))
const found = new Map()
const re = /\b(val|err|evaluateFormula|inspectFormula|kind|expression:|example:)\s*\(?\s*(['"`])((?:\\.|(?!\2).)+)\2/g
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8'); let m
  while ((m = re.exec(src))) { let s = m[3]; if (m[2] !== '`') s = s.replace(/\\(['"\\])/g, '$1'); else if (s.includes('${')) continue; if (!found.has(s)) found.set(s, path.relative(BI, f)) }
}
const corpus = [...found].map(([f, from]) => ({ f, from }))
if (process.argv[2]) JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).forEach((f) => corpus.push({ f, from: process.argv[2] }))

const base = {
  amount: 1.5, variance: -2, days: 3, area: 9, price: 5, cap: 9, floor_price: 1, rate: 1.1, years: 2, email: 'A@B', name: ' n ',
  first: 'a', last: 'b', code: 'abcdef', deptCode: 'INDIA', invoice: 'INV1234', phone: '1-2', notes: 'urgent now', sku: 'IN99',
  file: 'a.pdf', order_date: '2026-01-02', ordered: '2026-01-01', shipped: '2026-01-05', qty: 20, nickname: null, discount: null,
  closed_date: null, revenue: 100, cost: 40, city: '  Delhi  ', d: '2026-07-29', blank: null, zero: 0, a: 7, b: 2, c: 3, rev: 10,
  order_items_line_total: 250, orders_placed_at: '2026-03-15T10:30:00Z', status: 'paid', paid: true, customer_id: 1, date: '2026-01-01', service_id: 4
}
const ROWS = {
  normal: base,
  'numbers as text': Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])),
  nulls: Object.fromEntries(Object.keys(base).map((k) => [k, null])),
  'function-named columns': { ...base, month: 'x', year: 2024, left: 'a', round: 4 },
  'Date objects': { ...base, d: new Date(2026, 6, 29), order_date: new Date(2026, 0, 2), orders_placed_at: new Date(2026, 2, 15, 10, 30) }
}

const aggregate = (f) => [...AGGREGATE_FUNCTIONS].some((n) => new RegExp('\\b' + n + '\\s*\\(', 'i').test(f)) || f.includes('$thisrow')
const oldRun = (f, row) => { try { return { v: parser.parse(f).evaluate(formulaScope(row)) } } catch (e) { return { e: e.message } } }
const newRun = (f, row) => { try { return { v: xf.compile(f, { missing: 'error' })(row) } } catch (e) { return { e: e.message } } }
const same = (a, b) => (a.e && b.e) || (!a.e && !b.e && (Object.is(a.v, b.v) || (a.v instanceof Date && b.v instanceof Date && +a.v === +b.v) || JSON.stringify(a.v) === JSON.stringify(b.v)))
const show = (r) => r.e ? 'error: ' + r.e.slice(0, 60) : JSON.stringify(r.v)

let checked = 0, agree = 0, skipped = 0
const diffs = []
for (const { f, from } of corpus) {
  if (aggregate(f)) { skipped++; continue }
  for (const [rowName, row] of Object.entries(ROWS)) {
    checked++
    const o = oldRun(f, row), n = newRun(f, row)
    if (same(o, n)) agree++
    else diffs.push({ f, row: rowName, old: show(o), new: show(n), from })
  }
}
console.log(`formulas: ${corpus.length} (${skipped} are totals — compared in BI's own suites at the switch)`)
console.log(`formula × row checks: ${checked}, same answer: ${agree}, different: ${diffs.length}\n`)
for (const d of diffs) console.log(`${d.f}   [${d.row}]\n   expr-eval: ${d.old}\n   2.0:       ${d.new}\n`)

// ── every difference must have a known, agreed cause ──
const FN_NAMES = new Set(xf.functions().map((x) => x.name.toLowerCase()))
function cause(d) {
  const row = ROWS[d.row]
  if (/is not a function/.test(d.old)) return 'column named like a function broke expr-eval (fixed: a name followed by ( is always a function)'
  if (/Unknown character "="/.test(d.old)) return '= now means equals (agreed; expr-eval refused it)'
  if (/Unknown column "(\w+)"/.test(d.new) && FN_NAMES.has(RegExp.$1.toLowerCase()) && !(RegExp.$1 in row)) return 'bare function name with no such column: expr-eval silently used the FUNCTION as the value; 2.0 says the column is missing'
  if (/^length\(/.test(d.f) && d.row === 'nulls') return 'text of nothing is empty (agreed): length(null) is 0, not 4 ("null")'
  if (/!=|==/.test(d.f) && d.row === 'numbers as text') return 'equality is forgiving (agreed): "0" = 0'
  return 'UNEXPLAINED'
}
const byCause = {}
for (const d of diffs) (byCause[cause(d)] ??= []).push(d.f + '  [' + d.row + ']')
console.log('\n=== differences by cause ===')
for (const [c, list] of Object.entries(byCause)) console.log(`\n${list.length} × ${c}\n   ` + [...new Set(list)].slice(0, 6).join('\n   '))
if (byCause.UNEXPLAINED) process.exitCode = 1
