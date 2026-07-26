// Operators — each is a small handler with a fixed arity:
//   arity 2 → fn(left, right)   (eq, gt, contains, between, …)
//   arity 1 → fn(left)          (isNull, isNotNull)
//
// Semantics chosen for filter/rules use, documented per operator:
//   • null-ish (null/undefined) on a numeric/string comparison → false
//     (except isNull/isNotNull, and eq/neq which treat null explicitly).
//   • numeric operators coerce via Number(); non-numeric → NaN → false.
//   • string operators coerce via String().

function isNil(v) { return v === null || v === undefined; }
function num(v) { return typeof v === 'number' ? v : Number(v); }
function str(v) { return isNil(v) ? '' : String(v); }

// Equality that treats null explicitly and compares numbers as numbers,
// everything else as strings (so 18 == '18', 'January' == 'January').
function looseEq(a, b) {
  if (isNil(a) && isNil(b)) return true;
  if (isNil(a) || isNil(b)) return false;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a) === String(b);
}

var OPERATORS = {
  // equality / null — eq/neq against a null value ALSO work as is-null checks
  eq:        { arity: 2, fn: function (a, b) { return looseEq(a, b); } },
  neq:       { arity: 2, fn: function (a, b) { return !looseEq(a, b); } },
  isNull:    { arity: 1, fn: function (a) { return isNil(a); } },
  isNotNull: { arity: 1, fn: function (a) { return !isNil(a); } },

  // numeric
  gt:  { arity: 2, fn: function (a, b) { return num(a) > num(b); } },
  gte: { arity: 2, fn: function (a, b) { return num(a) >= num(b); } },
  lt:  { arity: 2, fn: function (a, b) { return num(a) < num(b); } },
  lte: { arity: 2, fn: function (a, b) { return num(a) <= num(b); } },
  between: {
    arity: 2,
    // right operand is a [lo, hi] pair; inclusive.
    fn: function (a, b) {
      if (!Array.isArray(b) || b.length < 2) return false;
      var x = num(a), lo = num(b[0]), hi = num(b[1]);
      return x >= lo && x <= hi;
    }
  },

  // string
  contains:    { arity: 2, fn: function (a, b) { return str(a).indexOf(str(b)) !== -1; } },
  notContains: { arity: 2, fn: function (a, b) { return str(a).indexOf(str(b)) === -1; } },
  startsWith:  { arity: 2, fn: function (a, b) { return str(a).indexOf(str(b)) === 0; } },
  endsWith:    { arity: 2, fn: function (a, b) { var s = str(a), t = str(b); return t === '' || s.slice(-t.length) === t; } },

  // set membership — right operand is an array
  in:    { arity: 2, fn: function (a, b) { return Array.isArray(b) && b.some(function (x) { return looseEq(a, x); }); } },
  notIn: { arity: 2, fn: function (a, b) { return !(Array.isArray(b) && b.some(function (x) { return looseEq(a, x); })); } }
};

// Friendly aliases for the phrasings a UI/user might send.
OPERATORS.equals        = OPERATORS.eq;
OPERATORS.notEquals     = OPERATORS.neq;
OPERATORS.doesNotContain = OPERATORS.notContains;

function registerOperator(name, def) {
  if (typeof def === 'function') def = { arity: 2, fn: def };
  if (!def || typeof def.fn !== 'function') throw new Error('registerOperator: needs a function or { arity, fn }');
  if (def.arity !== 1 && def.arity !== 2) def.arity = 2;
  OPERATORS[name] = def;
}

module.exports = { OPERATORS, registerOperator, looseEq, num, str, isNil };
