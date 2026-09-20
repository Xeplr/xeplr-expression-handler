// What a formula uses, without running it — for editors (which columns does
// this need? is it a per-row or a per-group formula?) and for validation.
//
//   analyze('if(sum(a) > 10, upper(city), "-")')
//   → { fields: ['a', 'city'], fieldsOutsideTotals: ['city'], thisrow: [],
//       functions: ['sum', 'upper'], aggregates: [{ name: 'sum', list: null, fields: ['a'] }],
//       levels: 1 }
//
// `fields` are dotted names (`form.country`); a list total's own list counts
// as a field of the row, its condition and value read the list's items.

var functions = require('./functions');

function analyzeTree(tree) {
  var fields = [];
  var outside = [];
  var thisrow = [];
  var fns = [];
  var aggregates = [];
  var levels = 0;

  function add(list, v) { if (list.indexOf(v) === -1) list.push(v); }

  // `into` collects the fields of the innermost total being walked, or null.
  function walk(node, level, into) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(function (n) { walk(n, level, into); }); return; }

    if (node.fn !== undefined && node.call === undefined) add(fns, functions.lookup(node.fn) ? functions.lookup(node.fn).name : String(node.fn));
    if (node.field !== undefined || node.path !== undefined) {
      var name = node.field !== undefined ? String(node.field) : node.path.join('.');
      add(fields, name);
      if (into) add(into, name); else add(outside, name);
    }
    if (node.thisrow !== undefined) add(thisrow, node.thisrow.join('.'));

    if (node.call !== undefined) {
      var entry = functions.lookup(node.call);
      var fname = entry ? entry.name : String(node.call);
      add(fns, fname);
      var args = node.args || [];
      if (entry && entry.aggregate) {
        var implicit = (entry.shape.cond ? 1 : 0) + (entry.shape.value ? 1 : 0);
        var hasList = args.length === implicit + 1;
        var own = [];
        var agg = { name: entry.name, list: null, fields: own };
        levels = Math.max(levels, level + 1);
        if (hasList) {
          var l = args[0];
          agg.list = l.field !== undefined ? String(l.field) : l.path ? l.path.join('.') : null;
          walk(l, level, into);
        }
        (hasList ? args.slice(1) : args).forEach(function (a) { walk(a, level + 1, own); });
        own.forEach(function (f) { add(fields, f); if (into) add(into, f); });
        aggregates.push(agg);
        return;
      }
      walk(args, level, into);
      return;
    }

    ['left', 'right', 'if', 'then', 'else', 'not', 'neg', 'pos', 'all', 'any', 'list'].forEach(function (k) {
      if (node[k] !== undefined) walk(node[k], level, into);
    });
  }

  walk(tree, 0, null);
  return { fields: fields, fieldsOutsideTotals: outside, thisrow: thisrow, functions: fns, aggregates: aggregates, levels: levels };
}

module.exports = { analyzeTree: analyzeTree };
