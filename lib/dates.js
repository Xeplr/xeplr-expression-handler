// Date coercion for the date functions — one place, rather than each function
// guessing. Moved from BI's report-engine (formulaFunctions.js) unchanged in
// behaviour: BI's saved reports depend on it.
//
// Dates arrive as strings, Date objects, or timestamps depending on the
// driver. A date-only string "2026-05-01" is built from its parts as LOCAL
// midnight — the spec parses it as UTC midnight, and every reader here
// (getFullYear, getMonth, …) works in local time, so west of UTC the 1st of a
// month would read as the last day of the one before. Built from parts, which
// is also what a database driver does for a DATE column, the browser and the
// server agree whatever the time zone.

var DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// A streamed report repeats the same date strings row after row; parsing each
// once is most of the cost of a date function. Bounded so a stream of unique
// timestamps can't grow it without limit. Callers only READ the Dates.
var cache = new Map();
var CACHE_MAX = 512;

function parseDate(v) {
  var parts = DATE_ONLY.exec(v.trim());
  if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function asDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    var hit = cache.get(v);
    if (hit !== undefined) return hit;
    var d = parseDate(v);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(v, d);
    return d;
  }
  var t = new Date(v);
  return isNaN(t.getTime()) ? null : t;
}

// YYYY-MM-DD in LOCAL time. Not toISOString(), which converts to UTC first —
// with dates parsed as local midnight that shifts the answer a day.
function isoLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MS_PER_DAY = 86400000;

// "Today" for ytd / fytd, per run context. A pinned `today` is fixed; the live
// one is recomputed at most once a minute rather than per row — these run
// inside accumulation loops over millions of rows.
// Returns now() → { year, end, fyStart }.
function todayFor(context) {
  var fyMonth = (context.fiscalYearStart || 4) - 1;
  if (context.today !== undefined && context.today !== null) {
    var d = asDate(context.today);
    if (!d) throw new Error('context.today is not a date: ' + JSON.stringify(context.today));
    // A pinned day covers all of it, so its own timestamps count as "so far".
    var pinned = build(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999), fyMonth);
    return function () { return pinned; };
  }
  var live = null;
  var at = 0;
  return function () {
    var t = Date.now();
    if (live && t - at < 60000) return live;
    at = t;
    live = build(new Date(t), fyMonth);
    return live;
  };
}

function build(end, fyMonth) {
  var year = end.getFullYear();
  // The financial year containing today began this calendar year only if we
  // are already past its start month.
  var fyStart = new Date(end.getMonth() >= fyMonth ? year : year - 1, fyMonth, 1);
  return { year: year, end: end, fyStart: fyStart };
}

module.exports = { asDate: asDate, isoLocal: isoLocal, todayFor: todayFor, MONTH_NAMES: MONTH_NAMES, WEEKDAYS: WEEKDAYS, MS_PER_DAY: MS_PER_DAY };
