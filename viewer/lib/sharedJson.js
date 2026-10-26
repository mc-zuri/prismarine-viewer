// JSON with its repeated parts written once: { $shared: [part, ...], value }, where the value and the parts refer to a
// part as { $s: index }, each part before the parts that refer to it. A prerendered blocksStates file repeats the
// same models, faces and UVs across thousands of variants (a Bedrock version's is about ten times smaller so); read
// back, the parts are shared objects, as small in memory as on the wire.

// value: a JSON value. A repeated part is written once if it is longer than minLength written out (a reference to it
// is about 10 characters).
function pack (value, { minLength = 24 } = {}) {
  const byKey = new Map()
  const nodes = []
  // (hash-consing: a node is known by its kind, its keys and its children's nodes, so equal subtrees are one node)
  function visit (v) {
    if (v === null || typeof v !== 'object') return { json: JSON.stringify(v) }
    const array = Array.isArray(v)
    const entries = array ? v.map((c, i) => [i, visit(c)]) : Object.keys(v).map(k => [k, visit(v[k])])
    const key = (array ? '[' : '{') + entries.map(([k, c]) => (array ? '' : JSON.stringify(k) + ':') + (c.node ? '#' + c.node.index : c.json)).join(',')
    let node = byKey.get(key)
    if (!node) {
      const size = 2 + entries.reduce((s, [k, c]) => s + (array ? 0 : JSON.stringify(k).length + 1) + (c.node ? c.node.size : c.json.length) + 1, 0)
      node = { index: nodes.length, array, entries, size, uses: 0 }
      byKey.set(key, node)
      nodes.push(node)
    }
    node.uses++
    return { node }
  }
  const top = visit(value)
  const shared = []
  for (const node of nodes) if (node.uses > 1 && node.size > minLength) node.part = shared.push(node) - 1
  const write = (c, inPart) => {
    if (!c.node) return JSON.parse(c.json)
    if (c.node.part !== undefined && c.node !== inPart) return { $s: c.node.part }
    return c.node.array ? c.node.entries.map(([, e]) => write(e)) : Object.fromEntries(c.node.entries.map(([k, e]) => [k, write(e)]))
  }
  return { $shared: shared.map(node => write({ node }, node)), value: write(top) }
}

function unpack ({ $shared, value }) {
  const parts = []
  const revive = v => {
    if (v === null || typeof v !== 'object') return v
    if (!Array.isArray(v) && typeof v.$s === 'number' && Object.keys(v).length === 1) return parts[v.$s]
    for (const k in v) v[k] = revive(v[k])
    return v
  }
  for (const part of $shared) parts.push(revive(part))
  return revive(value)
}

// a JSON value as read: unpacked if it was packed
const read = json => json && typeof json === 'object' && Array.isArray(json.$shared) ? unpack(json) : json

module.exports = { pack, unpack, read }
