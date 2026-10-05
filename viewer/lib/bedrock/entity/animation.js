// The channels of a Bedrock animation (a bone's rotation, position, scale): a vector of numbers or Molang, one
// expression for all three axes, or a timeline of keyframes ("0.0": [...], "0.5": { pre, post, lerp_mode }).
const { compile, num } = require('./molang')

// a vector spec at one moment: [x, y, z]; `this` is the axis' value so far (self[axis])
function vector (spec, ctx, self) {
  if (spec == null) return null
  if (typeof spec === 'number') return [spec, spec, spec]
  if (typeof spec === 'boolean') return [+spec, +spec, +spec]
  if (typeof spec === 'string') {
    ctx.self = self[0]
    const v = num(compile(spec)(ctx))
    return [v, v, v]
  }
  if (Array.isArray(spec) && spec.some(e => e !== null && typeof e === 'object')) {
    // the old form of a rotation in steps, [{ y: ... }, { x: ... }, { y: ... }]: taken as their sum per axis
    const out = [0, 0, 0]
    for (const step of spec) {
      if (!step || typeof step !== 'object') continue
      ;['x', 'y', 'z'].forEach((axis, i) => {
        if (step[axis] === undefined) return
        ctx.self = self[i] + out[i]
        out[i] += typeof step[axis] === 'number' ? step[axis] : num(compile(step[axis])(ctx))
      })
    }
    return out
  }
  if (Array.isArray(spec)) {
    const out = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      const e = spec[i] ?? spec[0]
      if (typeof e === 'number') out[i] = e
      else { ctx.self = self[i]; out[i] = num(compile(e)(ctx)) }
    }
    return out
  }
  return null
}

const isTimeline = spec => spec != null && typeof spec === 'object' && !Array.isArray(spec)

const timelines = new WeakMap()
// a timeline spec -> [{ time, pre, post, lerp }] by time
function timeline (spec) {
  let frames = timelines.get(spec)
  if (frames) return frames
  frames = Object.entries(spec)
    .map(([t, v]) => {
      const time = Number(t)
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        const post = v.post ?? v.pre ?? 0
        return { time, pre: v.pre ?? post, post, lerp: v.lerp_mode ?? 'linear' }
      }
      return { time, pre: v, post: v, lerp: 'linear' }
    })
    .filter(f => Number.isFinite(f.time))
    .sort((a, b) => a.time - b.time)
  timelines.set(spec, frames)
  return frames
}

function catmull (p0, p1, p2, p3, t) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

// a channel at `time`: [x, y, z], or null when it says nothing
function channel (spec, time, ctx, self) {
  if (!isTimeline(spec)) return vector(spec, ctx, self)
  const frames = timeline(spec)
  if (!frames.length) return null
  // query.key_frame_lerp_time: how far between the two keyframes it is
  ctx.keyFrameLerpTime = 0
  if (time <= frames[0].time) return vector(frames[0].pre, ctx, self)
  const last = frames[frames.length - 1]
  ctx.keyFrameLerpTime = 1
  if (time >= last.time) return vector(last.post, ctx, self)
  let i = 0
  while (i < frames.length - 2 && frames[i + 1].time <= time) i++
  const a = frames[i]
  const b = frames[i + 1]
  const t = (time - a.time) / (b.time - a.time)
  ctx.keyFrameLerpTime = t
  if (a.lerp === 'step') return vector(a.post, ctx, self)
  const va = vector(a.post, ctx, self)
  const vb = vector(b.pre, ctx, self)
  if (a.lerp === 'catmullrom' || b.lerp === 'catmullrom') {
    const v0 = vector((frames[i - 1] ?? a).post, ctx, self)
    const v3 = vector((frames[i + 2] ?? b).pre, ctx, self)
    return [0, 1, 2].map(k => catmull(v0[k], va[k], vb[k], v3[k], t))
  }
  return [0, 1, 2].map(k => va[k] + (vb[k] - va[k]) * t)
}

const lengths = new WeakMap()
// an animation's length: animation_length, else its last keyframe, else 0 (it never ends by itself)
function animationLength (anim) {
  if (typeof anim.animation_length === 'number') return anim.animation_length
  let length = lengths.get(anim)
  if (length !== undefined) return length
  length = 0
  for (const bone of Object.values(anim.bones ?? {})) {
    for (const ch of ['rotation', 'position', 'scale']) {
      if (isTimeline(bone?.[ch])) for (const f of timeline(bone[ch])) length = Math.max(length, f.time)
    }
  }
  lengths.set(anim, length)
  return length
}

module.exports = { channel, vector, animationLength, isTimeline }
