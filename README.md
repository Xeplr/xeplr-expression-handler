# @xeplr/expression-handler

> **Status: 2.0 built, not released.** The code in this repo is 2.0; npm still
> has 1.x, which does less — see [What changes from 1.x](#what-changes-from-1x).
> BI and Workflow move over next ([Moving callers over](#moving-callers-over)).

**The one formula engine for xeplr.** Every formula that is calculated in
JavaScript — BI report formulas, BI text templates, Workflow conditions — is
read, checked and run by this package, with one list of functions. Functions
that a **database** runs (query-engine ranking, SQL formulas, warehouse cube
aggregates) are not formulas in this sense and stay where they are.

Zero dependencies. No `eval`, no `new Function`. Runs the same in Node and the
browser.

```js
const xf = require('@xeplr/expression-handler');

const f = xf.compile('if(country = "India" and (score >= 750 or referred), "India payroll", "Offer")');
f({ country: 'India', score: 600, referred: true });   // → 'India payroll'
```

## API

| Call | Gives |
|---|---|
| `xf.compile(textOrTree, context?)` | `(row) → value`. Cached by text and context. |
| `xf.parse(text)` | the JSON tree (what gets stored); throws with the position |
| `xf.toText(tree)` | the tree back as text, for an editor showing a stored formula |
| `xf.check(text, context?)` | `{ ok, tree, error, position }` — never throws; for editors |
| `xf.analyze(textOrTree)` | `{ fields, fieldsOutsideTotals, thisrow, functions, aggregates, levels }` |
| `xf.functions()` | the function list, for pickers and help |
| `xf.implementations(context?)` | `{ name: fn }` ready to call, for a caller that wants the functions without the language |
| `xf.registerFunction(entry)` | adds one to the list |
| `xf.evaluate(condition, row)` | 1.x: a condition → `true` / `false` |
| `xf.toPredicate` · `xf.validate` · `xf.formula.*` · `xf.registerOperator` | 1.x, kept |

## Who uses it

| Caller | What for |
|---|---|
| BI report-engine | per-row formulas, conditional totals (`sumif`…), the formula reference / autocomplete |
| BI text templates | `{{ expr }}` in board text |
| Workflow (`@xeplr/workflow`) | the condition on each arrow (`xf.evaluate(condition, row)`) |
| Workflow designer (`@xeplr/ui-workflow`) | formula text → stored JSON (`xf.parse`) |

## The language

Written the way BI formulas are written today (expr-eval's syntax), so every
saved BI formula keeps working, with the changes listed below.

| | |
|---|---|
| Numbers, text | `42` `3.5` `1e3` `"text"` `'text'` (a doubled quote or a backslash escapes) |
| Constants | `true` `false` `null` |
| Columns / fields | `revenue`, `café`, dotted paths `form.country` · any name in brackets: `[order month]` |
| Maths | `+ - * / % ^` |
| Text join | `a \|\| b` |
| Compare | `=` `==` `!=` `<>` `<` `<=` `>` `>=` · `x in (1, 2, 3)` |
| Logic | `and` `or` `not` · `cond ? a : b` · `if(cond, a, b)` |
| Function call | `upper(city)`, `round(amount, 2)` — names are case-insensitive |

**Precedence**, lowest first — identical to expr-eval so old formulas mean what
they meant: `? :` → `or` → `and` → comparisons and `in` → `+ - ||` →
`* / %` → unary `- + not` → `^` (right-associative) → calls and paths.
One consequence to know: `not a = b` reads as `(not a) = b`. Write `not (a = b)`.

**Rules that differ from expr-eval:**
- `=` means **equals**. expr-eval treated it as assignment, which BI had to
  turn into an error. There is no assignment at all here.
- **Equality is forgiving, however it's spelled** — `=` `==` `!=` `<>` are the
  1.x `eq` / `neq`: `18 = "18"` is true, `null = null` is true. That is what
  Workflow's stored conditions already mean, and in BI it fixes the silent
  `false` when a database returns a number as text (Postgres `numeric`).
  expr-eval's `==` was strict.
- **Nothing is never less or greater** — `null < 100` is false, as in SQL.
  expr-eval said true, which sends a Workflow branch the wrong way.
- `||` stays **text join**, so old formulas keep working. OR is the word `or`.
- **A name followed by `(` is always a function; a bare name is always a
  column.** A column called `month` and the function `month()` no longer clash
  (BI's `formulaScope` workaround goes away).
- `if()`, `? :`, `and`, `or` **only evaluate what they need**. expr-eval
  evaluated both branches of every `if`.

**Brackets name a column exactly.** `[order month]`, `[2024 sales]`, `[and]`,
`[form.country]` (one key that contains a dot) — whatever is inside is the
column's name, never a keyword, number or path. `]` inside a name is written
`]]`. Paths combine them: `form.[first name]`. Bare names still work for plain
ones (`revenue`); the column picker inserts brackets whenever a name needs
them — a space or symbol, a leading digit, a dot, or a keyword. BI's
`$thisrow["col"]` keeps working alongside `$thisrow.[col]`.

**Lists are written in parentheses** — `status in ("paid", "refunded")` — because
brackets now mean a column. (expr-eval wrote lists as `[ … ]`; no BI formula
in the code or tests uses them, and the side-by-side test checks saved ones.)

**A name the row doesn't have** reads as `null`. With `{ missing: 'error' }`
in the context it is an error instead — `Unknown column "revnue"` — which is
what a report editor wants (expr-eval raised it too).

Errors say where: `Expected ")" at character 18`.

## Stored form

A formula is text for people and a **JSON tree** for storage and running.
`xf.parse(text)` gives the tree; `xf.compile(textOrTree)` gives a function.
The 1.x structured shape is a valid tree, so existing Workflow conditions load
unchanged:

```js
{ left: { field: 'age' }, op: 'gte', right: { value: 18 } }        // 1.x — still valid
{ op: 'eq', left: { field: 'country' }, right: { value: 'India' } } // what `country = "India"` parses to

{ all: [ <condition>, <condition>, { any: [ <condition>, … ] } ] }  // AND / OR groups (new)
{ not: <condition> }
```

The Workflow designer's AND / OR boxes write `all` / `any` groups directly; a
condition can also be a formula.

## Functions — the one list

Each function is one entry: its code **and** what the UI shows.

```js
{ name: 'round', category: 'Math', args: 'value, places',
  description: 'Round to a number of decimal places', example: 'round(amount, 2)',
  fn: (v, places) => … }
```

`xf.functions()` returns the list; BI's reference panel, autocomplete and
validation, and Workflow's condition picker are all built from it.
`xf.registerFunction(entry)` adds one.

| Category | Functions |
|---|---|
| Math | `round` `abs` `ceil` `floor` `sqrt` `min` `max` `pow` `trunc` `exp` `ln` `log` `log10` `log2` `cbrt` |
| Text | `upper` `lower` `trim` `concat` `substring` `left` `right` `replace` `contains` `startsWith` `endsWith` `length` |
| Date | `year` `month` `day` `quarter` `weekday` `datediff` `dateadd` `monthname` `monthkey` `quarterkey` `daykey` `ytd` `fytd` |
| Logic | `if` `coalesce` `ifnull` `isnull` `between` |
| Aggregate | `sum` `sumif` `countif` `countifunique` — see [Array formulas](#array-formulas) |

`trunc` … `cbrt` were expr-eval built-ins BI never listed; they're listed now
so saved formulas using them keep working. `log` is the **natural** log there,
kept that way.

**Behaviour — BI's rules, adopted everywhere (agreed):**
- **Every function is total:** nonsense in → `null` out, never an exception.
- **Text of nothing is empty:** `upper(null)` → `''`, never `"null"`.
- **Empty counts as missing:** `coalesce('', x)` → `x`; `0` is not missing.
- **Dates:** a date-only string `2026-05-01` is that calendar day in any time
  zone (built from its parts, as a database driver does). `month()` is
  `1`–`12`; `monthname()` is `'May'`. The financial year comes from the
  [run context](#run-context) — April when none is given.
- **Spreadsheet counting:** `substring(x, 1, 3)` counts from 1.

## Run context

Some answers depend on **who** the formula runs for, which the engine can't
know. The caller passes them in:

```js
const f = xf.compile('sumif(fytd(order_date), revenue)', {
  fiscalYearStart: 7,   // July — the workspace's / company's setting
  today: '2026-09-19'   // optional; defaults to the current date
});
```

| Key | Default | Used by |
|---|---|---|
| `fiscalYearStart` | `4` (April) | `fytd` and any financial-year function |
| `today` | now | `ytd`, `fytd` — pin it for tests and scheduled runs |
| `missing` | `'null'` | `'error'` makes a name the row lacks an error |
| `maxListItems` · `maxDistinct` · `maxSteps` · `maxLevels` | see [Limits](#limits) | |
| `aggregate(name, args, { compile, level })` | none | supplies the rows for the group form of a total (BI) |

**The financial year is a tenant setting.** It belongs to the workspace or
company, whichever level the app has, and the **app** stores and resolves it
(BI: the workspace setting; a generated app: its tenancy level). This package
only receives the value. The context is part of the compile cache key, so two
tenants with different years never share a compiled formula.

## Array formulas

A formula that adds up **many rows** into one value.

**Where the rows come from:**
- **BI** — the rows of the current group, implicitly:
  `sumif(status = "paid", amount)`. The engine can't see a report's groups, so
  the caller supplies them through the `aggregate` hook in the context; without
  it this form is an error that shows the list form.
- **Workflow and anything else** — a named list, as the first argument:
  `sumif(orders, month(order_date) = 8, revenue)`. The engine runs these itself,
  as one loop over the list. Inside the condition and the value, names read the
  list's item.

**`$thisrow`** refers to the row the formula is being worked out for, from
inside a condition that runs over other rows:

```
if(sumif(city = $thisrow.city and month(order_date) = 8, revenue) > 10000, "High August city", "Normal")
```

— "revenue for **my** city in August; over 10K?".

**Levels.** A total inside another total is one level deeper ("the highest of
each city's August total" is 2). The `if` and `> 10000` around a total don't
count. **Maximum: 2 levels** (agreed).

### Memory rules

1. **Streaming, never collecting.** Rows arrive one at a time; each total is a
   running number (sum, count, min, max, avg) that the row is added to and
   then forgotten. Memory depends on the number of **groups**, not rows.
2. **One loop per total, no temporary lists.** `sumif`, and any
   filter-then-total chain, compiles into a single loop.
3. **`$thisrow` totals run on the result rows** (grouped, small). If one is
   ever needed on raw rows, the query runs twice rather than holding the rows.
4. **Only distinct values grow with the data** — `countifunique` and
   `$thisrow` partitions keep one entry per distinct key, under a hard cap
   (below) that ends with a clear error, not an out-of-memory crash.
5. **Totals are mergeable** (two part-totals add into one), which keeps a later
   split across processes possible without redesign.

## Speed

A formula is **compiled once** into plain JavaScript closures and then run for
every row:

1. **Names resolved at compile time.** `revenue` becomes "read `row.revenue`",
   `upper` a direct reference — no lookup object per row, so a row allocates
   nothing.
2. **Constant parts computed once** — `upper("pune")` is folded at compile time.
3. **Short-circuit** — `if`, `and`, `or` run only what they need.
4. **Compiled once per run.** Callers compile when a run starts; `xf.compile`
   also caches by formula text for callers that pass text per row. A test
   asserts a report run compiles each formula exactly once.
5. **Date strings parsed once** — the last few parsed strings are remembered,
   since a streamed report repeats the same dates row after row.

Single-threaded by decision: one report uses one core. If that stops being
enough, the answer is a move to a compiled language (e.g. Rust), not worker
threads.

### Measured

1M streamed rows, 4 row formulas (`revenue - cost`, `upper(trim(city))`, a
nested `if`, `monthname(order_date)`), median of 3 runs, 2026-09-20. Compare
within a column — the two columns ran under different load.

| Path | Apple M4 Pro | Docker ½ CPU / 256 MB |
|---|---|---|
| BI before 2.0 (`enrichRow` — expr-eval, re-parses per row) | 15.5 s | 35.7 s, peak 186 MB |
| expr-eval, parsed once | 2.2 s | 5.5 s, peak 84 MB |
| **2.0, compiled once** | **0.38 s** | **1.19 s, peak 62 MB** |
| 2.0, formula text passed per row (cache) | 0.45 s | 1.29 s, peak 64 MB |
| hand-written JavaScript (the ceiling) | 0.29 s | 0.89 s, peak 62 MB |
| August `sumif` per city — BI before 2.0 | 0.95 s | 2.3 s |
| **August `sumif` per city — 2.0** | **0.16 s** | **0.50 s** |
| August `sumif` per city — hand-written | 0.15 s | 0.44 s |

About **40× faster** than BI's path before 2.0, and within 1.3× of
hand-written JavaScript. `bench/run.sh` reproduces it (the expr-eval rows need
BI checked out beside this repo).

## Limits

| Limit | Value | When hit |
|---|---|---|
| Nesting of totals (`maxLevels`) | 2 levels | error at compile time |
| Distinct values (`maxDistinct`) | 1,000,000 per total | clear error, run stops |
| Items in one list (`maxListItems`) | 10,000 | clear error |
| List items visited per evaluation (`maxSteps`) | 10,000,000 | clear error — a formula can't run away |

Each is a context key, so a caller can lower (or raise) it.

## Security

- The only callable things are the functions in the list. A value in the row
  can never be called, and a function found on a row (inherited `toString`)
  reads as nothing.
- Paths through `__proto__`, `constructor` or `prototype` are refused — in
  formula text and in stored trees.
- No `eval` / `new Function`, no dependencies. (This removes BI's `expr-eval`,
  which has two unpatched high-severity advisories.)

## What changes from 1.x

2.0 is a major version. For callers of 1.x (Workflow):

| | 1.x | 2.0 |
|---|---|---|
| `month(d)` | `'January'` | `1` (`monthname` gives `'January'`) |
| Dates | UTC | date-only strings are calendar days; see Functions |
| `upper(null)` | `null` | `''` |
| AND / OR | none | `and` / `or` / `not`, `all` / `any` groups |
| Formula mode | one comparison, `if`, one function per value | the full language |
| Functions | 10 | the list above |
| `monthNum` | exists | still accepted, not listed — use `month` |
| `formula.parse` output | `{ left: { fn, field } … }` | the 2.0 tree (`{ call, args }`) |
| `functions()` | names | the full entries |
| `<` `>` in formula text | `gt`, as numbers | JavaScript order (ISO dates work); nothing is never less |

`evaluate(expr, row)`, `toPredicate`, `validate` and the `{ left, op, right }`
shape keep working.

## Moving callers over

1. **This package — done.** Engine, 63 tests (`npm test`), `bench/`, and
   `bench/side-by-side.mjs`: every formula in BI's source and tests, plus the
   saved ones in `report_dataset_formulas`, through expr-eval and 2.0 against
   five kinds of row. On 2026-09-20: 133 formulas (22 totals, left for BI's own
   suites), 555 checks, **516 identical**; all 39 differences have a named
   cause — 32 are expr-eval bugs (a column named like a function; a function
   used as a value), 7 are the agreed changes (`=`, forgiving equality,
   `length(null)`). None unexplained; the script exits 1 if one appears.
2. **BI:** report-engine and text templates switch; `expr-eval` is removed.
   BI's own formula suites must pass unchanged.
3. **Workflow:** arrow conditions accept formulas and `all` / `any` groups.

## Decisions (2026-09-19)

- Grow this package rather than add a new one.
- Our own parser, not a library — the syntax above fits none of them, and the
  point is to own the security.
- `=` means equals · `||` joins text · BI's function behaviour wins · the
  engine lists aggregates, BI keeps the adding-up.
- At most 2 levels of totals · single-threaded.
- `[column name]` brackets for any column; lists as `in (a, b)`.
- The financial year is configurable per workspace / company, passed in the run context.
- (2026-09-20, while building) Equality is forgiving however it's spelled;
  nothing is never less or greater. Chosen so Workflow's stored conditions
  keep their meaning — to be confirmed.

## Open

- Where each app stores the financial-year setting (BI workspace settings; the
  CLI's tenancy levels) — decided when those callers move over.
