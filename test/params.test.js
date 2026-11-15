// :parameters — a value the run supplies, written :name.
// Run: node --test

var test = require('node:test');
var assert = require('node:assert');
var xf = require('../index');

test(':name reads as a parameter where a value is expected', function () {
  assert.deepStrictEqual(xf.parse(':start_date'), { param: 'start_date' });
  assert.deepStrictEqual(xf.parse('order_date >= :start_date').right, { param: 'start_date' });
  assert.deepStrictEqual(xf.parse('region in (:a, "North")').right.list[0], { param: 'a' });
});

test('the ? : choice is never read as a parameter', function () {
  var t = xf.parse('qty > 0 ? qty : 0');
  assert.deepStrictEqual(t.else, { value: 0 });
  assert.deepStrictEqual(xf.parse('qty > 0 ? qty :zero').else, { field: 'zero' });
  assert.deepStrictEqual(xf.parse('qty > 0 ? :a : :b').then, { param: 'a' });
});

test('a parameter name is letters, digits and _', function () {
  assert.throws(function () { xf.parse(':café') }, /letters, digits and _/);
  assert.throws(function () { xf.parse(': start') }, /Expected a value/);
});

test('run: the value comes from params; none is refused, naming it', function () {
  assert.strictEqual(xf.compile('qty * :rate', { params: { rate: 2 } })({ qty: 5 }), 10);
  assert.strictEqual(xf.compile('region = :r', { params: { r: 'North' } })({ region: 'North' }), true);
  assert.throws(function () { xf.compile(':rate * 2') }, /No value for :rate/);
});

test('analyze lists them; toText writes them back', function () {
  assert.deepStrictEqual(xf.analyze('a >= :from and a <= :to and b = :from').params, ['from', 'to']);
  assert.strictEqual(xf.toText(xf.parse('order_date >= :start_date')), 'order_date >= :start_date');
});
