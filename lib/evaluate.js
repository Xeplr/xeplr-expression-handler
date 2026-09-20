// The 1.x entry points, now running on the 2.0 compiler. Workflow calls
// evaluate(condition, row) on every arrow, with conditions stored in the 1.x
// { left, op, right } shape — those keep working, and so does any 2.0 tree.

var compileTree = require('./compile').compileTree;

// A tree is compiled once and remembered against the object itself, so a
// stored condition evaluated on every run isn't rebuilt each time.
var compiled = new WeakMap();

function compiledFor(expr) {
  if (!expr || typeof expr !== 'object') throw new Error('expression must be an object');
  var f = compiled.get(expr);
  if (!f) { f = compileTree(expr); compiled.set(expr, f); }
  return f;
}

/** A condition → true / false. */
function evaluate(expr, row) {
  return !!compiledFor(expr)(row);
}

/** Compile once, filter many — drops into Array.filter or a stream. */
function toPredicate(expr) {
  var v = validate(expr);
  if (!v.valid) throw new Error('Invalid expression: ' + v.errors.join('; '));
  var f = compiledFor(expr);
  return function (row) { return !!f(row); };
}

/** Static check without a row → { valid, errors }. */
function validate(expr) {
  var errors = [];
  if (!expr || typeof expr !== 'object') return { valid: false, errors: ['expression must be an object'] };
  // The 1.x shape checks, kept for their messages.
  if (expr.op !== undefined && expr.left !== undefined) {
    ['left', 'right'].forEach(function (side) {
      var o = expr[side];
      if (o && typeof o === 'object' && !Object.prototype.hasOwnProperty.call(o, 'value') &&
        o.field === undefined && o.path === undefined && o.thisrow === undefined && o.call === undefined &&
        o.op === undefined && o.if === undefined && o.all === undefined && o.any === undefined &&
        o.not === undefined && o.neg === undefined && o.pos === undefined && o.list === undefined) {
        errors.push(side + ' operand needs "field" or "value"');
      }
    });
    var ops = require('./operators').OPERATORS;
    var def = Object.prototype.hasOwnProperty.call(ops, expr.op) ? ops[expr.op] : null;
    if (def && def.arity === 2 && (expr.right === undefined || expr.right === null)) {
      errors.push('operator "' + expr.op + '" requires a right operand');
    }
  }
  if (!errors.length) {
    try { compileTree(expr); } catch (err) { errors.push(err.message.charAt(0).toLowerCase() + err.message.slice(1)); }
  }
  return { valid: errors.length === 0, errors: errors };
}

/** 1.x: one operand's value against a row. */
function resolveOperand(operand, row) {
  if (operand === null || operand === undefined) return undefined;
  if (typeof operand !== 'object' || (!Object.prototype.hasOwnProperty.call(operand, 'value') && operand.field == null && operand.path == null)) {
    throw new Error('Invalid operand: needs "field" or "value"');
  }
  return compiledFor(operand)(row);
}

/** 1.x: read a dotted path. */
function getPath(obj, path) {
  if (obj === null || obj === undefined) return undefined;
  if (path.indexOf('.') === -1) return obj[path];
  return path.split('.').reduce(function (o, k) {
    return (o === null || o === undefined) ? undefined : o[k];
  }, obj);
}

module.exports = { evaluate: evaluate, toPredicate: toPredicate, validate: validate, resolveOperand: resolveOperand, getPath: getPath };
