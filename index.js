// @xeplr/expression-handler — level-1 structured expression evaluator.
//
//   const xf = require('@xeplr/expression-handler');
//
//   xf.evaluate(
//     { left: { fn: 'upper', field: 'name' }, op: 'eq', right: { fn: 'upper', field: 'nickName' } },
//     { name: 'ada', nickName: 'ADA' }
//   );                                                  // → true
//
//   const isAdult = xf.toPredicate({ left: { field: 'age' }, op: 'gte', right: { value: 18 } });
//   rows.filter(isAdult);
//
// Extend with your own functions / operators:
//   xf.registerFunction('reverse', v => String(v).split('').reverse().join(''));
//   xf.registerOperator('regex', (a, b) => new RegExp(b).test(a));

var { evaluate, toPredicate, validate, resolveOperand, getPath } = require('./lib/evaluate');
var { OPERATORS, registerOperator } = require('./lib/operators');
var { FUNCTIONS, registerFunction } = require('./lib/functions');
var { parseFormula, evaluateFormula, compileFormula } = require('./lib/formula');
var nlp = require('./lib/nlp');

module.exports = {
  evaluate: evaluate,
  toPredicate: toPredicate,
  validate: validate,
  resolveOperand: resolveOperand,
  getPath: getPath,

  // Excel-like formula wrapper → structured JSON (+ evaluate it).
  //   xf.formula.parse('if(upper(a)=b,"Yes","No")')  → JSON
  //   xf.formula.compile(str)(row)                    → value
  formula: {
    parse: parseFormula,
    evaluate: evaluateFormula,
    compile: compileFormula
  },

  // Natural-language wrapper — STUB (not implemented yet).
  nlp: nlp,

  registerOperator: registerOperator,
  registerFunction: registerFunction,

  // Introspection — the registered operator/function names.
  OPERATORS: OPERATORS,
  FUNCTIONS: FUNCTIONS,
  operators: function () { return Object.keys(OPERATORS); },
  functions: function () { return Object.keys(FUNCTIONS); }
};
