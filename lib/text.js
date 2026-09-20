// JSON tree → formula text. The other direction from parse.js, and the reason
// it lives here: an editor that shows a stored condition back to someone has
// to write the same language the engine reads. Written anywhere else it would
// drift, and the drift would only show when a condition that displays fine
// fails to compile.
//
//   toText(xf.parse('a=1 and upper(b)="X"'))   // → 'a = 1 and upper(b) = "X"'
//   toText(parse(t)) parses again to the same tree (round-trip).
//
// Brackets go round any name that isn't a plain one, and parentheses only
// where precedence needs them.

var PLAIN = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
var KEYWORD = /^(and|or|not|in|true|false|null)$/i;

// Mirrors parse.js. A child binds looser than its parent → parenthesise.
var PREC = { any: 2, all: 3, compare: 4, add: 5, mul: 6, unary: 7, pow: 8, atom: 9 };
var OP_PREC = {
  eq: PREC.compare, neq: PREC.compare, '<': PREC.compare, '<=': PREC.compare,
  '>': PREC.compare, '>=': PREC.compare, in: PREC.compare,
  '+': PREC.add, '-': PREC.add, '||': PREC.add,
  '*': PREC.mul, '/': PREC.mul, '%': PREC.mul,
  '^': PREC.pow
};
// The 1.x word operators have no infix spelling; they are written as text
// (`between(x, 1, 10)`) where one exists, and otherwise left to the caller.
var WORD_OP_TEXT = { eq: '=', equals: '=', neq: '!=', notEquals: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function name(n) {
  var s = String(n);
  return PLAIN.test(s) && !KEYWORD.test(s) ? s : '[' + s.split(']').join(']]') + ']';
}

function literal(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return '"' + v.split('"').join('""') + '"';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '(' + v.map(literal).join(', ') + ')';
  if (v === undefined) return 'null';
  if (v instanceof Date) return '"' + v.toISOString() + '"';
  return '"' + String(v).split('"').join('""') + '"';
}

function precOf(node) {
  if (!node || typeof node !== 'object') return PREC.atom;
  if (node.any !== undefined) return PREC.any;
  if (node.all !== undefined) return PREC.all;
  if (node.not !== undefined || node.neg !== undefined || node.pos !== undefined) return PREC.unary;
  if (node.op !== undefined) return OP_PREC[node.op] || PREC.compare;
  return PREC.atom;
}

function wrap(node, min) {
  var text = toText(node);
  return precOf(node) < min ? '(' + text + ')' : text;
}

function toText(node) {
  if (node === null || node === undefined) return '';
  if (typeof node !== 'object') return literal(node);

  if (node.fn !== undefined && node.call === undefined) {          // 1.x operand
    var inner = Object.assign({}, node);
    delete inner.fn;
    return String(node.fn) + '(' + toText(inner) + ')';
  }
  if (Object.prototype.hasOwnProperty.call(node, 'value')) return literal(node.value);
  if (node.field !== undefined) return String(node.field).split('.').map(name).join('.');
  if (node.path !== undefined) return node.path.map(name).join('.');
  if (node.thisrow !== undefined) return '$thisrow.' + node.thisrow.map(name).join('.');
  if (node.list !== undefined) return '(' + node.list.map(toText).join(', ') + ')';
  if (node.call !== undefined) return String(node.call) + '(' + (node.args || []).map(toText).join(', ') + ')';
  if (node.if !== undefined) return 'if(' + toText(node.if) + ', ' + toText(node.then) + ', ' + toText(node.else) + ')';
  if (node.all !== undefined) return node.all.map(function (n) { return wrap(n, PREC.all); }).join(' and ');
  if (node.any !== undefined) return node.any.map(function (n) { return wrap(n, PREC.any); }).join(' or ');
  if (node.not !== undefined) return 'not ' + wrap(node.not, PREC.unary);
  if (node.neg !== undefined) return '-' + wrap(node.neg, PREC.unary);
  if (node.pos !== undefined) return '+' + wrap(node.pos, PREC.unary);

  if (node.op !== undefined) {
    var sym = WORD_OP_TEXT[node.op] || (OP_PREC[node.op] ? node.op : null);
    var here = precOf(node);
    if (sym) {
      var left = wrap(node.left, here);
      if (node.right === undefined || node.right === null) return left + ' ' + sym;
      // The right side of a left-associative operator needs parentheses at
      // equal precedence: a - (b - c) is not a - b - c.
      var right = wrap(node.right, node.op === '^' ? here : here + 1);
      return left + ' ' + sym + ' ' + right;
    }
    // Word operators with no infix spelling: contains, between, isNull, in…
    var args = [toText(node.left)];
    if (node.right !== undefined && node.right !== null) {
      var r = node.right;
      if (node.op === 'between' && r && Array.isArray(r.value)) args = args.concat(r.value.map(literal));
      else args.push(toText(r));
    }
    return String(node.op) + '(' + args.join(', ') + ')';
  }
  return '';
}

module.exports = { toText: toText };
