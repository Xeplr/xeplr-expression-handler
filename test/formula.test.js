// Formula wrapper tests. Run: node --test

var test = require('node:test');
var assert = require('node:assert');
var xf = require('../index');

test('parses the canonical example into the required JSON', function () {
  var json = xf.formula.parse('if(upper(someColumn)=anotherColumn, "Yes", "No")');
  assert.deepStrictEqual(json, {
    if:   { left: { fn: 'upper', field: 'someColumn' }, op: 'eq', right: { field: 'anotherColumn' } },
    then: { value: 'Yes' },
    else: { value: 'No' }
  });
});

test('evaluates the canonical example against rows', function () {
  var f = xf.formula.compile('if(upper(someColumn)=anotherColumn, "Yes", "No")');
  assert.strictEqual(f({ someColumn: 'abc', anotherColumn: 'ABC' }), 'Yes');
  assert.strictEqual(f({ someColumn: 'abc', anotherColumn: 'XYZ' }), 'No');
});

test('double-quoted = string literal, bare word = field reference', function () {
  assert.deepStrictEqual(xf.formula.parse('"Yes"'), { value: 'Yes' });
  assert.deepStrictEqual(xf.formula.parse('status'), { field: 'status' });
  // single quotes also work as strings; doubled quote escapes
  assert.deepStrictEqual(xf.formula.parse("'hello'"), { value: 'hello' });
  assert.deepStrictEqual(xf.formula.parse('"say ""hi"""'), { value: 'say "hi"' });
});

test('nested ifs', function () {
  var f = xf.formula.compile('if(score>=90,"A",if(score>=80,"B","C"))');
  assert.strictEqual(f({ score: 95 }), 'A');
  assert.strictEqual(f({ score: 85 }), 'B');
  assert.strictEqual(f({ score: 50 }), 'C');

  var json = xf.formula.parse('if(score>=90,"A",if(score>=80,"B","C"))');
  assert.deepStrictEqual(json.else, {
    if: { left: { field: 'score' }, op: 'gte', right: { value: 80 } },
    then: { value: 'B' },
    else: { value: 'C' }
  });
});

test('all comparison symbols map to operators', function () {
  assert.strictEqual(xf.formula.parse('a = b').op, 'eq');
  assert.strictEqual(xf.formula.parse('a == b').op, 'eq');
  assert.strictEqual(xf.formula.parse('a != b').op, 'neq');
  assert.strictEqual(xf.formula.parse('a <> b').op, 'neq');
  assert.strictEqual(xf.formula.parse('a > b').op, 'gt');
  assert.strictEqual(xf.formula.parse('a >= b').op, 'gte');
  assert.strictEqual(xf.formula.parse('a < b').op, 'lt');
  assert.strictEqual(xf.formula.parse('a <= b').op, 'lte');
});

test('numbers, null, true/false literals', function () {
  assert.deepStrictEqual(xf.formula.parse('age >= 18').right, { value: 18 });
  assert.deepStrictEqual(xf.formula.parse('status = null').right, { value: null });
  // status = null works as a null check at eval time
  assert.strictEqual(xf.formula.compile('status = null')({ status: null }), true);
  assert.strictEqual(xf.formula.compile('status = null')({ status: 'x' }), false);
});

test('date function: month(dateField) = "January"', function () {
  var f = xf.formula.compile('month(createdAt) = "January"');
  assert.strictEqual(f({ createdAt: '2026-01-15T00:00:00Z' }), true);
  assert.strictEqual(f({ createdAt: '2026-07-15T00:00:00Z' }), false);
  // case-insensitive function name resolves to the camelCase registry key
  assert.deepStrictEqual(xf.formula.parse('monthNum(d) >= 7').left, { fn: 'monthNum', field: 'd' });
});

test('boolean functions: contains / isnull / between', function () {
  assert.strictEqual(xf.formula.compile('contains(desc, "urgent")')({ desc: 'is urgent' }), true);
  assert.strictEqual(xf.formula.compile('isnull(status)')({ status: null }), true);
  assert.strictEqual(xf.formula.compile('between(score, 1, 10)')({ score: 5 }), true);
  assert.deepStrictEqual(xf.formula.parse('between(score, 1, 10)'), {
    left: { field: 'score' }, op: 'between', right: { value: [1, 10] }
  });
});

test('a bare comparison compiles to a boolean predicate', function () {
  var pred = xf.formula.compile('upper(name) = "ADA"');
  assert.strictEqual(pred({ name: 'ada' }), true);
  assert.strictEqual(pred({ name: 'bob' }), false);
});

test('syntax errors throw clearly', function () {
  assert.throws(function () { xf.formula.parse('if(a=b, "x")'); }, /Expected comma/);       // missing else
  assert.throws(function () { xf.formula.parse('upper(a) = '); }, /Unexpected end/);
  assert.throws(function () { xf.formula.parse('a = b)'); }, /trailing tokens/);
  assert.throws(function () { xf.formula.parse('upper(upper(a)) = b'); }, /level-1/);        // nested fn
});

test('nlp wrapper is a stub that throws / feature-detectable', function () {
  assert.strictEqual(xf.nlp.implemented, false);
  assert.throws(function () { xf.nlp.parse('rows where month is January'); }, /not implemented/);
});
