// Formula wrapper — parse an Excel-like formula string into the structured
// JSON the evaluator understands, and evaluate it against a row.
//
//   parseFormula('if(upper(someColumn)=anotherColumn, "Yes", "No")')
//   →
//   { if:   { left: { fn:'upper', field:'someColumn' }, op:'eq',
//             right: { field:'anotherColumn' } },
//     then: { value: 'Yes' },
//     else: { value: 'No' } }
//
// Rules (level 1 — no arithmetic, no AND/OR, single function nesting):
//   • "double quoted" (or 'single quoted') → string literal   { value }
//   • bare word                            → field reference  { field }
//   • number / null / true / false         → literal          { value }
//   • name(...)                            → function call (value fn like
//       upper/month, boolean fn like contains/between/isnull, or IF)
//   • comparisons:  =  ==  !=  <>  >  >=  <  <=
//
// An IF node evaluates to its then/else VALUE; a bare comparison evaluates to
// a boolean. So compileFormula() yields a value-producer or a predicate alike.

var { evaluate, resolveOperand } = require('./evaluate');
var { FUNCTIONS } = require('./functions');

// Boolean functions → operator names (arity fixed). Keys are lowercased.
var BOOL_FUNCS = {
  contains:       { op: 'contains',    arity: 2 },
  notcontains:    { op: 'notContains', arity: 2 },
  doesnotcontain: { op: 'notContains', arity: 2 },
  startswith:     { op: 'startsWith',  arity: 2 },
  endswith:       { op: 'endsWith',    arity: 2 },
  isnull:         { op: 'isNull',      arity: 1 },
  isnotnull:      { op: 'isNotNull',   arity: 1 },
  between:        { op: 'between',      arity: 3 }
};

var OP_SYMBOLS = { '=': 'eq', '==': 'eq', '!=': 'neq', '<>': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };

// ── tokenizer ────────────────────────────────────────────────────────────
function tokenize(input) {
  var tokens = [];
  var i = 0, n = input.length;
  while (i < n) {
    var c = input[i];
    if (/\s/.test(c)) { i++; continue; }

    if (c === '"' || c === "'") {                 // string literal (doubled quote = escape)
      var q = c; i++; var s = '';
      while (i < n) {
        if (input[i] === q) {
          if (input[i + 1] === q) { s += q; i += 2; continue; }
          i++; break;
        }
        s += input[i++];
      }
      tokens.push({ t: 'string', v: s });
      continue;
    }
    if (c === '(') { tokens.push({ t: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ t: 'rparen' }); i++; continue; }
    if (c === ',') { tokens.push({ t: 'comma' }); i++; continue; }

    var two = input.substr(i, 2);
    if (two === '>=' || two === '<=' || two === '<>' || two === '!=' || two === '==') { tokens.push({ t: 'op', v: two }); i += 2; continue; }
    if (c === '=' || c === '>' || c === '<') { tokens.push({ t: 'op', v: c }); i++; continue; }

    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(input[i + 1] || ''))) {
      var num = c; i++;
      while (i < n && /[0-9.]/.test(input[i])) num += input[i++];
      tokens.push({ t: 'number', v: parseFloat(num) });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      var id = c; i++;
      while (i < n && /[A-Za-z0-9_.]/.test(input[i])) id += input[i++];
      tokens.push({ t: 'ident', v: id });
      continue;
    }
    throw new Error('Unexpected character "' + c + '" at position ' + i);
  }
  return tokens;
}

// Resolve a function name to the registry's canonical (case-insensitive) key.
function canonicalFn(low) {
  if (FUNCTIONS[low]) return low;
  var keys = Object.keys(FUNCTIONS);
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === low) return keys[i];
  return low;   // unknown — evaluate() will throw a clear error at run time
}

function literalOf(node, ctx) {
  if (node && Object.prototype.hasOwnProperty.call(node, 'value')) return node.value;
  throw new Error(ctx + ' must be a literal value');
}

// ── parser (recursive descent) ─────────────────────────────────────────────
function parseFormula(input) {
  if (typeof input !== 'string') throw new Error('parseFormula: input must be a string');
  var toks = tokenize(input);
  var pos = 0;
  function peek() { return toks[pos]; }
  function expect(t) {
    var tk = toks[pos];
    if (!tk || tk.t !== t) throw new Error('Expected ' + t + ' but got ' + (tk ? (tk.t + (tk.v != null ? ' "' + tk.v + '"' : '')) : 'end of formula'));
    return toks[pos++];
  }

  function parseExpression() {
    var left = parsePrimary();
    var tk = peek();
    if (tk && tk.t === 'op') {
      pos++;
      var right = parsePrimary();
      return { left: left, op: OP_SYMBOLS[tk.v], right: right };
    }
    return left;
  }

  function parsePrimary() {
    var tk = peek();
    if (!tk) throw new Error('Unexpected end of formula');

    if (tk.t === 'string') { pos++; return { value: tk.v }; }
    if (tk.t === 'number') { pos++; return { value: tk.v }; }
    if (tk.t === 'lparen') { pos++; var e = parseExpression(); expect('rparen'); return e; }

    if (tk.t === 'ident') {
      var name = tk.v;
      var low = name.toLowerCase();
      var isCall = toks[pos + 1] && toks[pos + 1].t === 'lparen';
      if (isCall) {
        pos += 2;                                  // consume ident + '('
        if (low === 'if') return parseIf();
        if (BOOL_FUNCS[low]) return parseBoolFunc(low);
        return parseValueFunc(low);
      }
      pos++;
      if (low === 'null') return { value: null };
      if (low === 'true') return { value: true };
      if (low === 'false') return { value: false };
      return { field: name };                      // field refs keep their case
    }
    throw new Error('Unexpected token: ' + tk.t);
  }

  function parseIf() {                              // 'if' + '(' already consumed
    var cond = parseExpression();
    expect('comma');
    var thenNode = parseExpression();
    expect('comma');
    var elseNode = parseExpression();
    expect('rparen');
    return { if: cond, then: thenNode, else: elseNode };
  }

  function parseValueFunc(low) {                    // e.g. upper(x), month(d)
    var arg = parseExpression();
    expect('rparen');
    if (arg && (arg.fn || arg.if || arg.op)) throw new Error('level-1: function "' + low + '" argument must be a field or literal');
    return Object.assign({ fn: canonicalFn(low) }, arg);
  }

  function parseBoolFunc(low) {                     // e.g. contains(a,b), isnull(a), between(a,lo,hi)
    var def = BOOL_FUNCS[low];
    var args = [parseExpression()];
    while (peek() && peek().t === 'comma') { pos++; args.push(parseExpression()); }
    expect('rparen');
    if (args.length !== def.arity) throw new Error(low + '() expects ' + def.arity + ' argument(s), got ' + args.length);
    if (def.op === 'between') return { left: args[0], op: 'between', right: { value: [literalOf(args[1], 'between low bound'), literalOf(args[2], 'between high bound')] } };
    if (def.arity === 1) return { left: args[0], op: def.op };
    return { left: args[0], op: def.op, right: args[1] };
  }

  var result = parseExpression();
  if (pos < toks.length) throw new Error('Unexpected trailing tokens in formula (near token ' + (pos + 1) + ')');
  return result;
}

// ── evaluation ─────────────────────────────────────────────────────────────
// Returns a VALUE (IF → then/else value), or a boolean (bare comparison).
function evaluateFormula(node, row) {
  if (node === null || node === undefined) return null;
  if (Object.prototype.hasOwnProperty.call(node, 'if')) {
    return evaluate(node.if, row) ? evaluateFormula(node.then, row) : evaluateFormula(node.else, row);
  }
  if (node.op) return evaluate(node, row);         // comparison → boolean
  return resolveOperand(node, row);                // operand → value
}

function compileFormula(input) {
  var node = parseFormula(input);
  return function (row) { return evaluateFormula(node, row); };
}

module.exports = { parseFormula, evaluateFormula, compileFormula };
