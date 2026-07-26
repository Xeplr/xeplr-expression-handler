// Field functions — applied to an operand's resolved value before the operator
// runs. Level 1: a function takes one value and returns one value.
//
// Dates use UTC getters (xeplr stores datetimes as UTC), and month/weekday
// return English names so `month(dateField) eq 'January'` reads naturally.
// null/invalid input → null (so the downstream comparison simply fails rather
// than throwing).

var MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toDate(v) {
  if (v === null || v === undefined) return null;
  var d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function nil(v) { return v === null || v === undefined; }

var FUNCTIONS = {
  // ── string ──
  upper:  function (v) { return nil(v) ? null : String(v).toUpperCase(); },
  lower:  function (v) { return nil(v) ? null : String(v).toLowerCase(); },
  trim:   function (v) { return nil(v) ? null : String(v).trim(); },
  length: function (v) { return nil(v) ? null : String(v).length; },

  // ── date (UTC) ──
  month:   function (v) { var d = toDate(v); return d ? MONTHS[d.getUTCMonth()] : null; },      // 'January'
  monthNum:function (v) { var d = toDate(v); return d ? d.getUTCMonth() + 1 : null; },           // 1–12
  year:    function (v) { var d = toDate(v); return d ? d.getUTCFullYear() : null; },
  day:     function (v) { var d = toDate(v); return d ? d.getUTCDate() : null; },                // 1–31
  quarter: function (v) { var d = toDate(v); return d ? Math.floor(d.getUTCMonth() / 3) + 1 : null; }, // 1–4
  weekday: function (v) { var d = toDate(v); return d ? WEEKDAYS[d.getUTCDay()] : null; }         // 'Monday'
};

function registerFunction(name, fn) {
  if (typeof fn !== 'function') throw new Error('registerFunction: fn must be a function');
  FUNCTIONS[name] = fn;
}

function applyFunction(name, value) {
  var fn = FUNCTIONS[name];
  if (!fn) throw new Error('Unknown function: "' + name + '"');
  return fn(value);
}

module.exports = { FUNCTIONS, registerFunction, applyFunction };
