// The curves of a particle effect ("curves": { "variable.<name>": { type, input, horizontal_range, nodes } }): a value
// of its input, which the effect's Molang reads as variable.<name>. The input over the horizontal range (1 by default)
// is where on the curve it is, 0 to 1:
//  - linear: nodes evenly spaced from 0 to 1, a straight line between each two
//  - catmull_rom: the same through all nodes but the first and the last, which only shape its ends
//  - bezier: four nodes, the control points of one cubic Bézier curve
//  - bezier_chain: keyframes by place ({ "0.3": { value | left_value, right_value, slope | left_slope, right_slope } }),
//    a cubic Bézier curve from each to the next with the slopes they leave and arrive with
// Nodes and values may be Molang.
const { compile, num } = require('../entity/molang')

const value = (f, ctx) => num(f(ctx))

function catmull (p0, p1, p2, p3, t) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

function bezier (p0, p1, p2, p3, t) {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

// the keyframes of a bezier_chain, in order: { time, left, right, leftSlope, rightSlope } (Molang)
function chain (nodes) {
  return Object.entries(nodes ?? {})
    .map(([time, node]) => {
      const n = node && typeof node === 'object' ? node : { value: node }
      const left = compile(n.left_value ?? n.value ?? 0)
      const right = compile(n.right_value ?? n.value ?? 0)
      const leftSlope = compile(n.left_slope ?? n.slope ?? 0)
      const rightSlope = compile(n.right_slope ?? n.slope ?? 0)
      return { time: Number(time), left, right, leftSlope, rightSlope }
    })
    .filter(k => Number.isFinite(k.time))
    .sort((a, b) => a.time - b.time)
}

/**
 * A curve of the definition -> { name, evaluate (ctx) -> its value }; name: the variable it sets, without variable.
 * (lower case, as Molang reads names). Null for a curve of no type it knows.
 */
function compileCurve (key, curve) {
  const name = String(key).toLowerCase().replace(/^(variable|v)\./, '')
  const input = compile(curve.input ?? 0)
  const range = compile(curve.horizontal_range ?? 1)
  const place = ctx => {
    const r = value(range, ctx)
    const t = r === 0 ? 0 : value(input, ctx) / r
    return Math.min(Math.max(t, 0), 1)
  }
  const type = curve.type ?? 'linear'
  if (type === 'bezier_chain') {
    const keys = chain(curve.nodes)
    return {
      name,
      evaluate (ctx) {
        if (!keys.length) return 0
        const t = place(ctx)
        if (t <= keys[0].time) return value(keys[0].left, ctx)
        const last = keys[keys.length - 1]
        if (t >= last.time) return value(last.right, ctx)
        let i = 0
        while (i < keys.length - 2 && keys[i + 1].time <= t) i++
        const a = keys[i]
        const b = keys[i + 1]
        const span = b.time - a.time
        const u = span === 0 ? 0 : (t - a.time) / span
        const p0 = value(a.right, ctx)
        const p3 = value(b.left, ctx)
        return bezier(p0, p0 + value(a.rightSlope, ctx) * span / 3, p3 - value(b.leftSlope, ctx) * span / 3, p3, u)
      }
    }
  }
  const nodes = (Array.isArray(curve.nodes) ? curve.nodes : []).map(n => compile(n))
  const at = (i, ctx) => value(nodes[Math.min(Math.max(i, 0), nodes.length - 1)], ctx)
  if (type === 'linear') {
    return {
      name,
      evaluate (ctx) {
        if (nodes.length < 2) return nodes.length ? at(0, ctx) : 0
        const s = place(ctx) * (nodes.length - 1)
        const i = Math.min(Math.floor(s), nodes.length - 2)
        const a = at(i, ctx)
        return a + (at(i + 1, ctx) - a) * (s - i)
      }
    }
  }
  if (type === 'catmull_rom') {
    return {
      name,
      evaluate (ctx) {
        // the curve runs through nodes 1 .. n - 2
        const segments = nodes.length - 3
        if (segments < 1) return nodes.length ? at(Math.min(1, nodes.length - 1), ctx) : 0
        const s = place(ctx) * segments
        const i = Math.min(Math.floor(s), segments - 1)
        return catmull(at(i, ctx), at(i + 1, ctx), at(i + 2, ctx), at(i + 3, ctx), s - i)
      }
    }
  }
  if (type === 'bezier') {
    return {
      name,
      evaluate (ctx) {
        if (nodes.length < 4) return nodes.length ? at(0, ctx) : 0
        return bezier(at(0, ctx), at(1, ctx), at(2, ctx), at(3, ctx), place(ctx))
      }
    }
  }
  return null
}

module.exports = { compileCurve }
