// Evaluate a level-1 structured expression against a data row → boolean.
//
// Expression shape:
//   { left: <operand>, op: <string>, right?: <operand> }
//
// Operand shape (one of):
//   { field: 'name' }               → row.name
//   { field: 'a.b' }                → row.a.b  (dot path)
//   { field: 'name', fn: 'upper' }  → upper(row.name)
//   { value: 42 }                   → literal (string | number | boolean | null | array)
//   { value: [1, 10] }              → literal array (for between / in)
//
// Unary operators (isNull / isNotNull) ignore `right`.
//
//   evaluate({ left:{fn:'month',field:'createdAt'}, op:'eq', right:{value:'January'} }, row)

var { OPERATORS } = require('./operators');
var { FUNCTIONS, applyFunction } = require('./functions');

function getPath(obj, path) {
  if (obj === null || obj === undefined) return undefined;
  if (path.indexOf('.') === -1) return obj[path];
  return path.split('.').reduce(function (o, k) {
    return (o === null || o === undefined) ? undefined : o[k];
  }, obj);
}

// Resolve an operand to a concrete value against the row.
function resolveOperand(operand, row) {
  if (operand === null || operand === undefined) return undefined;
  var v;
  if (Object.prototype.hasOwnProperty.call(operand, 'value')) {
    v = operand.value;
  } else if (operand.field !== null && operand.field !== undefined) {
    v = getPath(row, operand.field);
  } else {
    throw new Error('Invalid operand: needs "field" or "value"');
  }
  if (operand.fn) v = applyFunction(operand.fn, v);
  return v;
}

function evaluate(expr, row) {
  if (!expr || typeof expr !== 'object') throw new Error('expression must be an object');
  var opDef = OPERATORS[expr.op];
  if (!opDef) throw new Error('Unknown operator: "' + expr.op + '"');

  var left = resolveOperand(expr.left, row);
  if (opDef.arity === 1) return !!opDef.fn(left);

  var right = resolveOperand(
    (expr.right === null || expr.right === undefined) ? { value: undefined } : expr.right,
    row
  );
  return !!opDef.fn(left, right);
}

// Compile an expression into a reusable row predicate (validated once up front).
// Drops straight into Array.filter / a streaming .filter(...).
function toPredicate(expr) {
  var v = validate(expr);
  if (!v.valid) throw new Error('Invalid expression: ' + v.errors.join('; '));
  return function (row) { return evaluate(expr, row); };
}

function validateOperand(operand, side, errors) {
  if (operand === null || operand === undefined || typeof operand !== 'object') {
    errors.push(side + ' operand must be an object with "field" or "value"');
    return;
  }
  var hasValue = Object.prototype.hasOwnProperty.call(operand, 'value');
  if (!hasValue && (operand.field === null || operand.field === undefined)) {
    errors.push(side + ' operand needs "field" or "value"');
  }
  if (operand.fn && !FUNCTIONS[operand.fn]) {
    errors.push('unknown function: "' + operand.fn + '"');
  }
}

// Static shape check — returns { valid, errors } without touching a row.
function validate(expr) {
  var errors = [];
  if (!expr || typeof expr !== 'object') return { valid: false, errors: ['expression must be an object'] };

  var opDef = OPERATORS[expr.op];
  if (!opDef) errors.push('unknown operator: "' + expr.op + '"');

  if (expr.left === null || expr.left === undefined) errors.push('missing left operand');
  else validateOperand(expr.left, 'left', errors);

  if (opDef && opDef.arity === 2) {
    if (expr.right === null || expr.right === undefined) {
      errors.push('operator "' + expr.op + '" requires a right operand');
    } else {
      validateOperand(expr.right, 'right', errors);
    }
  }

  return { valid: errors.length === 0, errors: errors };
}

module.exports = { evaluate, toPredicate, validate, resolveOperand, getPath };
