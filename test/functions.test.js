// The function list. Behaviour is BI's (report-engine/formulaFunctions.js),
// whose test cases are carried over here so the move can't change an answer.
// Run: node --test

var test = require('node:test');
var assert = require('node:assert');
var xf = require('../index');

var ROW = { revenue: 100, cost: 40, city: '  Delhi  ', d: '2026-07-29', blank: null, zero: 0 };
function val(text, row) { return xf.compile(text)(row || ROW); }

test('round — two arguments, nothing is 0, text is null', function () {
  assert.strictEqual(val('round(revenue * 0.1234, 2)'), 12.34);
  assert.strictEqual(val('round(1.6)'), 2);
  assert.strictEqual(val('round(blank)'), 0);
  assert.strictEqual(val('round("abc")'), null);
});

test('math', function () {
  assert.strictEqual(val('abs(-3)'), 3);
  assert.strictEqual(val('ceil(1.2) + floor(1.8)'), 3);
  assert.strictEqual(val('sqrt(9)'), 3);
  assert.strictEqual(val('min(5, 2, 9)'), 2);
  assert.strictEqual(val('max(5, 2, 9)'), 9);
  assert.strictEqual(val('pow(2, 10)'), 1024);
  assert.strictEqual(val('trunc(-1.7)'), -1);
  assert.strictEqual(val('log(exp(2))'), 2);          // natural log, as expr-eval
  assert.strictEqual(val('abs("x")'), null);          // nonsense → null, not NaN
});

test('text', function () {
  assert.strictEqual(val('upper(city)'), '  DELHI  ');
  assert.strictEqual(val('trim(city)'), 'Delhi');
  assert.strictEqual(val('upper(trim(city))'), 'DELHI');
  assert.strictEqual(val('left(trim(city), 3)'), 'Del');
  assert.strictEqual(val('right(trim(city), 3)'), 'lhi');
  assert.strictEqual(val('substring(trim(city), 1, 3)'), 'Del');     // counts from 1
  assert.strictEqual(val('substring(trim(city), 3)'), 'lhi');
  assert.strictEqual(val('replace(trim(city), "l", "L")'), 'DeLhi');
  assert.strictEqual(val('contains(city, "elh")'), true);
  assert.strictEqual(val('startsWith(trim(city), "De") and endsWith(trim(city), "hi")'), true);
  assert.strictEqual(val('concat(trim(city), "-", revenue)'), 'Delhi-100');
  assert.strictEqual(val('length(trim(city))'), 5);
});

test('text of nothing is empty, never "null"', function () {
  assert.strictEqual(val('upper(blank)'), '');
  assert.strictEqual(val('concat(trim(city), blank)'), 'Delhi');
  assert.strictEqual(val('length(blank)'), 0);
});

test('dates', function () {
  assert.strictEqual(val('year(d)'), 2026);
  assert.strictEqual(val('month(d)'), 7);                           // 1–12
  assert.strictEqual(val('day(d)'), 29);
  assert.strictEqual(val('quarter(d)'), 3);
  assert.strictEqual(val('weekday(d)'), 'Wednesday');
  assert.strictEqual(val('datediff("2026-07-01", d)'), 28);
  assert.strictEqual(val('datediff(d, "2026-07-01")'), -28);
  assert.strictEqual(val('dateadd("2026-07-29", 3)'), '2026-08-01');
  assert.strictEqual(val('dateadd("2026-08-01", -3)'), '2026-07-29');
  assert.strictEqual(val('monthname("2026-05-17")'), 'May');
  assert.strictEqual(val('monthname(5)'), 'May');
  assert.strictEqual(val('monthname(13)'), null);
  assert.strictEqual(val('monthkey(d) || " " || quarterkey(d) || " " || daykey(d)'), '2026-07 2026-Q3 2026-07-29');
});

test('a date-only string is that calendar day in any time zone', function () {
  // Built from its parts — "2026-05-01" must never read as April 30th.
  assert.strictEqual(val('day("2026-05-01")'), 1);
  assert.strictEqual(val('month("2026-05-01")'), 5);
});

test('a date function on nothing or nonsense is null', function () {
  assert.strictEqual(val('year(blank)'), null);
  assert.strictEqual(val('year("not a date")'), null);
  assert.strictEqual(val('monthname(blank)'), null);
});

test('ytd / fytd — predicates, up to today, from the run context', function () {
  var ctx = { today: '2026-09-19' };
  function on(text, row, extra) { return xf.compile(text, Object.assign({}, ctx, extra))(row); }
  assert.strictEqual(on('ytd(x)', { x: '2026-09-19' }), true);
  assert.strictEqual(on('ytd(x)', { x: '2026-12-31' }), false);        // later this year is not "so far"
  assert.strictEqual(on('ytd(x)', { x: '2025-06-01' }), false);
  assert.strictEqual(on('ytd(x)', { x: null }), false);                // false, not null
  assert.strictEqual(on('fytd(x)', { x: '2026-04-01' }), true);        // April start (default)
  assert.strictEqual(on('fytd(x)', { x: '2026-03-31' }), false);
  assert.strictEqual(on('fytd(x)', { x: '2026-06-30' }, { fiscalYearStart: 7 }), false);   // July start
  assert.strictEqual(on('fytd(x)', { x: '2026-07-01' }, { fiscalYearStart: 7 }), true);
  // January to March belong to the financial year that began LAST calendar year.
  assert.strictEqual(xf.compile('fytd(x)', { today: '2026-02-10' })({ x: '2025-04-01' }), true);
});

test('the run context is checked', function () {
  assert.throws(function () { xf.compile('fytd(x)', { fiscalYearStart: 13 }); }, /fiscalYearStart must be a month/);
  assert.throws(function () { xf.compile('fytd(x)', { today: 'soon' }); }, /context.today is not a date/);
});

test('null handling', function () {
  assert.strictEqual(val('coalesce(blank, cost)'), 40);
  assert.strictEqual(val('coalesce("", "x")'), 'x');                  // empty counts as missing
  assert.strictEqual(val('coalesce(zero, "x")'), 0);                  // zero does not
  assert.strictEqual(val('ifnull(blank, 0)'), 0);
  assert.strictEqual(val('isnull(blank) and not isnull(cost)'), true);
});

test('between — numbers as numbers, anything else as text; nothing is never between', function () {
  assert.strictEqual(val('between(5, 1, 10)'), true);
  assert.strictEqual(val('between("5", 1, 10)'), true);
  assert.strictEqual(val('between(d, "2026-07-01", "2026-07-31")'), true);
  assert.strictEqual(val('between(blank, 1, 10)'), false);
});

test('only the branch taken is evaluated', function () {
  var calls = 0;
  xf.registerFunction({ name: 'countCalls', category: 'Custom', args: '', description: 'test', example: 'countCalls()', min: 0, max: 0, volatile: true, fn: function () { calls++; return 1; } });
  xf.compile('if(true, 1, countCalls())')({});
  xf.compile('false and countCalls() = 1')({});
  xf.compile('true or countCalls() = 1')({});
  xf.compile('true ? 1 : countCalls()')({});
  assert.strictEqual(calls, 0);
  // …so a branch that would be nonsense can't poison the answer.
  assert.strictEqual(val('if(isnull(blank), 0, year(blank))'), 0);
  assert.strictEqual(val('if(zero != 0, revenue / zero, -1)'), -1);
});

test('fixed parts are worked out once, at compile time', function () {
  assert.strictEqual(xf.compile('upper("pune") || "-" || 2 * 3').isConst, true);
  assert.strictEqual(xf.compile('upper(city)').isConst, false);
  assert.strictEqual(xf.compile('ytd("2026-01-01")').isConst, false);     // depends on today
});

// ── the list itself ──
test('every entry has what the reference panel shows', function () {
  var list = xf.functions();
  list.forEach(function (f) {
    assert.ok(f.name && f.category && f.description && f.example !== undefined, f.name);
    assert.ok(xf.CATEGORIES.indexOf(f.category) !== -1 || f.category === 'Custom', f.name);
  });
  var names = list.map(function (f) { return f.name.toLowerCase(); });
  assert.strictEqual(new Set(names).size, names.length, 'no duplicate names');
  assert.ok(names.indexOf('monthnum') === -1, '1.x alias is accepted but not listed');
});

test('every listed example compiles', function () {
  xf.functions().forEach(function (f) {
    if (f.name.charAt(0) === '$') return;                       // a reference, not a call
    var opts = f.aggregate ? { aggregate: function () { return function () { return 0; }; } } : undefined;
    var r = xf.check(f.example, opts);
    assert.ok(r.ok, f.name + ': ' + r.error);
  });
});

test('registerFunction adds to the list; built-in syntax can\'t be replaced', function () {
  xf.registerFunction({ name: 'initials', category: 'Text', args: 'text', description: 'First letters', example: 'initials(name)', min: 1, max: 1,
    fn: function (v) { return String(v || '').split(/\s+/).map(function (w) { return w.charAt(0); }).join(''); } });
  assert.strictEqual(val('initials(name)', { name: 'Ada King Lovelace' }), 'AKL');
  assert.ok(xf.functions().some(function (f) { return f.name === 'initials'; }));
  assert.throws(function () { xf.registerFunction('if', function () {}); }, /built into the language/);
  assert.throws(function () { xf.registerFunction('sum', function () {}); }, /built into the language/);
});
