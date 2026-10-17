// ignoreCase: equality, membership and the text operators, folded when the
// caller asks — and exactly as before when it does not, which is what every
// existing caller (Workflow's conditions, 1.x rules) relies on. Run: node --test

var test = require('node:test');
var assert = require('node:assert');
var xf = require('../index');

function exact(text, row) { return xf.compile(text)(row || {}); }
function folded(text, row) { return xf.compile(text, { ignoreCase: true })(row || {}); }

test('off by default: text compares exactly', function () {
  assert.strictEqual(exact('status = "Paid"', { status: 'paid' }), false);
  assert.strictEqual(exact('ipg in ("RM")', { ipg: 'rm' }), false);
  assert.strictEqual(exact('status != "Paid"', { status: 'paid' }), true);
});

test('= != and in ignore case when asked', function () {
  assert.strictEqual(folded('status = "Paid"', { status: 'paid' }), true);
  assert.strictEqual(folded('status == "PAID"', { status: 'paid' }), true);
  assert.strictEqual(folded('status != "Paid"', { status: 'PAID' }), false);
  assert.strictEqual(folded('status <> "Paid"', { status: 'refunded' }), true);
  assert.strictEqual(folded('ipg in ("RM", "BYPROD", "SCRAP")', { ipg: 'Scrap' }), true);
  assert.strictEqual(folded('ipg in ("RM")', { ipg: 'WIP' }), false);
});

test('two columns compared to each other fold too', function () {
  assert.strictEqual(folded('a = b', { a: 'North', b: 'NORTH' }), true);
});

test('numbers and null compare exactly as before', function () {
  assert.strictEqual(folded('n = 18', { n: '18' }), true);
  assert.strictEqual(folded('n = 18', { n: 18.5 }), false);
  assert.strictEqual(folded('x = null', { x: null }), true);
  assert.strictEqual(folded('x = "a"', { x: null }), false);
  assert.strictEqual(folded('x != "a"', { x: null }), true);
});

test('the 1.x word operators fold too', function () {
  var row = { name: 'Acme Corp' };
  var node = function (op, right) { return { left: { field: 'name' }, op: op, right: { value: right } }; };
  var run = function (op, right, opts) { return xf.compile(node(op, right), opts)(row); };
  assert.strictEqual(run('contains', 'acme', { ignoreCase: true }), true);
  assert.strictEqual(run('contains', 'acme'), false);
  assert.strictEqual(run('startsWith', 'ACME', { ignoreCase: true }), true);
  assert.strictEqual(run('endsWith', 'corp', { ignoreCase: true }), true);
  assert.strictEqual(run('notContains', 'ACME', { ignoreCase: true }), false);
  assert.strictEqual(run('equals', 'acme corp', { ignoreCase: true }), true);
  assert.strictEqual(xf.compile({ left: { field: 'name' }, op: 'notIn', right: { value: ['ACME CORP'] } }, { ignoreCase: true })(row), false);
});

test('contains, startsWith and endsWith fold too', function () {
  var row = { name: 'Acme Corp' };
  assert.strictEqual(folded('contains(name, "ACME")', row), true);
  assert.strictEqual(exact('contains(name, "ACME")', row), false);
  assert.strictEqual(folded('startsWith(name, "acme")', row), true);
  assert.strictEqual(folded('endsWith(name, "CORP")', row), true);
  assert.strictEqual(folded('contains(name, "zed")', row), false);
});

test('a total\'s condition folds as well', function () {
  var f = xf.compile('countif(items, status = "PAID")', { ignoreCase: true });
  assert.strictEqual(f({ items: [{ status: 'paid' }, { status: 'Paid' }, { status: 'refunded' }] }), 2);
});

test('the setting is part of the compiled formula, not shared between callers', function () {
  assert.strictEqual(folded('s = "A"', { s: 'a' }), true);
  assert.strictEqual(exact('s = "A"', { s: 'a' }), false);
});
