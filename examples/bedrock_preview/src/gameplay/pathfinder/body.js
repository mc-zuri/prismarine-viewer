// The player as the pathfinder's steering and hands move it, over the gameplay client: its feet and velocity, its look
// in Bedrock's degrees (yaw 0 faces +z, pitch positive looks down; the client keeps mineflayer's radians), its keys, the
// blocks around it and the block in its crosshair. The engine's state of the player (in water, sneaking) is the
// player itself: the client's movement steps it.
const { bedrockYaw, bedrockPitch, lookOf } = require('../client/movement')

const CONTROLS = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']
// how far the crosshair reaches, as the page's
const REACH = 6

// Degrees from -180 to 180
const wrapDegrees = degrees => ((((degrees + 180) % 360) + 360) % 360) - 180

// the way a look faces, as a vector: Bedrock degrees
function facing (yaw, pitch) {
  const y = (yaw * Math.PI) / 180
  const p = (pitch * Math.PI) / 180
  return { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) }
}

// The look toward a point from the eyes: Bedrock degrees
function lookToward (eyes, point) {
  const dx = point.x - eyes.x
  const dy = point.y - eyes.y
  const dz = point.z - eyes.z
  return { yaw: (Math.atan2(-dx, dz) * 180) / Math.PI, pitch: (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI }
}

function bodyOf (client) {
  const body = {
    client,
    // the feet, velocity, ground and look
    get entity () {
      const player = client.player
      return { position: player.pos, velocity: player.vel, onGround: player.onGround, yaw: wrapDegrees(bedrockYaw(client.look.yaw)), pitch: bedrockPitch(client.look.pitch) }
    },
    // the engine's player: in water, in lava, its Bedrock state (sneaking)
    get state () {
      return client.player
    },
    get controls () {
      return client.controls
    },
    get sneaking () {
      return !!client.player?.bedrock?.sneaking
    },
    eyes () {
      const { pos } = client.player
      return { x: pos.x, y: pos.y + client.movement.physics.eyeHeight, z: pos.z }
    },
    look (yaw, pitch) {
      const look = lookOf(yaw, pitch)
      client.setLook(look.yaw, look.pitch)
    },
    // the look in mineflayer's radians, as is
    setLook (yaw, pitch) {
      client.setLook(yaw, pitch)
    },
    lookAt (point) {
      const { yaw, pitch } = lookToward(body.eyes(), point)
      body.look(yaw, pitch)
    },
    setControlState (control, pressed) {
      client.setControl(control, pressed)
    },
    clearControlStates () {
      for (const control of CONTROLS) client.setControl(control, false)
    },
    // the block at a place as the engine reads it (its shapes, its state), or null where the client has none
    blockAt (position) {
      return client.movement.world.getBlock(position)
    },
    // the block the crosshair is on now: { pos, face, point, stateId, name, box }, or null
    target () {
      const { yaw, pitch } = body.entity
      return client.target(body.eyes(), facing(yaw, pitch), REACH)
    }
  }
  return body
}

module.exports = { bodyOf, CONTROLS, REACH, wrapDegrees, facing, lookToward }
