// Holds the pathfinder's predictions to the ticks that follow them (for the checks: no server corrects the player
// here, so a prediction that is not the tick is a move the pathfinder did not plan). Each tick the client steps the
// player it compares:
//   state        the bot as the pathfinder sees it (bot.js), simulated one tick with the inputs the client sends, and
//                the tick: a difference is in what the bot shows of the player
//   input        the inputs the client sends, and the first tick of each prediction the pathfinder made since the
//                last tick: none of them had these inputs (the steering, or the plugin acting on no prediction)
//   prediction   the first tick of the prediction with those inputs, and the tick: the world changed after it (a block
//                the hands placed), or the pathfinder read it otherwise
// and counts the ticks the pathfinder walked with no prediction at all (in the water, breaking, placing).
//
//   const audit = attachAudit(pathfinder)
//   audit.on('mismatch', ({ t, kind, fields, ... }) => ...)
//   audit.counts   // { ticks, predicted, unpredicted, state, input, prediction }
const { EventEmitter } = require('events')
const { PlayerState } = require('prismarine-physics-bedrock')
const { cloneValue } = require('prismarine-physics-bedrock/lib/bedrock/network/rewind.ts')
const { isDeepStrictEqual } = require('util')

const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']

// A player state as the engine leaves it after a tick, to compare
function snapshot (state) {
  return {
    pos: [state.pos.x, state.pos.y, state.pos.z],
    vel: [state.vel.x, state.vel.y, state.vel.z],
    onGround: !!state.onGround,
    isInWater: !!state.isInWater,
    isInLava: !!state.isInLava,
    isCollidedHorizontally: !!state.isCollidedHorizontally,
    isCollidedVertically: !!state.isCollidedVertically,
    jumpTicks: state.jumpTicks ?? 0,
    jumpQueued: !!state.jumpQueued,
    bedrock: cloneValue(state.bedrock)
  }
}

const inputsOf = (control, yaw, pitch) => ({ ...Object.fromEntries(KEYS.map(key => [key, !!control[key]])), yaw, pitch })

// The fields of two values that differ: keys of objects, deep
function differences (a, b, path = '', out = []) {
  if (isDeepStrictEqual(a, b)) return out
  const objects = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !(a instanceof Set) && !(a instanceof Map)
  if (!objects) {
    out.push({ field: path || '(value)', predicted: a, actual: b })
    return out
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], path ? `${path}.${key}` : key, out)
  return out
}

class Audit extends EventEmitter {
  constructor (pathfinder) {
    super()
    this.pathfinder = pathfinder
    this.client = pathfinder.client
    this.counts = { ticks: 0, predicted: 0, unpredicted: 0, state: 0, input: 0, prediction: 0 }
    // the predictions since the last tick: PlayerState -> its first tick { inputs, after }
    this.runs = new Map()
    this.hooked = null
    this.hook = this.hook.bind(this)
    this.client.on('startGame', this.hook)
    this.hook()
  }

  // wraps the bot's simulatePlayer and the client's step, once for each bot (a join again makes a new one)
  hook () {
    const { bot } = this.pathfinder
    const movement = this.client.movement
    if (!bot || !movement || this.hooked === bot) return
    this.hooked = bot
    const simulatePlayer = bot.physics.simulatePlayer
    bot.physics.simulatePlayer = state => {
      const before = inputsOf(state.control, state.yaw, state.pitch)
      const result = simulatePlayer(state)
      // the inputs the tick ran on: those the bot steered the prediction's to (bot.js), else the prediction's own
      const { applied } = state
      const inputs = applied ? inputsOf(applied.control, applied.yaw, applied.pitch) : before
      if (!this.runs.has(state)) this.runs.set(state, { inputs, after: snapshot(state) })
      return result
    }
    const step = movement.step
    movement.step = t => {
      const runs = this.runs
      this.runs = new Map()
      const ready = movement.ready()
      const walking = this.pathfinder.walking
      const inputs = inputsOf(this.client.controls, this.client.look.yaw, this.client.look.pitch)
      // the bot as the pathfinder sees it, a tick on with these inputs (the engine's world, not the bot's cache)
      const seen = ready && walking ? movement.physics.simulatePlayer(new PlayerState(bot, { ...this.client.controls }), movement.world) : null
      step.call(movement, t)
      if (!ready || !walking) return
      this.check(t, inputs, runs, seen)
    }
  }

  check (t, inputs, runs, seen) {
    const counts = this.counts
    counts.ticks++
    const actual = snapshot(this.client.player)
    const context = { t, at: actual.pos, inputs, path: this.pathfinder.path.length }
    const state = differences(snapshot(seen), actual)
    if (state.length) this.mismatch('state', state, context)
    if (!runs.size) {
      counts.unpredicted++
      return
    }
    counts.predicted++
    const run = [...runs.values()].find(r => isDeepStrictEqual(r.inputs, inputs))
    if (!run) {
      // the prediction nearest these inputs
      const nearest = [...runs.values()].map(r => differences(r.inputs, inputs)).sort((a, b) => a.length - b.length)[0]
      this.mismatch('input', nearest, context)
      return
    }
    const prediction = differences(run.after, actual)
    if (prediction.length) this.mismatch('prediction', prediction, context)
  }

  mismatch (kind, fields, context) {
    this.counts[kind]++
    this.emit('mismatch', { kind, fields, ...context })
  }

  close () {
    this.client.off('startGame', this.hook)
  }
}

function attachAudit (pathfinder) {
  return new Audit(pathfinder)
}

module.exports = { attachAudit, snapshot, differences }
