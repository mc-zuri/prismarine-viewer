// The look and the keys the pathfinder gives, on their way to the client (bedrock-demo
// packages/bedrock-client-pathfinder/src/human.ts). Without the humanLike option each is the client's at once. With it
// they are given as a person gives them: the look turns toward where the pathfinder looks at a person's pace, half of
// what is left each tick and no more than MAX_YAW and MAX_PITCH degrees, and while walking the eyes rest on the route
// a few blocks ahead rather than on the horizon; the walking keys wait for the facing (no forward or back while the
// player faces more than WALK_ANGLE away from where the pathfinder looks, no sprint more than SPRINT_ANGLE away), and a
// jump to get somewhere waits for the walk. tick() turns and presses, once a tick. Either way the jump key is not
// pressed anew in the air: it is pressed on the ground, in a liquid or flying, and held on from there (a pillar's jump);
// and for a player that may fly, it is not pressed anew within FLY_TAP_TICKS of the last press, the double tap that
// flies (as the pathfinder swims, it lets go of jump and wants it again a few ticks later), unless the pathfinder holds
// the fly key: then its presses are the double tap that takes off or lands, in the air too.
//
// A tick's steering is steer(), of what the pathfinder wants, the look now and the player: the live tick (tick()) and
// each tick of the pathfinder's predictions (predict(), from bot.physics.simulatePlayer) steer alike, so the player
// moves as the pathfinder predicted it would.
const { CONTROLS, wrapDegrees, facing, lookToward } = require('./body')
const { bedrockYaw, bedrockPitch, lookOf, clientLook } = require('../client/movement')

const EASE = 0.5
const MAX_YAW = 30
const MAX_PITCH = 20
// a turn this small (degrees) is made in one tick
const SNAP = 1.5
// a look this near where the pathfinder looks (degrees between the two) has got there: a look at a block the player
// moves by (jumping up a pillar) never quite gets there
const SETTLED = 3
const WALK_ANGLE = 50
const SPRINT_ANGLE = 20
// where the eyes rest while walking: the route this many blocks ahead, at this height over it (about a person's chest)
const LOOK_AHEAD = 4
const LOOK_HEIGHT = 1
const REST_PITCH = { up: -30, down: 40 }
// two presses of jump fewer ticks apart than this start flying (the engine's double tap)
const FLY_TAP_TICKS = 7

// a tick's turn toward what is left: half of it, within the most a tick turns, all of it once small
function turn (left, most) {
  if (Math.abs(left) <= SNAP) return left
  return Math.sign(left) * Math.min(most, Math.max(SNAP, Math.abs(left) * EASE))
}

// The angle between two looks, in degrees: straight down, any yaw is the same look
function lookAngle (a, b) {
  const u = facing(a.yaw, a.pitch)
  const v = facing(b.yaw, b.pitch)
  return (Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y + u.z * v.z))) * 180) / Math.PI
}

// The pitch toward the route LOOK_AHEAD blocks ahead of the feet, at a person's chest over it; none without a route
function restPitch (route, feet, eyes) {
  let from = feet
  let left = LOOK_AHEAD
  let ahead
  for (const point of route) {
    ahead = point
    left -= Math.hypot(point.x - from.x, point.z - from.z)
    if (left <= 0) break
    from = point
  }
  if (!ahead) return undefined
  const { pitch } = lookToward(eyes, { x: ahead.x, y: ahead.y + LOOK_HEIGHT, z: ahead.z })
  return Math.max(REST_PITCH.up, Math.min(REST_PITCH.down, pitch))
}

// One tick of steering: the look (mineflayer's radians) and the keys for the tick.
//   humanLike  turns and presses as a person
//   want       { target: where the pathfinder looks (Bedrock degrees) | undefined, look: the look it gives as is
//              (radians) | undefined, keys: the keys it holds, released: it let go of jump since the last tick }
//   memory     { jumping: the jump key last given, sinceJump: the ticks since it was pressed anew }: updated
//   player     { look: the look now (radians), onGround, inLiquid, flying, mayFly }
function steer (humanLike, want, memory, player) {
  const { keys } = want
  // held on, or pressed where a jump is a jump; not pressed anew where it would be a double tap
  const held = memory.jumping && !want.released
  const tap = !memory.jumping && player.mayFly && memory.sinceJump < FLY_TAP_TICKS && !keys.fly
  let jump = !!keys.jump && (held || player.onGround || player.inLiquid || player.flying || !!keys.fly) && !tap
  memory.sinceJump++
  const controls = Object.fromEntries(CONTROLS.map(control => [control, !!keys[control]]))
  let look = want.look ? clientLook(want.look.yaw, want.look.pitch) : player.look
  if (humanLike) {
    const yaw = wrapDegrees(bedrockYaw(player.look.yaw))
    const pitch = bedrockPitch(player.look.pitch)
    const { target } = want
    if (target) {
      const turned = lookOf(wrapDegrees(yaw + turn(wrapDegrees(target.yaw - yaw), MAX_YAW)), pitch + turn(target.pitch - pitch, MAX_PITCH))
      look = clientLook(turned.yaw, turned.pitch)
    }
    const away = target ? Math.abs(wrapDegrees(target.yaw - yaw)) : 0
    const facingWay = away <= WALK_ANGLE
    controls.forward = controls.forward && facingWay
    controls.back = controls.back && facingWay
    controls.sprint = controls.sprint && controls.forward && away <= SPRINT_ANGLE
    jump = jump && (controls.forward || !keys.forward)
  }
  controls.jump = jump
  if (jump && !memory.jumping) memory.sinceJump = 0
  memory.jumping = jump
  return { look, controls }
}

class Steering {
  constructor (body) {
    this.body = body
    // the humanLike option
    this.enabled = false
    // the route left, for where the eyes rest while walking
    this.route = []
    // where the pathfinder looks: Bedrock degrees; none while it looks nowhere
    this.target = undefined
    // the keys the pathfinder holds
    this.wanted = Object.fromEntries(CONTROLS.map(control => [control, false]))
    // the pathfinder let go of jump since the last tick
    this.released = false
    // the jump key as tick() last gave it to the client, and the ticks since it was last pressed anew
    this.memory = { jumping: false, sinceJump: Infinity }
    // each prediction's own look and memory, by its PlayerState
    this.runs = new WeakMap()
  }

  // The walking look, in mineflayer's radians as the pathfinder gives it: toward the next step; the pitch is the
  // pathfinder's, or with humanLike the route's ahead. Without humanLike it is the client's as given, so the player
  // turns as the pathfinder's predictions turn it. Walking lets go of the back key the pathfinder holds to back to an
  // edge, which it keeps when it plans again on the way.
  look (yaw, pitch) {
    this.setControlState('back', false)
    if (!this.enabled) return this.body.setLook(yaw, pitch)
    this.target = this.targetOf(yaw, pitch, this.body.entity.position, !!this.body.state?.isInWater || !!this.body.state?.elytraFlying)
  }

  // where the pathfinder looks walking, from the feet: toward the next step, the eyes on the route ahead; in the water
  // or gliding the pathfinder's own pitch, which steers a swimmer and a glider
  targetOf (yaw, pitch, feet, inWater) {
    const eyes = { x: feet.x, y: feet.y + this.body.eyeHeight, z: feet.z }
    return { yaw: bedrockYaw(yaw), pitch: (inWater ? undefined : restPitch(this.route, feet, eyes)) ?? bedrockPitch(pitch) }
  }

  // A look at a point: the edge to bridge from, the block to break or place against
  lookAt (point) {
    if (!this.enabled) return this.body.lookAt(point)
    this.target = lookToward(this.body.eyes(), point)
  }

  setControlState (control, pressed) {
    this.wanted[control] = pressed
    // (the fly key is the pathfinder's word that its jumps are the double tap: no key of the client's)
    if (control === 'fly') return
    if (control === 'jump' && !pressed) this.released = true
    if (!pressed || (!this.enabled && control !== 'jump')) this.body.setControlState(control, pressed)
  }

  // Whether the pathfinder holds a key, pressed already or not
  wants (control) {
    return this.wanted[control]
  }

  // Lets go of every key, at once
  clearControlStates () {
    for (const control of CONTROLS) this.wanted[control] = false
    this.wanted.fly = false
    this.memory.jumping = false
    this.body.clearControlStates()
  }

  // Forgets where the pathfinder looked: the walk ended
  reset () {
    this.target = undefined
    this.route = []
  }

  // How far the look is from where the pathfinder looks: the angle between them, in degrees
  get off () {
    return this.target ? lookAngle(this.body.entity, this.target) : 0
  }

  // Whether the look got to where the pathfinder looks (it always has without humanLike)
  get settled () {
    return this.off < SETTLED
  }

  // The tick's turn toward where the pathfinder looks, and the keys: once a tick
  tick () {
    const { body } = this
    const player = body.state
    const want = { target: this.target, keys: this.wanted, released: this.released }
    const { look, controls } = steer(this.enabled, want, this.memory, { look: body.client.look, onGround: !!player?.onGround, inLiquid: !!player?.isInWater || !!player?.isInLava, flying: !!player?.bedrock?.flying, mayFly: !!player?.mayFly })
    this.released = false
    body.setLook(look.yaw, look.pitch)
    for (const control of CONTROLS) body.setControlState(control, controls[control])
  }

  // A tick of a prediction (a PlayerState the pathfinder simulates): the yaw, pitch and keys its controller gave are
  // what the pathfinder wants, steered as tick() steers them (the controller gives them every tick, letting go of jump
  // as the pathfinder does walking). Returns the inputs; each prediction keeps its own look and memory, from the
  // player's when it starts.
  predict (state) {
    let run = this.runs.get(state)
    if (!run) {
      run = { look: { ...this.body.client.look }, memory: { ...this.memory } }
      this.runs.set(state, run)
    }
    const want = this.enabled
      ? { target: this.targetOf(state.yaw, state.pitch, state.pos, !!state.isInWater || !!state.elytraFlying), keys: state.control, released: true }
      : { look: { yaw: state.yaw, pitch: state.pitch }, keys: state.control, released: true }
    const steered = steer(this.enabled, want, run.memory, { look: run.look, onGround: !!state.onGround, inLiquid: !!state.isInWater || !!state.isInLava, flying: !!state.bedrock?.flying, mayFly: !!state.mayFly })
    run.look = steered.look
    return steered
  }
}

module.exports = { Steering, lookAngle, steer, restPitch }
