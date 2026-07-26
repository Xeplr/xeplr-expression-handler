# @xeplr/expression-handler

Level-1 structured expression evaluator. JSON expression in, boolean out — apply
field **functions** (`upper`, `month`, …) and **operators** (`eq`, `contains`,
`gt`, `between`, `isNull`, …) to a data row. No parser, no nesting, no `AND`/`OR`
combinators (by design — level 1 only). Zero dependencies.

## Usage

```js
const xf = require('@xeplr/expression-handler');

// upper(name) = upper(nickName)
xf.evaluate(
  { left: { fn: 'upper', field: 'name' }, op: 'eq', right: { fn: 'upper', field: 'nickName' } },
  { name: 'ada', nickName: 'ADA' }
); // → true

// month(createdAt) = 'January'
xf.evaluate(
  { left: { fn: 'month', field: 'createdAt' }, op: 'eq', right: { value: 'January' } },
  { createdAt: '2026-01-15T00:00:00Z' }
); // → true

// Compile once, filter many (drops into a streaming .filter too)
const isAdult = xf.toPredicate({ left: { field: 'age' }, op: 'gte', right: { value: 18 } });
rows.filter(isAdult);
```

## Expression shape

```
{ left: <operand>, op: <string>, right?: <operand> }
```

**Operand** — one of:

| Form | Meaning |
|---|---|
| `{ field: 'name' }` | `row.name` |
| `{ field: 'a.b' }` | `row.a.b` (dot path) |
| `{ field: 'name', fn: 'upper' }` | `upper(row.name)` |
| `{ value: 42 }` | literal (string / number / boolean / null / array) |

`right` is omitted for unary operators (`isNull`, `isNotNull`).

## Operators

`eq` `neq` `isNull` `isNotNull` · `gt` `gte` `lt` `lte` `between` (`[lo,hi]`, inclusive) ·
`contains` `notContains` `startsWith` `endsWith` · `in` `notIn`
Aliases: `equals`, `notEquals`, `doesNotContain`.

`eq`/`neq` against `{ value: null }` also work as null checks. Null-ish values make
numeric/string comparisons return `false` (never throw).

## Functions

String: `upper` `lower` `trim` `length` · Date (UTC): `month` (`'January'`) `monthNum`
`year` `day` `quarter` `weekday` (`'Monday'`).

## Extending

```js
xf.registerFunction('reverse', v => String(v).split('').reverse().join(''));
xf.registerOperator('regex', (a, b) => new RegExp(b).test(String(a)));
```

## Formula wrapper (Excel-like)

Write formulas as strings; they compile to the same structured JSON.

```js
xf.formula.parse('if(upper(someColumn)=anotherColumn, "Yes", "No")');
// → { if:   { left:{fn:'upper',field:'someColumn'}, op:'eq', right:{field:'anotherColumn'} },
//     then: { value:'Yes' },
//     else: { value:'No' } }

const f = xf.formula.compile('if(score>=90,"A",if(score>=80,"B","C"))');   // nested ifs
f({ score: 85 });   // → 'B'
```

Rules: `"double"`/`'single'` quoted → string literal (doubled quote escapes); bare
word → field ref; `number` / `null` / `true` / `false` → literals; `name(...)` →
function (value fn `upper`/`month`…, boolean fn `contains`/`between`/`isnull`…, or
`if`); comparisons `= == != <> > >= < <=`. Function names are case-insensitive;
`if(...)` nests. An IF evaluates to its then/else value; a bare comparison
(`upper(name)="ADA"`) compiles to a boolean predicate.

`xf.formula.parse(str)` · `xf.formula.compile(str) → (row)=>value` · `xf.formula.evaluate(node, row)`

## NLP wrapper (stub)

`xf.nlp` — natural language → expression JSON. **Not implemented yet**
(`xf.nlp.implemented === false`; `xf.nlp.parse()` throws). Placeholder surface for
a future LLM/grammar backend.

## API

`evaluate(expr, row)` · `toPredicate(expr)` · `validate(expr) → { valid, errors }` ·
`formula.{parse,compile,evaluate}` · `nlp` (stub) ·
`registerFunction` · `registerOperator` · `operators()` · `functions()`

Test: `npm test` (node --test, no DB). 29 tests.
