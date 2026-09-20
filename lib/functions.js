// The ONE function list — every function a formula can call, with the words
// the UI shows for it. BI's reference panel, autocomplete and validation and
// Workflow's condition picker are all built from this; adding a function is
// adding one entry here.
//
// Moved from BI's report-engine/formulaFunctions.js; its implementations and
// their behaviour are unchanged (BI's saved reports depend on them). The 1.x
// functions merged in: weekday, between. 1.x's monthNum is now month.
//
// EVERY FUNCTION IS TOTAL — nonsense in, null out, never an exception. The
// engine only evaluates the branch an if() takes, but a function can still see
// a missing value or a column holding text where a number was expected, and a
// report must show an empty cell there, not fail.
//
// Entry shape:
//   name, category, args, description, example   what the UI shows
//   fn          the implementation
//   min / max   how many arguments it takes (max: Infinity = any number)
//   context     fn receives the run context first: fn(ctx, …args)
//   volatile    its answer depends on more than its arguments (the date), so
//               it is never folded to a constant at compile time
//   aggregate   spans rows — compiled by the engine, see compile.js
//   special     syntax rather than a function (if, $thisrow) — listed so the
//               reference shows it, compiled by the engine

var dates = require('./dates');
var asDate = dates.asDate;

var CATEGORIES = ['Math', 'Text', 'Date', 'Logic', 'Aggregate'];

function str(v) { return v === null || v === undefined ? '' : String(v); }
function num(v) { var n = Number(v); return isNaN(n) ? null : n; }
function isEmpty(v) { return v === null || v === undefined || v === ''; }
function math(f) { return function (v) { var n = num(v); return n === null ? null : f(n); }; }
function minMax(pick) {
  return function () {
    var vals = arguments.length === 1 && Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
    if (!vals.length) return null;
    var out = null;
    for (var i = 0; i < vals.length; i++) {
      var n = num(vals[i]);
      if (n === null) return null;
      out = out === null ? n : pick(out, n);
    }
    return out;
  };
}

var LIST = [
  // ── Math ──
  { name: 'round', category: 'Math', args: 'value, places', min: 1, max: 2,
    description: 'Round to a number of decimal places', example: 'round(amount, 2)',
    // Nothing rounds to 0, not null — Number(null) is 0, the coercion the rest
    // of the engine uses (`revenue - missing` is revenue). Text that isn't a
    // number is null, not NaN.
    fn: function (v, places) {
      var n = num(v);
      if (n === null) return null;
      var p = Math.pow(10, Number(places) || 0);
      return Math.round(n * p) / p;
    } },
  { name: 'abs', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Distance from zero, ignoring sign', example: 'abs(variance)', fn: math(Math.abs) },
  { name: 'ceil', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Round up to a whole number', example: 'ceil(days)', fn: math(Math.ceil) },
  { name: 'floor', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Round down to a whole number', example: 'floor(days)', fn: math(Math.floor) },
  { name: 'sqrt', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Square root', example: 'sqrt(area)', fn: math(Math.sqrt) },
  { name: 'min', category: 'Math', args: 'a, b, …', min: 1, max: Infinity,
    description: 'Smallest of the values given — not across rows', example: 'min(price, cap)',
    fn: minMax(function (a, b) { return b < a ? b : a; }) },
  { name: 'max', category: 'Math', args: 'a, b, …', min: 1, max: Infinity,
    description: 'Largest of the values given — not across rows', example: 'max(price, floor_price)',
    fn: minMax(function (a, b) { return b > a ? b : a; }) },
  // expr-eval shipped these unlisted, so saved formulas may use them.
  // log is the NATURAL log there (not Excel's base 10), kept for that reason.
  { name: 'trunc', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Drop the decimals, toward zero', example: 'trunc(hours)', fn: math(Math.trunc) },
  { name: 'exp', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'e raised to the value', example: 'exp(rate)', fn: math(Math.exp) },
  { name: 'ln', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Natural logarithm', example: 'ln(growth)', fn: math(Math.log) },
  { name: 'log', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Natural logarithm — the same as ln, not base 10', example: 'log(growth)', fn: math(Math.log) },
  { name: 'log10', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Base-10 logarithm', example: 'log10(size)', fn: math(Math.log10) },
  { name: 'log2', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Base-2 logarithm', example: 'log2(size)', fn: math(Math.log2) },
  { name: 'cbrt', category: 'Math', args: 'value', min: 1, max: 1,
    description: 'Cube root', example: 'cbrt(volume)', fn: math(Math.cbrt) },
  { name: 'pow', category: 'Math', args: 'value, exponent', min: 2, max: 2,
    description: 'Raise to a power', example: 'pow(rate, years)',
    fn: function (v, e) { var a = num(v), b = num(e); return a === null || b === null ? null : Math.pow(a, b); } },

  // ── Text ──
  // Text of nothing is empty, never the word "null" — that would show in a report.
  { name: 'upper', category: 'Text', args: 'text', min: 1, max: 1,
    description: 'Convert to upper case', example: 'upper(city)', fn: function (v) { return str(v).toUpperCase(); } },
  { name: 'lower', category: 'Text', args: 'text', min: 1, max: 1,
    description: 'Convert to lower case', example: 'lower(email)', fn: function (v) { return str(v).toLowerCase(); } },
  { name: 'trim', category: 'Text', args: 'text', min: 1, max: 1,
    description: 'Remove leading and trailing spaces', example: 'trim(name)', fn: function (v) { return str(v).trim(); } },
  { name: 'concat', category: 'Text', args: 'a, b, …', min: 0, max: Infinity,
    description: 'Join values into one piece of text', example: 'concat(first, " ", last)',
    fn: function () { var s = ''; for (var i = 0; i < arguments.length; i++) s += str(arguments[i]); return s; } },
  // 1-based, like every spreadsheet — a report author is not a programmer.
  { name: 'substring', category: 'Text', args: 'text, start, count', min: 2, max: 3,
    description: 'Part of a value, counting from 1', example: 'substring(code, 1, 3)',
    fn: function (v, start, count) {
      var s = str(v);
      var from = Math.max(0, (Number(start) || 1) - 1);
      return count === undefined ? s.slice(from) : s.slice(from, from + (Number(count) || 0));
    } },
  { name: 'left', category: 'Text', args: 'text, count', min: 2, max: 2,
    description: 'First few characters', example: 'left(deptCode, 3)',
    fn: function (v, count) { return str(v).slice(0, Number(count) || 0); } },
  { name: 'right', category: 'Text', args: 'text, count', min: 2, max: 2,
    description: 'Last few characters', example: 'right(invoice, 4)',
    fn: function (v, count) { var n = Number(count) || 0; return n <= 0 ? '' : str(v).slice(-n); } },
  { name: 'replace', category: 'Text', args: 'text, find, replace with', min: 3, max: 3,
    description: 'Swap one piece of text for another', example: 'replace(phone, "-", "")',
    fn: function (v, find, into) { return str(v).split(str(find)).join(str(into)); } },
  { name: 'contains', category: 'Text', args: 'text, find', min: 2, max: 2,
    description: 'True when the text contains it', example: 'contains(notes, "urgent")',
    fn: function (v, sub) { return str(v).indexOf(str(sub)) !== -1; } },
  { name: 'startsWith', category: 'Text', args: 'text, find', min: 2, max: 2,
    description: 'True when the text begins with it', example: 'startsWith(sku, "IN")',
    fn: function (v, sub) { return str(v).startsWith(str(sub)); } },
  { name: 'endsWith', category: 'Text', args: 'text, find', min: 2, max: 2,
    description: 'True when the text ends with it', example: 'endsWith(file, ".pdf")',
    fn: function (v, sub) { return str(v).endsWith(str(sub)); } },
  { name: 'length', category: 'Text', args: 'text', min: 1, max: 1,
    description: 'How many characters', example: 'length(name)',
    fn: function (v) { return Array.isArray(v) ? v.length : str(v).length; } },

  // ── Date ── (local time; a date-only string is that calendar day — see dates.js)
  { name: 'year', category: 'Date', args: 'date', min: 1, max: 1,
    description: 'The year, as a number', example: 'year(order_date)',
    fn: function (v) { var d = asDate(v); return d ? d.getFullYear() : null; } },
  { name: 'month', category: 'Date', args: 'date', min: 1, max: 1,
    description: 'The month, 1–12', example: 'month(order_date)',
    fn: function (v) { var d = asDate(v); return d ? d.getMonth() + 1 : null; } },
  { name: 'day', category: 'Date', args: 'date', min: 1, max: 1,
    description: 'Day of the month', example: 'day(order_date)',
    fn: function (v) { var d = asDate(v); return d ? d.getDate() : null; } },
  { name: 'quarter', category: 'Date', args: 'date', min: 1, max: 1,
    description: 'The quarter, 1–4', example: 'quarter(order_date)',
    fn: function (v) { var d = asDate(v); return d ? Math.floor(d.getMonth() / 3) + 1 : null; } },
  { name: 'weekday', category: 'Date', args: 'date', min: 1, max: 1,
    description: 'The day of the week by name', example: 'weekday(order_date)',
    fn: function (v) { var d = asDate(v); return d ? dates.WEEKDAYS[d.getDay()] : null; } },
  { name: 'datediff', category: 'Date', args: 'from, to', min: 2, max: 2,
    description: 'Whole days between two dates', example: 'datediff(ordered, shipped)',
    // Later minus earlier.
    fn: function (a, b) {
      var from = asDate(a), to = asDate(b);
      if (!from || !to) return null;
      return Math.round((to.getTime() - from.getTime()) / dates.MS_PER_DAY);
    } },
  { name: 'dateadd', category: 'Date', args: 'date, days', min: 2, max: 2,
    description: 'Move a date by a number of days', example: 'dateadd(order_date, 30)',
    // Built from calendar parts, not by adding milliseconds, so a DST boundary
    // can't turn "+1 day" into 23 or 25 hours and land on the wrong date.
    fn: function (v, days) {
      var d = asDate(v);
      if (!d) return null;
      return dates.isoLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + (Number(days) || 0)));
    } },
  { name: 'monthname', category: 'Date', args: 'date or month number', min: 1, max: 1,
    description: 'The month by name. Reads well, but sorts alphabetically — group by monthkey instead', example: 'monthname(order_date)',
    // A number is always a month, never an epoch timestamp — monthname(13)
    // must not read as 13ms after 1970 and answer "January".
    fn: function (v) {
      if (typeof v === 'number') return v >= 1 && v <= 12 ? dates.MONTH_NAMES[v - 1] : null;
      var d = asDate(v);
      return d ? dates.MONTH_NAMES[d.getMonth()] : null;
    } },
  // Grouping KEYS: they sort correctly as text ("2024-06" before "2024-10"),
  // which is what makes them safe to pivot or group on, unlike monthname.
  { name: 'monthkey', category: 'Date', args: 'date', min: 1, max: 1,
    description: 'The month as 2024-06 — sorts chronologically, so group or pivot by this', example: 'monthkey(order_date)',
    fn: function (v) { var d = asDate(v); return d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') : null; } },
  { name: 'quarterkey', category: 'Date', args: 'date', min: 1, max: 1,
    description: 'The quarter as 2024-Q2 — sorts chronologically', example: 'quarterkey(order_date)',
    fn: function (v) { var d = asDate(v); return d ? d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1) : null; } },
  { name: 'daykey', category: 'Date', args: 'date', min: 1, max: 1,
    description: 'The day as 2024-06-17 — sorts chronologically', example: 'daykey(order_date)',
    fn: function (v) { var d = asDate(v); return d ? dates.isoLocal(d) : null; } },
  // Predicates, not date maths — they exist to go inside sumif / countif. Both
  // ends matter: a date later this year is NOT year-to-date. False, not null,
  // on nothing — the honest answer, and it composes with `not`.
  { name: 'ytd', category: 'Date', args: 'date', min: 1, max: 1, context: true, volatile: true,
    description: 'True when the date is in this calendar year, up to today. Pair it with sumif', example: 'ytd(order_date)',
    fn: function (ctx, v) {
      var d = asDate(v);
      if (!d) return false;
      var now = ctx.now();
      return d.getFullYear() === now.year && d.getTime() <= now.end.getTime();
    } },
  { name: 'fytd', category: 'Date', args: 'date', min: 1, max: 1, context: true, volatile: true,
    description: 'True when the date is in this financial year, up to today. Pair it with sumif', example: 'fytd(order_date)',
    fn: function (ctx, v) {
      var d = asDate(v);
      if (!d) return false;
      var now = ctx.now();
      return d.getTime() >= now.fyStart.getTime() && d.getTime() <= now.end.getTime();
    } },

  // ── Logic ──
  { name: 'if', category: 'Logic', args: 'condition, then, otherwise', min: 3, max: 3, special: true,
    description: 'Choose between two values. Nests freely', example: 'if(qty > 10, "bulk", "single")' },
  // Empty text counts as missing: a database NULL and an empty cell mean the
  // same thing to someone reading a report. Zero does not.
  { name: 'coalesce', category: 'Logic', args: 'a, b, …', min: 1, max: Infinity,
    description: 'First value that is not empty', example: 'coalesce(nickname, name)',
    fn: function () { for (var i = 0; i < arguments.length; i++) if (!isEmpty(arguments[i])) return arguments[i]; return null; } },
  { name: 'ifnull', category: 'Logic', args: 'value, fallback', min: 2, max: 2,
    description: 'Use a fallback when the value is empty', example: 'ifnull(discount, 0)',
    fn: function (v, fallback) { return isEmpty(v) ? fallback : v; } },
  { name: 'isnull', category: 'Logic', args: 'value', min: 1, max: 1,
    description: 'True when the value is empty', example: 'isnull(closed_date)',
    fn: function (v) { return isEmpty(v); } },
  { name: 'between', category: 'Logic', args: 'value, low, high', min: 3, max: 3,
    description: 'True when the value is from low to high, both included', example: 'between(score, 600, 750)',
    // Numbers compare as numbers; anything else as text, which orders ISO
    // dates ("2026-01-31") correctly. Nothing is never between.
    fn: function (v, lo, hi) {
      if (isEmpty(v) || isEmpty(lo) || isEmpty(hi)) return false;
      var x = num(v), a = num(lo), b = num(hi);
      if (x !== null && a !== null && b !== null) return x >= a && x <= b;
      var s = String(v);
      return s >= String(lo) && s <= String(hi);
    } },

  // ── Aggregate ── spans ROWS; compiled by the engine (compile.js).
  // In BI the rows are the current group: sumif(status = "paid", amount).
  // Anywhere else the list comes first:    sumif(orders, status = "paid", amount).
  { name: 'sum', category: 'Aggregate', args: 'value', min: 1, max: 2, aggregate: true, shape: { cond: false, value: true },
    description: 'Total across the rows in this group', example: 'sum(amount)' },
  { name: 'sumif', category: 'Aggregate', args: 'condition, value', min: 2, max: 3, aggregate: true, shape: { cond: true, value: true },
    description: 'Total across the rows that match', example: 'sumif(status == "refunded", amount)' },
  { name: 'countif', category: 'Aggregate', args: 'condition', min: 1, max: 2, aggregate: true, shape: { cond: true, value: false },
    description: 'How many rows match', example: 'countif(qty > 10)' },
  { name: 'countifunique', category: 'Aggregate', args: 'condition, value', min: 2, max: 3, aggregate: true, shape: { cond: true, value: true },
    description: 'How many different values among the rows that match', example: 'countifunique(status == "paid", customer_id)' },
  // Not a function — a reference, usable inside any aggregate's condition.
  { name: '$thisrow.column', category: 'Aggregate', args: '', special: true,
    description: 'This row\'s own value, so a total can cover every row sharing it', example: 'sumif(month == $thisrow.month, revenue)' }
];

// Lookup by lower-cased name. A null-prototype map, so no formula can reach
// Object.prototype through a function name.
var FUNCTIONS = Object.create(null);
LIST.forEach(function (f) { if (!f.special || f.name === 'if') FUNCTIONS[f.name.toLowerCase()] = f; });
// 1.x name, kept so stored 1.x conditions still run. Not listed.
FUNCTIONS.monthnum = Object.assign({}, FUNCTIONS.month, { name: 'monthNum', hidden: true });

function lookup(name) {
  return FUNCTIONS[String(name).toLowerCase()] || null;
}

// registerFunction(entry)  or, as in 1.x, registerFunction(name, fn).
function registerFunction(entryOrName, fn) {
  var entry = typeof entryOrName === 'string'
    ? { name: entryOrName, fn: fn, category: 'Custom', args: '', description: '', example: '' }
    : Object.assign({}, entryOrName);
  if (!entry.name || typeof entry.fn !== 'function') throw new Error('registerFunction: needs a name and a function');
  if (entry.min === undefined) entry.min = 0;
  if (entry.max === undefined) entry.max = Infinity;
  var key = entry.name.toLowerCase();
  if (FUNCTIONS[key] && (FUNCTIONS[key].special || FUNCTIONS[key].aggregate)) {
    throw new Error('registerFunction: "' + entry.name + '" is built into the language');
  }
  var at = LIST.findIndex(function (f) { return f.name.toLowerCase() === key; });
  if (at === -1) LIST.push(entry); else LIST[at] = entry;
  FUNCTIONS[key] = entry;
}

/** The list the UI renders: every visible entry, in reference order. */
function listFunctions() {
  return LIST.filter(function (f) { return !f.hidden; });
}

module.exports = { FUNCTIONS: FUNCTIONS, CATEGORIES: CATEGORIES, lookup: lookup, registerFunction: registerFunction, listFunctions: listFunctions, str: str, num: num, isEmpty: isEmpty };
