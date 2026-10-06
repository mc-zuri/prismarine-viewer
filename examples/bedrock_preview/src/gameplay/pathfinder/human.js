// The look and the keys the pathfinder gives, on their way to the client (bedrock-demo
// packages/bedrock-client-pathfinder/src/human.ts). Without the humanLike option each is the client's at once. With it
// they are given as a person gives them: the look turns toward where the pathfinder looks at a person's pace, half of
// what is left each tick and no more than MAX_YAW and MAX_PITCH degrees, and while walking the eyes rest on the route
// a few blocks ahead rather than on the horizon; the walking keys wait for the facing (no forward or back while the
// player faces more than WALK_ANGLE away from where the pathfinder looks, no sprint more than SPRINT_ANGLE away), and a
// jump to get somewhere waits for the walk. tick() turns and presses, once a tick. Either way the jump key is not
// pressed anew in the air: it is pressed on the ground or in a liquid, and held on from there (a pillar's jump).
const { CONTROLS, wrapDegrees, facing, lookToward } = require('./body')

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
  }

  // The walking look: toward the next step; the pitch is the pathfinder's, or with humanLike the route's ahead. Walking
  // lets go of the back key the pathfinder holds to back to an edge, which it keeps when it plans again on the way.
  look (yaw, pitch) {
    this.setControlState('back', false)
    if (!this.enabled) return this.body.look(yaw, pitch)
    this.target = { yaw, pitch: this.restPitch() ?? pitch }
  }

  // A look at a point: the edge to bridge from, the block to break or place against
  lookAt (point) {
    if (!this.enabled) return this.body.lookAt(point)
    this.target = lookToward(this.body.eyes(), point)
  }

  setControlState (control, pressed) {
    this.wanted[control] = pressed
    if (!pressed || (!this.enabled && control !== 'jump')) this.body.setControlState(control, pressed)
  }

  // Whether the pathfinder holds a key, pressed already or not
  wants (control) {
    return this.wanted[control]
  }

  // Lets go of every key, at once
  clearControlStates () {
    for (const control of CONTROLS) this.wanted[control] = false
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

  // The tick's turn toward where the pathfinder looks, and the keys the facing allows: with humanLike, once a tick
  tick () {
    const { body } = this
    const entity = body.entity
    const state = body.state
    // held on, or pressed where a jump is a jump
    const jump = this.wanted.jump && (body.controls.jump || entity.onGround || !!state?.isInWater || !!state?.isInLava)
    if (!this.enabled) return body.setControlState('jump', jump)
    if (this.target) {
      const yaw = turn(wrapDegrees(this.target.yaw - entity.yaw), MAX_YAW)
      const pitch = turn(this.target.pitch - entity.pitch, MAX_PITCH)
      body.look(wrapDegrees(entity.yaw + yaw), entity.pitch + pitch)
    }
    const away = this.target ? Math.abs(wrapDegrees(this.target.yaw - entity.yaw)) : 0
    const facingWay = away <= WALK_ANGLE
    const { wanted } = this
    const walk = wanted.forward && facingWay
    body.setControlState('forward', walk)
    body.setControlState('back', wanted.back && facingWay)
    body.setControlState('left', wanted.left)
    body.setControlState('right', wanted.right)
    body.setControlState('sneak', wanted.sneak)
    body.setControlState('sprint', wanted.sprint && walk && away <= SPRINT_ANGLE)
    body.setControlState('jump', jump && (walk || !wanted.forward))
  }

  // the pitch toward the route LOOK_AHEAD blocks ahead, at a person's chest over it; none without a route
  restPitch () {
    let from = this.body.entity.position
    let left = LOOK_AHEAD
    let ahead
    for (const point of this.route) {
      ahead = point
      left -= Math.hypot(point.x - from.x, point.z - from.z)
      if (left <= 0) break
      from = point
    }
    if (!ahead) return undefined
    const { pitch } = lookToward(this.body.eyes(), { x: ahead.x, y: ahead.y + LOOK_HEIGHT, z: ahead.z })
    return Math.max(REST_PITCH.up, Math.min(REST_PITCH.down, pitch))
  }
}

module.exports = { Steering, lookAngle }
