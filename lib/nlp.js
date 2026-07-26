// NLP wrapper — STUB. Future: turn a natural-language phrase into the same
// structured expression/formula JSON the evaluator consumes, e.g.
//   "rows where the created month is January"
//     → { left: { fn:'month', field:'created' }, op:'eq', right:{ value:'January' } }
//
// Intentionally not implemented yet. Shipped as a stub so the surface exists
// and callers can feature-detect. Wire an LLM/grammar backend here later.

function parse(_text, _options) {
  throw new Error('nlp wrapper: not implemented yet (stub). Use formula.parseFormula or the structured JSON API.');
}

module.exports = {
  parse: parse,
  implemented: false
};
