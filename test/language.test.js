// The language: reading formulas, precedence, names, errors, and what a
// formula can never reach. Run: node --test

var test = require('node:test');
var assert = require('node:assert');
var xf = require('../index');

function run(text, row) { return xf.compile(text)(row || {}); }
function errorOf(text) { var r = xf.check(text); return r.ok ? null : r.error; }

// ── precedence — identical to expr-eval, so old formulas mean what they meant ──
test('arithmetic precedence and grouping', function () {
  assert.strictEqual(run('1 + 2 * 3'), 7);
  assert.strictEqual(run('(1 + 2) * 3'), 9);
  assert.strictEqual(run('10 - 4 - 3'), 3);           // left to right
  assert.strictEqual(run('20 / 5 / 2'), 2);
  assert.strictEqual(run('7 % 4'), 3);
});

test('^ is right-associative and binds tighter than unary minus', function () {
  assert.strictEqual(run('2 ^ 3 ^ 2'), 512);
  assert.strictEqual(run('-2 ^ 2'), -4);
  assert.strictEqual(run('2 ^ -1'), 0.5);
});

test('and binds tighter than or; not binds to the next value only', function () {
  assert.strictEqual(run('true or false and false'), true);
  assert.strictEqual(run('(true or false) and false'), false);
  // (not a) = b — the documented trap; not (a = b) is how to write the other.
  assert.strictEqual(run('not a = b', { a: false, b: true }), true);
  assert.strictEqual(run('not (a = b)', { a: false, b: true }), true);
  assert.strictEqual(run('not (a = b)', { a: 1, b: 1 }), false);
});

test('? : and if() are the same thing, and nest', function () {
  assert.strictEqual(run('score >= 90 ? "A" : score >= 80 ? "B" : "C"', { score: 85 }), 'B');
  assert.strictEqual(run('if(score >= 90, "A", if(score >= 80, "B", "C"))', { score: 95 }), 'A');
  assert.deepStrictEqual(xf.parse('a ? 1 : 2'), xf.parse('if(a, 1, 2)'));
});

// ── operators ──
test('+ adds as numbers, || joins as text', function () {
  assert.strictEqual(run('a + b', { a: '2', b: 3 }), 5);
  assert.strictEqual(run('a || "-" || b', { a: 'x', b: 1 }), 'x-1');
});

test('equality is forgiving whichever way it is spelled', function () {
  ['=', '=='].forEach(function (eq) {
    assert.strictEqual(run('a ' + eq + ' 18', { a: '18' }), true, eq);
    assert.strictEqual(run('a ' + eq + ' null', { a: null }), true, eq);
    assert.strictEqual(run('a ' + eq + ' null', {}), true, eq + ' on a missing name');
  });
  ['!=', '<>'].forEach(function (ne) {
    assert.strictEqual(run('a ' + ne + ' 18', { a: 19 }), true, ne);
    assert.strictEqual(run('a ' + ne + ' 18', { a: '18' }), false, ne);
  });
  assert.strictEqual(xf.parse('a = 1').op, 'eq');            // the 1.x shape Workflow stores
  assert.strictEqual(xf.parse('a <> 1').op, 'neq');
});

test('< > order numbers and ISO dates; nothing is never less or greater', function () {
  assert.strictEqual(run('a < 10', { a: 9 }), true);
  assert.strictEqual(run('d >= "2026-01-01"', { d: '2026-03-05' }), true);
  assert.strictEqual(run('a < 100', { a: null }), false);
  assert.strictEqual(run('a > 100', {}), false);
  assert.strictEqual(run('not (a < 100)', { a: null }), true);
});

test('in (…) with a list', function () {
  assert.strictEqual(run('status in ("paid", "refunded")', { status: 'paid' }), true);
  assert.strictEqual(run('status in ("paid", "refunded")', { status: 'open' }), false);
  assert.strictEqual(run('n in (1, 2, 3)', { n: '2' }), true);             // forgiving, like =
  assert.strictEqual(run('tag in tags', { tag: 'b', tags: ['a', 'b'] }), true);
  assert.strictEqual(run('tag in tags', { tag: 'b', tags: null }), false);
});

// ── literals ──
test('numbers, text, escapes, constants', function () {
  assert.strictEqual(run('.5 + 1e2'), 100.5);
  assert.strictEqual(run('"say ""hi"""'), 'say "hi"');          // doubled quote (1.x)
  assert.strictEqual(run('"say \\"hi\\""'), 'say "hi"');        // backslash (expr-eval)
  assert.strictEqual(run("'it''s'"), "it's");
  assert.strictEqual(run('"a\\nb"'), 'a\nb');
  assert.strictEqual(run('"a, (b)"'), 'a, (b)');                // commas and brackets in text
  assert.strictEqual(run('TRUE and True'), true);                // keywords ignore case
  assert.strictEqual(run('null'), null);
});

// ── names ──
test('bare names, dotted paths, and any name in brackets', function () {
  var row = { revenue: 10, form: { country: 'IN', 'first name': 'Ada' }, 'order month': 'Aug', '2024 sales': 7, and: 'kw', 'form.country': 'flat' };
  assert.strictEqual(run('revenue', row), 10);
  assert.strictEqual(run('form.country', row), 'IN');
  assert.strictEqual(run('form.[first name]', row), 'Ada');
  assert.strictEqual(run('form[first name]', row), 'Ada');
  assert.strictEqual(run('[order month]', row), 'Aug');
  assert.strictEqual(run('[2024 sales] * 2', row), 14);
  assert.strictEqual(run('[and]', row), 'kw');
  assert.strictEqual(run('[form.country]', row), 'flat');         // one key, not a path
  assert.strictEqual(run('[a]]b]', { 'a]b': 1 }), 1);             // ]] is a ]
  assert.strictEqual(run('café', { 'café': 3 }), 3);
});

test('a name followed by ( is a function; a bare name is a column', function () {
  var row = { month: 'x', d: '2024-06-17', year: 2024, round: 4 };
  assert.strictEqual(run('month', row), 'x');
  assert.strictEqual(run('month(d)', row), 6);
  assert.strictEqual(run('year + 1', row), 2025);
  assert.strictEqual(run('round * 2', row), 8);
  assert.strictEqual(run('UPPER("a")'), 'A');                     // names ignore case
});

test('a missing name is nothing — or an error when asked', function () {
  assert.strictEqual(run('missing'), null);
  assert.strictEqual(run('a.b.c', { a: {} }), null);
  var strict = xf.compile('revnue - cost', { missing: 'error' });
  assert.throws(function () { strict({ revenue: 1, cost: 1 }); }, /Unknown column "revnue"/);
  // present but null is a value, not a missing column
  assert.strictEqual(xf.compile('x', { missing: 'error' })({ x: null }), null);
});

test('$thisrow reads the row the formula is for', function () {
  assert.deepStrictEqual(xf.parse('$thisrow.city'), { thisrow: ['city'] });
  assert.deepStrictEqual(xf.parse('$thisrow["order month"]'), { thisrow: ['order month'] });
  assert.deepStrictEqual(xf.parse('$thisrow.[order month]'), { thisrow: ['order month'] });
});

// ── errors say where ──
test('errors name the problem and the position', function () {
  assert.match(errorOf('if(a, b)'), /if\(\) takes 3 arguments, not 2 at character 1/);
  assert.match(errorOf('upper(a'), /Expected "\)" but found the end of the formula at character 8/);
  assert.match(errorOf('revenue +'), /Expected a value/);
  assert.match(errorOf('a = b)'), /Unexpected "\)" at character 6/);
  assert.match(errorOf('foo(1)'), /Unknown function "foo" at character 1/);
  assert.match(errorOf('"open'), /Text is never closed/);
  assert.match(errorOf('[open'), /Column name is never closed/);
  assert.match(errorOf('a # b'), /Unexpected character "#" at character 3/);
  assert.match(errorOf('!a'), /Use "not"/);
  assert.match(errorOf('x in [1, 2]'), /Lists are written in parentheses/);
  assert.match(errorOf('a and'), /Expected a value/);
  assert.match(errorOf('in + 1'), /keyword/);
  assert.match(errorOf(''), /empty/);
  assert.strictEqual(xf.check('upper(a').position, 7);
});

test('check() never throws and returns the tree', function () {
  var ok = xf.check('revenue - cost');
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.tree, { op: '-', left: { field: 'revenue' }, right: { field: 'cost' } });
  assert.strictEqual(xf.check(')').ok, false);
});

// ── what a formula can never reach ──
test('prototype paths are refused, in text and in stored trees', function () {
  ['a.__proto__', '[__proto__]', 'constructor', 'a.prototype', '$thisrow.constructor'].forEach(function (t) {
    assert.match(errorOf(t), /can't be used as a column name/, t);
  });
  assert.throws(function () { xf.compile({ path: ['__proto__', 'polluted'] }); }, /can't be used/);
  assert.throws(function () { xf.compile({ field: 'a.constructor' }); }, /can't be used/);
});

test('a value is never called, and inherited functions read as nothing', function () {
  var called = false;
  var row = { f: function () { called = true; return 'ran'; } };
  assert.strictEqual(run('f', row), null);
  assert.strictEqual(called, false);
  assert.strictEqual(run('toString'), null);                     // Object.prototype.toString
  assert.strictEqual(run('valueOf + 1'), 1);
  // Only listed functions can be called — never something named in the row.
  assert.match(errorOf('f()'), /Unknown function "f"/);
});

test('formulas cannot assign', function () {
  var row = { city: 'Delhi' };
  assert.strictEqual(run('city = "Mumbai"', row), false);       // equality, not assignment
  assert.strictEqual(row.city, 'Delhi');
});

// ── tree → text ───────────────────────────────────────────────────────────
test('toText writes the language back, and parses to the same tree', function () {
  [
    'a = 1 and upper(b) = "X"',
    'revenue - cost',
    '(a + b) * c',
    'a - (b - c)',
    '2 ^ 3 ^ 2',
    '-a * b',
    'not (a = b)',
    'a = 1 or b = 2 and c = 3',
    '(a = 1 or b = 2) and c = 3',
    'if(score >= 90, "A", if(score >= 80, "B", "C"))',
    'status in ("paid", "refunded")',
    'form.[first name] || "-" || [order month]',
    'sumif(orders, city = $thisrow.city, revenue)',
    '[2024 sales] + [a]]b]',
    'monthname(order_date) = "May"',
    'x != null'
  ].forEach(function (text) {
    var tree = xf.parse(text);
    var back = xf.toText(tree);
    assert.deepStrictEqual(xf.parse(back), tree, text + '  →  ' + back);
  });
});

test('toText writes 1.x conditions as formulas too', function () {
  assert.strictEqual(xf.toText({ left: { field: 'age' }, op: 'gte', right: { value: 18 } }), 'age >= 18');
  assert.strictEqual(xf.toText({ left: { fn: 'upper', field: 'name' }, op: 'eq', right: { value: 'ADA' } }), 'upper(name) = "ADA"');
  assert.strictEqual(xf.toText({ left: { field: 'note' }, op: 'contains', right: { value: 'x' } }), 'contains(note, "x")');
  assert.strictEqual(xf.toText({ left: { field: 'score' }, op: 'between', right: { value: [1, 10] } }), 'between(score, 1, 10)');
  assert.strictEqual(xf.toText({ left: { field: 'status' }, op: 'isNull' }), 'isNull(status)');
  // …and what it writes still compiles.
  assert.strictEqual(xf.compile(xf.toText({ left: { field: 'score' }, op: 'between', right: { value: [1, 10] } }))({ score: 5 }), true);
});
