// Unit tests — no dependencies, no DB. Run: node --test

var test = require('node:test');
var assert = require('node:assert');
var xf = require('../index');

// ── string: upper(a) = upper(b) ──
test('upper(field) eq upper(field) — case-insensitive field-to-field match', function () {
  var expr = { left: { fn: 'upper', field: 'name' }, op: 'eq', right: { fn: 'upper', field: 'nickName' } };
  assert.strictEqual(xf.evaluate(expr, { name: 'ada', nickName: 'ADA' }), true);
  assert.strictEqual(xf.evaluate(expr, { name: 'ada', nickName: 'bob' }), false);
});

test('contains / doesNotContain against a literal', function () {
  var row = { description: 'this is urgent' };
  assert.strictEqual(xf.evaluate({ left: { field: 'description' }, op: 'contains', right: { value: 'urgent' } }, row), true);
  assert.strictEqual(xf.evaluate({ left: { field: 'description' }, op: 'contains', right: { value: 'later' } }, row), false);
  assert.strictEqual(xf.evaluate({ left: { field: 'description' }, op: 'notContains', right: { value: 'draft' } }, row), true);
  assert.strictEqual(xf.evaluate({ left: { field: 'description' }, op: 'doesNotContain', right: { value: 'urgent' } }, row), false);
});

test('startsWith / endsWith', function () {
  var row = { code: 'INV-2026-07' };
  assert.strictEqual(xf.evaluate({ left: { field: 'code' }, op: 'startsWith', right: { value: 'INV' } }, row), true);
  assert.strictEqual(xf.evaluate({ left: { field: 'code' }, op: 'endsWith', right: { value: '-07' } }, row), true);
});

// ── null: equals null / neq null, both via isNull/isNotNull AND eq/neq ──
test('isNull / isNotNull', function () {
  assert.strictEqual(xf.evaluate({ left: { field: 'status' }, op: 'isNull' }, { status: null }), true);
  assert.strictEqual(xf.evaluate({ left: { field: 'status' }, op: 'isNull' }, {}), true);            // undefined counts
  assert.strictEqual(xf.evaluate({ left: { field: 'status' }, op: 'isNull' }, { status: 'ok' }), false);
  assert.strictEqual(xf.evaluate({ left: { field: 'status' }, op: 'isNotNull' }, { status: 'ok' }), true);
});

test('eq null / neq null also work as null checks', function () {
  assert.strictEqual(xf.evaluate({ left: { field: 'status' }, op: 'eq', right: { value: null } }, { status: null }), true);
  assert.strictEqual(xf.evaluate({ left: { field: 'status' }, op: 'neq', right: { value: null } }, { status: 'ok' }), true);
});

// ── numbers: gt, gte, between, eq ──
test('gt / gte / lt / lte', function () {
  assert.strictEqual(xf.evaluate({ left: { field: 'age' }, op: 'gt', right: { value: 18 } }, { age: 21 }), true);
  assert.strictEqual(xf.evaluate({ left: { field: 'age' }, op: 'gte', right: { value: 18 } }, { age: 18 }), true);
  assert.strictEqual(xf.evaluate({ left: { field: 'age' }, op: 'gt', right: { value: 18 } }, { age: 18 }), false);
  assert.strictEqual(xf.evaluate({ left: { field: 'age' }, op: 'lte', right: { value: 18 } }, { age: 18 }), true);
});

test('numeric strings coerce for comparison and equality', function () {
  assert.strictEqual(xf.evaluate({ left: { field: 'age' }, op: 'gte', right: { value: 18 } }, { age: '21' }), true);
  assert.strictEqual(xf.evaluate({ left: { field: 'age' }, op: 'eq', right: { value: 18 } }, { age: '18' }), true);
});

test('between (inclusive)', function () {
  var expr = { left: { field: 'score' }, op: 'between', right: { value: [1, 10] } };
  assert.strictEqual(xf.evaluate(expr, { score: 1 }), true);
  assert.strictEqual(xf.evaluate(expr, { score: 10 }), true);
  assert.strictEqual(xf.evaluate(expr, { score: 11 }), false);
  assert.strictEqual(xf.evaluate(expr, { score: 0 }), false);
});

test('in / notIn', function () {
  var expr = { left: { field: 'country' }, op: 'in', right: { value: ['IN', 'US', 'GB'] } };
  assert.strictEqual(xf.evaluate(expr, { country: 'US' }), true);
  assert.strictEqual(xf.evaluate(expr, { country: 'FR' }), false);
  assert.strictEqual(xf.evaluate({ left: { field: 'country' }, op: 'notIn', right: { value: ['IN', 'US'] } }, { country: 'FR' }), true);
});

// ── dates: month(dateField) = 'January', plus other date fns ──
test('month(dateField) eq month-name', function () {
  var expr = { left: { fn: 'month', field: 'createdAt' }, op: 'eq', right: { value: 'January' } };
  assert.strictEqual(xf.evaluate(expr, { createdAt: '2026-01-15T00:00:00Z' }), true);
  assert.strictEqual(xf.evaluate(expr, { createdAt: '2026-07-15T00:00:00Z' }), false);
});

test('year / day / quarter / weekday / monthNum (UTC)', function () {
  var row = { d: '2026-07-21T10:00:00Z' };   // Tuesday
  assert.strictEqual(xf.evaluate({ left: { fn: 'year', field: 'd' }, op: 'eq', right: { value: 2026 } }, row), true);
  assert.strictEqual(xf.evaluate({ left: { fn: 'day', field: 'd' }, op: 'eq', right: { value: 21 } }, row), true);
  assert.strictEqual(xf.evaluate({ left: { fn: 'quarter', field: 'd' }, op: 'eq', right: { value: 3 } }, row), true);
  assert.strictEqual(xf.evaluate({ left: { fn: 'weekday', field: 'd' }, op: 'eq', right: { value: 'Tuesday' } }, row), true);
  assert.strictEqual(xf.evaluate({ left: { fn: 'monthNum', field: 'd' }, op: 'gte', right: { value: 7 } }, row), true);
});

// ── null-safety of comparisons ──
test('null-ish values make comparisons false (not throw)', function () {
  assert.strictEqual(xf.evaluate({ left: { field: 'age' }, op: 'gt', right: { value: 5 } }, { age: null }), false);
  assert.strictEqual(xf.evaluate({ left: { field: 'desc' }, op: 'contains', right: { value: 'x' } }, {}), false);
  assert.strictEqual(xf.evaluate({ left: { fn: 'month', field: 'd' }, op: 'eq', right: { value: 'January' } }, { d: 'not-a-date' }), false);
});

// ── operand features: literals both sides, dot paths ──
test('dot-path field access', function () {
  var expr = { left: { field: 'address.state' }, op: 'eq', right: { value: 'Maharashtra' } };
  assert.strictEqual(xf.evaluate(expr, { address: { state: 'Maharashtra' } }), true);
  assert.strictEqual(xf.evaluate(expr, { address: {} }), false);
});

test('function on a literal operand', function () {
  var expr = { left: { field: 'name' }, op: 'eq', right: { fn: 'upper', value: 'ada' } };
  assert.strictEqual(xf.evaluate(expr, { name: 'ADA' }), true);
});

// ── toPredicate + filtering ──
test('toPredicate filters an array and validates up front', function () {
  var isAdult = xf.toPredicate({ left: { field: 'age' }, op: 'gte', right: { value: 18 } });
  var out = [{ age: 12 }, { age: 40 }, { age: 18 }].filter(isAdult);
  assert.deepStrictEqual(out.map(function (r) { return r.age; }), [40, 18]);

  assert.throws(function () { xf.toPredicate({ left: { field: 'age' }, op: 'bogus', right: { value: 1 } }); }, /Invalid expression/);
});

// ── validation ──
test('validate catches bad ops, missing operands, unknown functions', function () {
  assert.strictEqual(xf.validate({ left: { field: 'a' }, op: 'eq', right: { value: 1 } }).valid, true);
  assert.strictEqual(xf.validate({ left: { field: 'a' }, op: 'isNull' }).valid, true);   // unary needs no right

  var r1 = xf.validate({ left: { field: 'a' }, op: 'nope', right: { value: 1 } });
  assert.strictEqual(r1.valid, false);
  assert.ok(r1.errors.some(function (e) { return /unknown operator/.test(e); }));

  var r2 = xf.validate({ left: { field: 'a' }, op: 'gt' });
  assert.ok(r2.errors.some(function (e) { return /requires a right operand/.test(e); }));

  var r3 = xf.validate({ left: { field: 'a', fn: 'ghost' }, op: 'eq', right: { value: 1 } });
  assert.ok(r3.errors.some(function (e) { return /unknown function/.test(e); }));

  var r4 = xf.validate({ left: {}, op: 'eq', right: { value: 1 } });
  assert.ok(r4.errors.some(function (e) { return /needs "field" or "value"/.test(e); }));
});

test('evaluate throws on unknown operator / function', function () {
  assert.throws(function () { xf.evaluate({ left: { field: 'a' }, op: 'zzz', right: { value: 1 } }, {}); }, /Unknown operator/);
  assert.throws(function () { xf.evaluate({ left: { field: 'a', fn: 'zzz' }, op: 'eq', right: { value: 1 } }, {}); }, /Unknown function/);
});

// ── extensibility ──
test('registerFunction / registerOperator', function () {
  xf.registerFunction('reverse', function (v) { return String(v).split('').reverse().join(''); });
  assert.strictEqual(xf.evaluate({ left: { fn: 'reverse', field: 'name' }, op: 'eq', right: { value: 'cba' } }, { name: 'abc' }), true);

  xf.registerOperator('regex', function (a, b) { return new RegExp(b).test(String(a)); });
  assert.strictEqual(xf.evaluate({ left: { field: 'sku' }, op: 'regex', right: { value: '^INV-' } }, { sku: 'INV-01' }), true);

  assert.ok(xf.functions().indexOf('reverse') >= 0);
  assert.ok(xf.operators().indexOf('regex') >= 0);
});
