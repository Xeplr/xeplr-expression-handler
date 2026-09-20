// JSON tree → a plain JavaScript function, built ONCE and then run per row.
//
// Every node becomes a closure (row, top) → value, with everything that can
// be settled up front settled here:
//   • names — `revenue` becomes "read row.revenue", `upper` a direct
//     reference; running a row looks nothing up and allocates nothing
//   • constants — any part whose inputs are all fixed (`upper("pune")`,
//     `-5`, `2 * 3`) is worked out now and becomes that value
//   • short-circuit — if / ? : / and / or run only what they need
//
// `row` is what names read; `top` is the row the formula is being worked out
// for — the same object except inside a list total, where names read the list
// item and $thisrow still reads `top`.
//
// Operators behave as expr-eval's did (BI's saved formulas depend on it) —
// `+` adds as numbers, `||` joins as text, `and` / `or` give true / false —
// with two deliberate changes: equality is forgiving (18 = "18"; it is the 1.x
// `eq`, which Workflow's conditions already use), and comparing nothing with
// < > is false. The 1.x word operators (eq, gt, contains, …) keep their 1.x
// meaning — see operators.js.

var functions = require('./functions');
var operators = require('./operators');
var dates = require('./dates');
var BLOCKED = require('./parse').BLOCKED;

var DEFAULTS = {
  fiscalYearStart: 4,     // April
  today: null,            // pinned date for ytd / fytd; null = now
  missing: 'null',        // a name the row doesn't have: 'null' or 'error'
  maxListItems: 10000,    // items in one list a total runs over
  maxDistinct: 1000000,   // distinct values one countifunique may hold
  maxSteps: 10000000,     // list items visited in one evaluation
  maxLevels: 2            // totals inside totals
};

function konst(v) {
  var f = function () { return v; };
  f.isConst = true;
  f.value = v;
  return f;
}

function fail(message) { throw new Error(message); }

function compileTree(tree, options) {
  var opts = Object.assign({}, DEFAULTS, options || {});
  if (opts.missing !== 'null' && opts.missing !== 'error') fail('missing must be "null" or "error"');
  var fy = Number(opts.fiscalYearStart);
  if (!(fy >= 1 && fy <= 12 && Math.floor(fy) === fy)) fail('fiscalYearStart must be a month, 1–12');

  var ctx = { now: dates.todayFor(opts), fiscalYearStart: fy };
  // Shared by every closure of this formula: how many list items one
  // evaluation has visited. Reset per top-level call.
  var state = { steps: 0 };

  function c(node, level) {
    if (node === null || node === undefined || typeof node !== 'object' || Array.isArray(node)) {
      fail('Not a formula node: ' + JSON.stringify(node));
    }

    // 1.x operand with a function: { field, fn } / { value, fn }
    if (node.fn !== undefined && node.call === undefined) {
      var bare = Object.assign({}, node);
      delete bare.fn;
      return callOf(node.fn, [c(bare, level)]);
    }

    if (Object.prototype.hasOwnProperty.call(node, 'value')) return konst(node.value);
    if (node.field !== undefined) return getter(String(node.field).split('.'), false);
    if (node.path !== undefined) return getter(node.path, false);
    if (node.thisrow !== undefined) return getter(node.thisrow, true);
    if (node.list !== undefined) return listOf(node.list.map(function (n) { return c(n, level); }));
    if (node.if !== undefined) return ifOf(c(node.if, level), c(node.then, level), c(node.else, level));
    if (node.all !== undefined) return allOf(node.all.map(function (n) { return c(n, level); }));
    if (node.any !== undefined) return anyOf(node.any.map(function (n) { return c(n, level); }));
    if (node.not !== undefined) return unary(c(node.not, level), function (a) { return !a; });
    if (node.neg !== undefined) return unary(c(node.neg, level), function (a) { return -a; });
    if (node.pos !== undefined) return unary(c(node.pos, level), Number);
    if (node.call !== undefined) {
      var entry = functions.lookup(node.call);
      if (entry && entry.aggregate) return aggregateOf(entry, node.args || [], level);
      return callOf(node.call, (node.args || []).map(function (n) { return c(n, level); }));
    }
    if (node.op !== undefined) return opOf(node, level);
    fail('Not a formula node: ' + JSON.stringify(node));
  }

  // ── names ──────────────────────────────────────────────────────────────
  function getter(segs, fromTop) {
    if (!Array.isArray(segs) || !segs.length) fail('A path needs at least one name');
    segs.forEach(function (s) {
      if (typeof s !== 'string' && typeof s !== 'number') fail('A path is made of names');
      if (BLOCKED.has(String(s))) fail('"' + s + '" can\'t be used as a column name');
    });
    var strict = opts.missing === 'error';
    var label = segs.join('.');

    // A row's own value only: a function found on it (a name like `toString`
    // reaching the prototype) reads as nothing. Values are never called.
    function read(obj, key) {
      if (obj === null || obj === undefined || typeof obj !== 'object') return null;
      var v = obj[key];
      if (v === undefined) {
        if (strict && !(key in obj)) fail('Unknown column "' + label + '"');
        return null;
      }
      return typeof v === 'function' ? null : v;
    }

    if (segs.length === 1) {
      var k = segs[0];
      return fromTop
        ? function (row, top) { return read(top, k); }
        : function (row) { return read(row, k); };
    }
    return function (row, top) {
      var v = fromTop ? top : row;
      for (var i = 0; i < segs.length; i++) {
        v = read(v, segs[i]);
        if (v === null) return null;
      }
      return v;
    };
  }

  // ── functions ──────────────────────────────────────────────────────────
  function callOf(name, args) {
    var entry = functions.lookup(name);
    if (!entry || entry.special) fail('Unknown function "' + name + '"');
    if (entry.aggregate) fail(entry.name + '() must be written as a call, not a { fn } operand');
    if (args.length < entry.min || args.length > entry.max) fail(entry.name + '() takes ' + entry.min + (entry.max === entry.min ? '' : '–' + entry.max) + ' arguments, not ' + args.length);
    var fn = entry.fn;
    if (entry.context) {
      var inner = fn;
      fn = function () { var a = [ctx]; for (var i = 0; i < arguments.length; i++) a.push(arguments[i]); return inner.apply(null, a); };
    }
    if (!entry.volatile && args.every(function (a) { return a.isConst; })) {
      return konst(fn.apply(null, args.map(function (a) { return a.value; })));
    }
    // Fixed shapes for the common arities, so a call allocates no array.
    var a0 = args[0], a1 = args[1], a2 = args[2];
    switch (args.length) {
      case 0: return function () { return fn(); };
      case 1: return function (r, t) { return fn(a0(r, t)); };
      case 2: return function (r, t) { return fn(a0(r, t), a1(r, t)); };
      case 3: return function (r, t) { return fn(a0(r, t), a1(r, t), a2(r, t)); };
      default: return function (r, t) {
        var vals = new Array(args.length);
        for (var i = 0; i < args.length; i++) vals[i] = args[i](r, t);
        return fn.apply(null, vals);
      };
    }
  }

  // ── operators ──────────────────────────────────────────────────────────
  var SYMBOLS = {
    '+': function (a, b) { return Number(a) + Number(b); },
    '-': function (a, b) { return a - b; },
    '*': function (a, b) { return a * b; },
    '/': function (a, b) { return a / b; },
    '%': function (a, b) { return a % b; },
    '^': function (a, b) { return Math.pow(a, b); },
    '||': function (a, b) { return Array.isArray(a) && Array.isArray(b) ? a.concat(b) : '' + a + b; },
    // Ordering as JavaScript orders (numbers as numbers, ISO dates as text),
    // except that nothing is never less or greater than anything — as in SQL.
    // expr-eval read `null < 100` as true, which sends a branch the wrong way.
    '<': function (a, b) { return a !== null && b !== null && a < b; },
    '<=': function (a, b) { return a !== null && b !== null && a <= b; },
    '>': function (a, b) { return a !== null && b !== null && a > b; },
    '>=': function (a, b) { return a !== null && b !== null && a >= b; },
    // Membership compares like the 1.x `in` (18 matches "18").
    'in': function (a, b) {
      if (!Array.isArray(b)) return false;
      for (var i = 0; i < b.length; i++) if (operators.looseEq(a, b[i])) return true;
      return false;
    }
  };

  function opOf(node, level) {
    var sym = SYMBOLS[node.op];
    if (sym && Object.prototype.hasOwnProperty.call(SYMBOLS, node.op)) {
      if (node.left === undefined || node.right === undefined) fail('"' + node.op + '" needs a left and a right side');
      return binary(c(node.left, level), c(node.right, level), sym);
    }
    // 1.x word operators: { left, op: 'eq' | 'contains' | 'isNull' | …, right }
    var def = Object.prototype.hasOwnProperty.call(operators.OPERATORS, node.op) ? operators.OPERATORS[node.op] : null;
    if (!def) fail('Unknown operator: "' + node.op + '"');
    if (node.left === undefined) fail('missing left operand');
    var left = c(node.left, level);
    if (def.arity === 1) return unary(left, function (a) { return !!def.fn(a); });
    // As 1.x: a missing right side compares against nothing (validate() flags it).
    var right = node.right === undefined || node.right === null ? konst(undefined) : c(node.right, level);
    return binary(left, right, function (a, b) { return !!def.fn(a, b); });
  }

  function unary(a, f) {
    if (a.isConst) return konst(f(a.value));
    return function (r, t) { return f(a(r, t)); };
  }

  function binary(a, b, f) {
    if (a.isConst && b.isConst) return konst(f(a.value, b.value));
    return function (r, t) { return f(a(r, t), b(r, t)); };
  }

  function listOf(items) {
    if (items.every(function (i) { return i.isConst; })) return konst(items.map(function (i) { return i.value; }));
    return function (r, t) { return items.map(function (i) { return i(r, t); }); };
  }

  function ifOf(cond, yes, no) {
    if (cond.isConst) return cond.value ? yes : no;
    return function (r, t) { return cond(r, t) ? yes(r, t) : no(r, t); };
  }

  function allOf(parts) {
    return function (r, t) {
      for (var i = 0; i < parts.length; i++) if (!parts[i](r, t)) return false;
      return true;
    };
  }

  function anyOf(parts) {
    return function (r, t) {
      for (var i = 0; i < parts.length; i++) if (parts[i](r, t)) return true;
      return false;
    };
  }

  // ── totals over rows ─────────────────────────────────────────────────────
  // Two ways to be written:
  //   sumif(status = "paid", amount)           the rows of a group — the caller
  //                                            supplies them (options.aggregate)
  //   sumif(orders, status = "paid", amount)   a list the formula names
  // A list total is one loop over the list: no filtered copy, no list of
  // values — a running number, a count, or a set of distinct values.
  function aggregateOf(entry, args, level) {
    var implicit = (entry.shape.cond ? 1 : 0) + (entry.shape.value ? 1 : 0);
    var inner = level + 1;
    if (inner > opts.maxLevels) fail('A total can hold at most ' + (opts.maxLevels - 1) + ' more total inside it — ' + entry.name + '() is ' + inner + ' levels deep');

    if (args.length === implicit) {
      if (typeof opts.aggregate !== 'function') {
        fail(entry.name + '() adds up the rows of a group. Outside a report, name the list first — ' +
          entry.name + '(orders, ' + (entry.shape.cond ? 'condition' + (entry.shape.value ? ', value' : '') : 'value') + ')');
      }
      return opts.aggregate(entry.name, args, { level: inner, compile: function (n) { return c(n, inner); } });
    }
    if (args.length !== implicit + 1) fail(entry.name + '() takes ' + implicit + ' or ' + (implicit + 1) + ' arguments, not ' + args.length);

    var list = c(args[0], level);
    var cond = entry.shape.cond ? c(args[1], inner) : null;
    var value = entry.shape.value ? c(args[args.length - 1], inner) : null;
    var label = describeList(args[0]);
    var maxItems = opts.maxListItems, maxSteps = opts.maxSteps, maxDistinct = opts.maxDistinct;

    function items(r, t) {
      var arr = list(r, t);
      if (arr === null || arr === undefined) return null;
      if (!Array.isArray(arr)) fail(entry.name + '(): ' + label + ' is not a list');
      if (arr.length > maxItems) fail(label + ' has ' + arr.length + ' items; a total can run over at most ' + maxItems);
      state.steps += arr.length;
      if (state.steps > maxSteps) fail('This formula visited more than ' + maxSteps + ' list items in one evaluation');
      return arr;
    }

    if (entry.name === 'countif') {
      return function (r, t) {
        var arr = items(r, t);
        if (!arr) return 0;
        var n = 0;
        for (var i = 0; i < arr.length; i++) if (cond(arr[i], t)) n++;
        return n;
      };
    }
    if (entry.name === 'countifunique') {
      return function (r, t) {
        var arr = items(r, t);
        if (!arr) return 0;
        var seen = new Set();
        for (var i = 0; i < arr.length; i++) {
          if (!cond(arr[i], t)) continue;
          var v = value(arr[i], t);
          if (v === null || v === undefined) continue;
          seen.add(v);
          if (seen.size > maxDistinct) fail(entry.name + '(): more than ' + maxDistinct + ' different values');
        }
        return seen.size;
      };
    }
    // sum / sumif — values that aren't numbers add nothing.
    return function (r, t) {
      var arr = items(r, t);
      if (!arr) return 0;
      var total = 0;
      for (var i = 0; i < arr.length; i++) {
        if (cond && !cond(arr[i], t)) continue;
        var v = value(arr[i], t);
        if (v === null || v === undefined || v === '') continue;
        var n = Number(v);
        if (!isNaN(n)) total += n;
      }
      return total;
    };
  }

  var run = c(tree, 0);
  var formula = function (row) {
    state.steps = 0;
    return run(row, row);
  };
  formula.isConst = !!run.isConst;
  return formula;
}

function describeList(node) {
  if (node.field !== undefined) return String(node.field);
  if (node.path) return node.path.join('.');
  return 'the list';
}

module.exports = { compileTree: compileTree, DEFAULTS: DEFAULTS };
