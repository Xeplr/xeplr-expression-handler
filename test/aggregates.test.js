// Totals over rows: list totals, $thisrow, levels, limits, and analyze().
// Run: node --test

var test = require('node:test');
var assert = require('node:assert');
var xf = require('../index');

var ORDERS = [
  { city: 'Pune', order_date: '2026-08-03', revenue: 9000, status: 'paid', customer: 'a', lines: [{ amount: 5 }, { amount: 7 }] },
  { city: 'Pune', order_date: '2026-08-20', revenue: 2000, status: 'refunded', customer: 'b', lines: [{ amount: 1 }] },
  { city: 'Pune', order_date: '2026-07-15', revenue: 50000, status: 'paid', customer: 'a', lines: [] },
  { city: 'Delhi', order_date: '2026-08-01', revenue: 99999, status: 'paid', customer: 'c', lines: null }
];

test('sum / sumif / countif / countifunique over a named list', function () {
  var row = { orders: ORDERS };
  assert.strictEqual(xf.compile('sum(orders, revenue)')(row), 160999);
  assert.strictEqual(xf.compile('sumif(orders, status = "paid", revenue)')(row), 158999);
  assert.strictEqual(xf.compile('countif(orders, month(order_date) = 8)')(row), 3);
  assert.strictEqual(xf.compile('countifunique(orders, status = "paid", customer)')(row), 2);
});

test('your August example — a total inside a formula, one level', function () {
  var f = xf.compile('if(sumif(orders, city = $thisrow.city and month(order_date) = 8, revenue) > 10000, "High August city", "Normal")');
  assert.strictEqual(f({ city: 'Pune', orders: ORDERS }), 'High August city');    // 9000 + 2000
  assert.strictEqual(f({ city: 'Mumbai', orders: ORDERS }), 'Normal');
  assert.strictEqual(xf.analyze('sumif(orders, city = $thisrow.city, revenue)').levels, 1);
});

test('inside a list total, names read the item; $thisrow reads the row', function () {
  var f = xf.compile('countif(orders, city = $thisrow.city)');
  assert.strictEqual(f({ city: 'Delhi', orders: ORDERS }), 1);
});

test('a total inside a total — two levels', function () {
  var f = xf.compile('sum(orders, sum(lines, amount))');
  assert.strictEqual(f({ orders: ORDERS }), 13);                    // 5 + 7 + 1; [] and null add 0
  assert.strictEqual(xf.analyze('sum(orders, sum(lines, amount))').levels, 2);
});

test('three levels are refused at compile time', function () {
  assert.throws(function () { xf.compile('sum(a, sum(b, sum(c, x)))'); }, /at most 1 more total inside it/);
  // maxLevels is the knob, should a caller ever need to lower it.
  assert.throws(function () { xf.compile('sum(a, sum(b, x))', { maxLevels: 1 }); }, /levels deep/);
});

test('no list is 0; something that is not a list is an error', function () {
  assert.strictEqual(xf.compile('sum(orders, revenue)')({}), 0);
  assert.strictEqual(xf.compile('countif(orders, true)')({ orders: null }), 0);
  assert.throws(function () { xf.compile('sum(orders, revenue)')({ orders: 'x' }); }, /orders is not a list/);
});

test('values that are not numbers add nothing', function () {
  var f = xf.compile('sum(items, v)');
  assert.strictEqual(f({ items: [{ v: 1 }, { v: '2' }, { v: 'x' }, { v: null }, { v: '' }, {}] }), 3);
});

test('limits end with a clear error, not a runaway', function () {
  var big = { items: new Array(11).fill({ v: 1 }) };
  assert.throws(function () { xf.compile('sum(items, v)', { maxListItems: 10 })(big); }, /items has 11 items; a total can run over at most 10/);
  // Steps count every item visited in one evaluation, across nested totals.
  var nested = { a: new Array(20).fill({ b: new Array(20).fill({ x: 1 }) }) };
  assert.strictEqual(xf.compile('sum(a, sum(b, x))')(nested), 400);
  assert.throws(function () { xf.compile('sum(a, sum(b, x))', { maxSteps: 100 })(nested); }, /more than 100 list items/);
  // …and the count starts again for the next evaluation.
  var f = xf.compile('sum(items, v)', { maxSteps: 12 });
  f({ items: new Array(10).fill({ v: 1 }) });
  assert.strictEqual(f({ items: new Array(10).fill({ v: 1 }) }), 10);
  var many = { items: [1, 2, 3, 4].map(function (n) { return { k: n }; }) };
  assert.throws(function () { xf.compile('countifunique(items, true, k)', { maxDistinct: 3 })(many); }, /more than 3 different values/);
});

test('the group form needs the caller to supply the rows', function () {
  assert.throws(function () { xf.compile('sumif(status = "paid", amount)'); }, /Outside a report, name the list first — sumif\(orders, condition, value\)/);
  // A report engine supplies them through the aggregate hook.
  var seen = null;
  var f = xf.compile('sumif(status = "paid", amount) / 2', {
    aggregate: function (name, args, helpers) {
      seen = { name: name, argCount: args.length, level: helpers.level };
      var cond = helpers.compile(args[0]);
      return function () { return cond({ status: 'paid' }) ? 100 : 0; };
    }
  });
  assert.strictEqual(f({}), 50);
  assert.deepStrictEqual(seen, { name: 'sumif', argCount: 2, level: 1 });
});

test('wrong argument counts are caught while typing', function () {
  assert.match(xf.check('sumif(orders)').error, /sumif\(\) takes 2 to 3 arguments/);
  assert.match(xf.check('countif(a, b, c)').error, /countif\(\) takes 1 to 2 arguments/);
});

// ── analyze ──
test('analyze — what a formula uses, without running it', function () {
  var a = xf.analyze('if(sum(a) > 10, upper(city), "-")');
  assert.deepStrictEqual(a.fields, ['a', 'city']);
  assert.deepStrictEqual(a.fieldsOutsideTotals, ['city']);
  assert.deepStrictEqual(a.functions, ['sum', 'upper']);
  assert.deepStrictEqual(a.aggregates, [{ name: 'sum', list: null, fields: ['a'] }]);
  assert.strictEqual(a.levels, 1);

  var b = xf.analyze('sumif(orders, city = $thisrow.city and form.[first name] = "x", revenue)');
  assert.deepStrictEqual(b.aggregates, [{ name: 'sumif', list: 'orders', fields: ['city', 'form.first name', 'revenue'] }]);
  assert.deepStrictEqual(b.thisrow, ['city']);
  assert.deepStrictEqual(b.fieldsOutsideTotals, ['orders']);

  var c = xf.analyze('revenue - cost');
  assert.deepStrictEqual(c.aggregates, []);
  assert.strictEqual(c.levels, 0);

  // A 1.x condition works too.
  assert.deepStrictEqual(xf.analyze({ left: { field: 'age', fn: 'abs' }, op: 'gte', right: { value: 18 } }).fields, ['age']);
});
