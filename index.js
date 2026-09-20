// @xeplr/expression-handler — the one formula engine for xeplr.
//
//   const xf = require('@xeplr/expression-handler');
//
//   const f = xf.compile('if(country = "India" and score >= 750, "Fast track", "Review")');
//   f({ country: 'India', score: 800 });                       // → 'Fast track'
//
//   xf.parse('revenue - cost')        // → JSON tree, the form that is stored
//   xf.toText(tree)                   // → back to text, for an editor
//   xf.analyze('sum(a) / sum(b)')     // → the fields, functions and totals it uses
//   xf.functions()                    // → the function list, for pickers and help
//
//   // Run context — per tenant / per run:
//   xf.compile('sumif(orders, fytd(date), amount)', { fiscalYearStart: 7 });
//
//   // 1.x conditions still work:
//   xf.evaluate({ left: { field: 'age' }, op: 'gte', right: { value: 18 } }, row);
//
// See README.md for the language, the limits and what changed from 1.x.

var parse = require('./lib/parse').parse;
var compileTree = require('./lib/compile').compileTree;
var DEFAULTS = require('./lib/compile').DEFAULTS;
var analyzeTree = require('./lib/analyze').analyzeTree;
var toText = require('./lib/text').toText;
var fns = require('./lib/functions');
var ops = require('./lib/operators');
var ev = require('./lib/evaluate');
var nlp = require('./lib/nlp');

// ── compile, with a cache ────────────────────────────────────────────────
// Callers that pass formula TEXT per row (rather than compiling once up
// front) still parse each formula once: text → function, keyed by the text
// and the run context, so two tenants with different financial years never
// share a compiled formula. Bounded; cleared if a function is registered.
var CACHE_MAX = 1000;
var textCache = new Map();
var treeCache = new WeakMap();

function contextKey(options) {
  if (!options) return '';
  var keys = Object.keys(options).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    var v = options[keys[i]];
    if (typeof v === 'function') return null;          // a hook — can't be keyed
    parts.push(keys[i] + '=' + JSON.stringify(v));
  }
  return parts.join('&');
}

// The common call — text, no context — looks the text up directly, with no
// key to build: this is the path a caller passing text per row takes.
var plainCache = new Map();

function compile(formula, options) {
  if (typeof formula === 'string' && options === undefined) {
    var plain = plainCache.get(formula);
    if (plain) return plain;
    plain = compileTree(parse(formula));
    if (plainCache.size >= CACHE_MAX) plainCache.clear();
    plainCache.set(formula, plain);
    return plain;
  }
  var key = contextKey(options);
  if (typeof formula === 'string') {
    if (key === null) return compileTree(parse(formula), options);
    var k = key + '\u0000' + formula;
    var hit = textCache.get(k);
    if (hit) return hit;
    var f = compileTree(parse(formula), options);
    if (textCache.size >= CACHE_MAX) textCache.clear();
    textCache.set(k, f);
    return f;
  }
  if (!formula || typeof formula !== 'object') throw new Error('compile: needs formula text or a tree');
  if (key === null) return compileTree(formula, options);
  var byKey = treeCache.get(formula);
  if (!byKey) { byKey = new Map(); treeCache.set(formula, byKey); }
  var got = byKey.get(key);
  if (!got) { got = compileTree(formula, options); byKey.set(key, got); }
  return got;
}

/**
 * name → a ready-to-call implementation, with the run context already bound.
 * For callers that want the FUNCTIONS without the language — BI's dashboard
 * text templates have their own tiny `{{ }}` reader and only need to call
 * `monthname(x)`. Aggregates are absent: they span rows, which a caller
 * outside a formula has none of.
 */
function implementations(options) {
  var ctx = { now: require('./lib/dates').todayFor(options || {}), fiscalYearStart: (options && options.fiscalYearStart) || 4 };
  var out = {};
  fns.listFunctions().forEach(function (f) {
    if (!f.fn || f.aggregate) return;
    out[f.name] = f.context
      ? function () { var a = [ctx]; for (var i = 0; i < arguments.length; i++) a.push(arguments[i]); return f.fn.apply(null, a); }
      : f.fn;
  });
  return out;
}

/** Text or tree → what it uses. */
function analyze(formula) {
  return analyzeTree(typeof formula === 'string' ? parse(formula) : formula);
}

/**
 * Text → { ok, tree, error, position } without throwing — for editors that
 * check as the user types.
 */
function check(text, options) {
  try {
    var tree = parse(text);
    compileTree(tree, options);
    return { ok: true, tree: tree, error: null, position: null };
  } catch (err) {
    return { ok: false, tree: null, error: err.message, position: err.position === undefined ? null : err.position };
  }
}

function registerFunction(entryOrName, fn) {
  fns.registerFunction(entryOrName, fn);
  plainCache.clear();
  textCache.clear();
  treeCache = new WeakMap();
}

module.exports = {
  parse: parse,
  toText: toText,
  compile: compile,
  analyze: analyze,
  check: check,

  // 1.x — a condition → true / false; still what Workflow calls per arrow.
  evaluate: ev.evaluate,
  toPredicate: ev.toPredicate,
  validate: ev.validate,
  resolveOperand: ev.resolveOperand,
  getPath: ev.getPath,

  // 1.x formula namespace, kept as aliases.
  formula: {
    parse: parse,
    compile: function (text, options) { return compile(text, options); },
    evaluate: function (tree, row, options) { return compile(tree, options)(row); }
  },

  functions: fns.listFunctions,
  implementations: implementations,
  CATEGORIES: fns.CATEGORIES,
  registerFunction: registerFunction,

  // 1.x word operators for { left, op, right } conditions.
  OPERATORS: ops.OPERATORS,
  registerOperator: ops.registerOperator,
  operators: function () { return Object.keys(ops.OPERATORS); },

  DEFAULTS: DEFAULTS,

  // Natural-language wrapper — STUB (not implemented yet).
  nlp: nlp
};
