/**
 * Canonical topological order for infra/bootstrap_invariants.graph.json (Kahn, alphabetical tie-break).
 * Shared by get-bootstrap-order, validate-phase-order, and derive-bootstrap-order logic.
 */
export function topologicalOrderBaseline(graph) {
  const nodes = Object.keys(graph.nodes || {});
  const edges = graph.edges || [];
  const adj = new Map();
  const indeg = new Map();
  for (const n of nodes) {
    adj.set(n, []);
    indeg.set(n, 0);
  }
  for (const [u, v] of edges) {
    if (!adj.has(u) || !indeg.has(v)) throw new Error(`edge references unknown node: ${u} -> ${v}`);
    adj.get(u).push(v);
    indeg.set(v, indeg.get(v) + 1);
  }
  const q = [];
  for (const [n, d] of indeg) {
    if (d === 0) q.push(n);
  }
  q.sort();
  const out = [];
  while (q.length) {
    const u = q.shift();
    out.push(u);
    for (const v of adj.get(u) || []) {
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) {
        q.push(v);
        q.sort();
      }
    }
  }
  if (out.length !== nodes.length) throw new Error("graph has a cycle (topological sort incomplete)");
  return out;
}
