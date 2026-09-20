// Formula text → JSON tree. Our own reader: no eval, no dependencies.
//
// The grammar is BI's formula language (expr-eval's), with the agreed changes:
// `=` is equals, `[any name]` is a column, lists are `in (a, b)`. Precedence,
// lowest first — identical to expr-eval, so old formulas mean what they meant:
//
//   ? :   →   or   →   and   →   = == != <> < <= > >= in   →   + - ||
//   →   * / %   →   unary - + not   →   ^ (right)   →   calls, paths
//
// The tree (all plain JSON — it is what gets stored):
//   { value: 42 }                          literal
//   { field: 'revenue' }                   a column
//   { path: ['form', 'first name'] }       a path, or a name only brackets can write
//   { thisrow: ['city'] }                  $thisrow.city
//   { call: 'upper', args: [ … ] }         a function
//   { op: '+', left, right }               + - * / % ^ || < <= > >= in
//   { op: 'eq', left, right }              = == (and 'neq' for != <>) — the 1.x shape
//   { neg: x }  { pos: x }  { not: x }     unary
//   { all: [ … ] }  { any: [ … ] }         and / or
//   { if, then, else }                     if() and ? :
//   { list: [ … ] }                        the right side of `in (…)`

var functions = require('./functions');

var KEYWORDS = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'null']);
// A Set, not an object literal: `{ __proto__: 1 }` would set the prototype.
var BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
var ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', '/': '/', '"': '"', "'": "'" };

function fail(message, at) {
  var err = new Error(message + (at === undefined ? '' : ' at character ' + (at + 1)));
  err.position = at;
  throw err;
}

// ── tokens ────────────────────────────────────────────────────────────────
// { t: 'num'|'str'|'name'|'bracket'|'punct'|'end', v, at }
function tokenize(src) {
  var out = [];
  var i = 0, n = src.length;
  while (i < n) {
    var c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    var at = i;

    if (c === '"' || c === "'") {
      // A backslash escapes (as expr-eval); a doubled quote escapes (as 1.x).
      var q = c, s = '';
      i++;
      for (;;) {
        if (i >= n) fail('Text is never closed — missing ' + q, at);
        var ch = src[i];
        if (ch === '\\') {
          var e = src[i + 1];
          if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.substr(i + 2, 4))) { s += String.fromCharCode(parseInt(src.substr(i + 2, 4), 16)); i += 6; continue; }
          if (ESCAPES[e] === undefined) fail('Unknown escape \\' + (e || ''), i);
          s += ESCAPES[e]; i += 2; continue;
        }
        if (ch === q) {
          if (src[i + 1] === q) { s += q; i += 2; continue; }
          i++; break;
        }
        s += ch; i++;
      }
      out.push({ t: 'str', v: s, at: at });
      continue;
    }

    if (c === '[') {
      // Everything up to the closing ] is the name; ]] is a literal ].
      var name = '';
      i++;
      for (;;) {
        if (i >= n) fail('Column name is never closed — missing ]', at);
        if (src[i] === ']') {
          if (src[i + 1] === ']') { name += ']'; i += 2; continue; }
          i++; break;
        }
        name += src[i++];
      }
      out.push({ t: 'bracket', v: name, at: at });
      continue;
    }

    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      var m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      out.push({ t: 'num', v: parseFloat(m[0]), at: at });
      i += m[0].length;
      continue;
    }

    // Any letter, as expr-eval allows — `café`, `größe`.
    if (/[\p{L}_$]/u.test(c)) {
      var id = /^[\p{L}_$][\p{L}\p{N}_$]*/u.exec(src.slice(i))[0];
      out.push({ t: 'name', v: id, at: at });
      i += id.length;
      continue;
    }

    var two = src.substr(i, 2);
    if (two === '==' || two === '!=' || two === '<>' || two === '<=' || two === '>=' || two === '||') {
      out.push({ t: 'punct', v: two, at: at }); i += 2; continue;
    }
    if ('()+-*/%^,.?:=<>'.indexOf(c) !== -1) { out.push({ t: 'punct', v: c, at: at }); i++; continue; }
    if (c === '!') fail('Use "not" rather than "!"', at);
    fail('Unexpected character "' + c + '"', at);
  }
  out.push({ t: 'end', at: n });
  return out;
}

// ── grammar ───────────────────────────────────────────────────────────────
function parse(src) {
  if (typeof src !== 'string') throw new Error('parse: formula must be text');
  if (!src.trim()) fail('The formula is empty');
  var toks = tokenize(src);
  var pos = 0;

  function peek() { return toks[pos]; }
  function next() { return toks[pos++]; }
  function isPunct(v) { var t = toks[pos]; return t.t === 'punct' && t.v === v; }
  function isWord(w) { var t = toks[pos]; return t.t === 'name' && t.v.toLowerCase() === w; }
  function describe(t) {
    if (t.t === 'end') return 'the end of the formula';
    if (t.t === 'str') return 'text "' + t.v + '"';
    if (t.t === 'bracket') return '[' + t.v + ']';
    return '"' + t.v + '"';
  }
  function expect(v) {
    if (!isPunct(v)) fail('Expected "' + v + '" but found ' + describe(peek()), peek().at);
    return next();
  }

  function conditional() {
    var cond = or();
    if (!isPunct('?')) return cond;
    next();
    var yes = conditional();
    expect(':');
    return { if: cond, then: yes, else: conditional() };
  }

  function or() {
    var first = and();
    if (!isWord('or')) return first;
    var parts = [first];
    while (isWord('or')) { next(); parts.push(and()); }
    return { any: parts };
  }

  function and() {
    var first = comparison();
    if (!isWord('and')) return first;
    var parts = [first];
    while (isWord('and')) { next(); parts.push(comparison()); }
    return { all: parts };
  }

  // Equality is the 1.x `eq` / `neq` whichever way it's spelled — forgiving
  // (18 = "18"), and the shape Workflow's stored conditions already use.
  var COMPARE = { '=': 'eq', '==': 'eq', '!=': 'neq', '<>': 'neq', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };

  function comparison() {
    var left = addSub();
    for (;;) {
      var t = peek();
      if (t.t === 'punct' && COMPARE[t.v]) { next(); left = { op: COMPARE[t.v], left: left, right: addSub() }; continue; }
      if (isWord('in')) { next(); left = { op: 'in', left: left, right: inList() }; continue; }
      return left;
    }
  }

  // `in (a, b, c)` is a list; anything else is an expression holding one.
  function inList() {
    var t = peek();
    if (t.t === 'bracket') fail('Lists are written in parentheses — in (' + t.v + ')', t.at);
    if (!isPunct('(')) return addSub();
    next();
    var items = [];
    if (!isPunct(')')) {
      items.push(conditional());
      while (isPunct(',')) { next(); items.push(conditional()); }
    }
    expect(')');
    return { list: items };
  }

  function addSub() {
    var left = term();
    for (;;) {
      var t = peek();
      if (t.t === 'punct' && (t.v === '+' || t.v === '-' || t.v === '||')) { next(); left = { op: t.v, left: left, right: term() }; continue; }
      return left;
    }
  }

  function term() {
    var left = factor();
    for (;;) {
      var t = peek();
      if (t.t === 'punct' && (t.v === '*' || t.v === '/' || t.v === '%')) { next(); left = { op: t.v, left: left, right: factor() }; continue; }
      return left;
    }
  }

  function factor() {
    if (isPunct('-')) { next(); return { neg: factor() }; }
    if (isPunct('+')) { next(); return { pos: factor() }; }
    if (isWord('not')) { next(); return { not: factor() }; }
    return exponential();
  }

  function exponential() {
    var base = atom();
    if (!isPunct('^')) return base;
    next();
    return { op: '^', left: base, right: factor() };
  }

  function atom() {
    var t = next();
    if (t.t === 'num') return { value: t.v };
    if (t.t === 'str') return { value: t.v };
    if (t.t === 'punct' && t.v === '(') { var inner = conditional(); expect(')'); return inner; }
    if (t.t === 'bracket') return pathFrom([segment(t.v, t.at)]);
    if (t.t === 'name') {
      var low = t.v.toLowerCase();
      if (isPunct('(')) return call(t);
      if (low === 'true') return { value: true };
      if (low === 'false') return { value: false };
      if (low === 'null') return { value: null };
      if (KEYWORDS.has(low)) fail('"' + t.v + '" is a keyword here — write [' + t.v + '] for a column of that name', t.at);
      if (low === '$thisrow') {
        var rest = pathSegments([]);
        if (!rest.length) fail('$thisrow needs a column — $thisrow.city', t.at);
        return { thisrow: rest };
      }
      return pathFrom([segment(t.v, t.at)]);
    }
    fail('Expected a value but found ' + describe(t), t.at);
  }

  function segment(name, at) {
    if (BLOCKED.has(name)) fail('"' + name + '" can\'t be used as a column name', at);
    return name;
  }

  // Continues a path: .name  .[any name]  [any name]  ["name"]  [0]
  function pathSegments(segs) {
    for (;;) {
      var t = peek();
      if (t.t === 'punct' && t.v === '.') {
        next();
        var s = next();
        if (s.t === 'name' || s.t === 'bracket') { segs.push(segment(s.v, s.at)); continue; }
        fail('Expected a name after "." but found ' + describe(s), s.at);
      }
      if (t.t === 'bracket') {
        next();
        var q = /^\s*(["'])([\s\S]*)\1\s*$/.exec(t.v);
        segs.push(segment(q ? q[2] : t.v, t.at));
        continue;
      }
      return segs;
    }
  }

  function pathFrom(segs) {
    var start = pos;
    segs = pathSegments(segs);
    if (isPunct('(')) fail('Only a function name can be followed by "("', peek().at);
    // A lone plain name keeps the 1.x { field } shape; anything else is a path,
    // so a bracketed name containing a dot is never split into two.
    if (segs.length === 1 && segs[0].indexOf('.') === -1 && pos === start) return { field: segs[0] };
    return { path: segs };
  }

  function call(nameTok) {
    var entry = functions.lookup(nameTok.v);
    if (!entry || (entry.special && entry.name !== 'if')) fail('Unknown function "' + nameTok.v + '"', nameTok.at);
    expect('(');
    var args = [];
    if (!isPunct(')')) {
      args.push(conditional());
      while (isPunct(',')) { next(); args.push(conditional()); }
    }
    expect(')');
    if (args.length < entry.min || args.length > entry.max) {
      var want = entry.min === entry.max ? String(entry.min) : entry.max === Infinity ? 'at least ' + entry.min : entry.min + ' to ' + entry.max;
      fail(entry.name + '() takes ' + want + ' argument' + (want === '1' ? '' : 's') + ', not ' + args.length, nameTok.at);
    }
    if (entry.name === 'if') return { if: args[0], then: args[1], else: args[2] };
    return { call: entry.name, args: args };
  }

  var tree = conditional();
  if (peek().t !== 'end') fail('Unexpected ' + describe(peek()), peek().at);
  return tree;
}

module.exports = { parse: parse, tokenize: tokenize, BLOCKED: BLOCKED };
