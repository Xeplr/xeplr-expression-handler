// How to call a function: every argument named, explained and exemplified,
// in one place — the signature help, the reference and every argument-count
// error read it, so they cannot say different things.
var test = require('node:test');
var assert = require('node:assert/strict');
var xf = require('..');

test('every function documents every argument it takes', function () {
  xf.functions().filter(function (f) { return !f.special || f.name === 'if'; }).forEach(function (f) {
    var u = xf.usage(f.name);
    assert.ok(u.params.length >= Math.min(f.min, 1), f.name + ' has no arguments documented');
    u.params.forEach(function (p) {
      assert.ok(p.name && p.about && p.example, f.name + '(' + p.name + ') needs a name, what it is and an example');
    });
    assert.equal(u.signature, f.name + '(' + u.params.map(function (p) { return p.name; }).join(', ') + ')');
  });
});

test('a total in a report: condition then value, exactly two', function () {
  var u = xf.usage('sumif');
  assert.equal(u.signature, 'sumif(condition, value)');
  assert.deepEqual([u.min, u.max], [2, 2]);
  assert.match(u.params[0].about, /Which rows/);
  assert.match(u.params[1].about, /What to add up/);
});

test('a total that names its list (Workflow) says so', function () {
  var u = xf.usage('sumif', { rows: false });
  assert.equal(u.signature, 'sumif(list, condition, value)');
  assert.equal(u.example, 'sumif(orders, status = "Paid", amount)');
});

test('the wrong number of arguments: the signature, the count, each argument and an example', function () {
  var m = xf.check('sumif(qty)').error;
  assert.match(m, /^sumif\(condition, value\) needs 2 arguments, not 1\./);
  assert.match(m, /condition: Which rows to add.*\(e\.g\. status = "Paid"\)/);
  assert.match(m, /value: What to add up.*\(e\.g\. amount\)/);
  assert.match(m, /Example: sumif\(status = "Refunded", amount\)/);
  assert.match(xf.check('round()').error, /^round\(value, places\) needs 1 or 2 arguments, not 0\./);
  assert.match(xf.check('concat()').error || 'ok', /ok/);
  assert.throws(function () { xf.compile('sumif(qty)', {}); }, /^Error: sumif\(list, condition, value\) needs 3 arguments, not 1/);
});

test('no usage for a name that is no function', function () {
  assert.equal(xf.usage('nope'), null);
});
