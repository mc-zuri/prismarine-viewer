// Where the camera is and what it looks at, as Minecraft Bedrock's vanilla cameras place it (bedrock-demo
// packages/bedrock-client-viewer/web/three/camera: rig.ts, avoidance.ts, shapes.ts):
// - first person: in the player's eyes, along its look;
// - third person: on a sphere of radius 4 around the eyes, behind the look, looking at the eyes;
// - walk: on a sphere the mouse turns, looking at the eyes; while a key moves the player, the player turns the way the
//   camera looks, so forward is away from the camera.
// A camera behind the player comes as close as the blocks between it and the eyes leave room for, as Bedrock's
// CameraAvoidanceSystem works it out: eight parallel rays, from the corners of a cube of 0.2 around the eyes toward the
// camera; the nearest box one meets, measured from the eyes, less the near plane, is how far the camera may be, but
// never closer than 0.25. With the eyes inside a whole cube, the camera is in the eyes. Angles are Bedrock's degrees
// (yaw 0 faces +z, pitch positive looks down).

const THIRD_PERSON_DISTANCE = 4
const WALK_DISTANCE = { min: 2, max: 16, initial: 6 }
// the walk camera looks down on the player at least this much when the view opens: the ground to click on shows
const WALK_PITCH = 30
const MAX_PITCH = 89.9
const RADIANS = Math.PI / 180
const CORNER = 0.1
const MIN_DISTANCE = 0.25
// a ray of the camera is at most a few dozen blocks: a bound on the blocks it may cross
const MAX_STEPS = 200

const wrapDegrees = degrees => ((((degrees + 180) % 360) + 360) % 360) - 180
const clampPitch = pitch => Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch))

// The way a look faces
function forward ({ yaw, pitch }) {
  const y = yaw * RADIANS
  const p = pitch * RADIANS
  return { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) }
}

// The camera at `distance` behind a look from the eyes (0: in them), as close as `avoid` allows
function placeCamera (eye, angles, distance, avoid) {
  const f = forward(angles)
  const along = d => ({ x: eye.x - f.x * d, y: eye.y - f.y * d, z: eye.z - f.z * d })
  const allowed = distance > 0 && avoid ? Math.min(distance, avoid(eye, along(distance))) : distance
  if (allowed <= 0) return { position: eye, target: along(-1), distance: 0 }
  return { position: along(allowed), target: eye, distance: allowed }
}

class CameraRig {
  // look: the player's look { yaw, pitch, set(yaw, pitch) }; moving(): whether a key moves the player
  constructor (look, moving) {
    this.mode = 'first'
    // the walk camera's angles and distance
    this.orbit = { yaw: 0, pitch: WALK_PITCH, distance: WALK_DISTANCE.initial }
    this.look = look
    this.moving = moving
  }

  // Another mode: the camera keeps facing the way it faced, the walk camera looking down a little
  setMode (mode) {
    if (mode === this.mode) return
    if (mode === 'walk') Object.assign(this.orbit, { yaw: this.look.yaw, pitch: Math.max(WALK_PITCH, this.look.pitch) })
    else if (this.mode === 'walk') this.look.set(this.orbit.yaw, this.orbit.pitch)
    this.mode = mode
  }

  // Turns the walk camera; false in the other modes, where the camera is the player's look
  turn (dYaw, dPitch) {
    if (this.mode !== 'walk') return false
    this.orbit.yaw = wrapDegrees(this.orbit.yaw + dYaw)
    this.orbit.pitch = clampPitch(this.orbit.pitch + dPitch)
    return true
  }

  // Moves the walk camera closer (factor under 1) or further
  zoom (factor) {
    this.orbit.distance = Math.max(WALK_DISTANCE.min, Math.min(WALK_DISTANCE.max, this.orbit.distance * factor))
  }

  place (eye, avoid) {
    if (this.mode === 'first') return placeCamera(eye, this.look, 0)
    if (this.mode === 'third') return placeCamera(eye, this.look, THIRD_PERSON_DISTANCE, avoid)
    if (this.moving()) this.look.set(this.orbit.yaw, this.look.pitch)
    return placeCamera(eye, this.orbit, this.orbit.distance, avoid)
  }
}

// Where a ray from `o` along `d` (t from 0 to 1) meets a box, from inside where it leaves it; undefined if it does not
function rayBox (o, d, min, max) {
  let near = -Infinity
  let far = Infinity
  for (const axis of ['x', 'y', 'z']) {
    if (d[axis] === 0) {
      if (o[axis] < min[axis] || o[axis] > max[axis]) return
      continue
    }
    const t1 = (min[axis] - o[axis]) / d[axis]
    const t2 = (max[axis] - o[axis]) / d[axis]
    near = Math.max(near, Math.min(t1, t2))
    far = Math.min(far, Math.max(t1, t2))
  }
  if (far < near || far < 0 || near > 1) return
  if (near >= 0) return near
  return far <= 1 ? far : undefined
}

// The blocks as the camera sees them: their collision boxes (a block's shapes), read from the client's world; a ray
// walks the blocks it crosses, nearest first, and stops at the first box it meets
function cameraBlocks (getBlock) {
  const boxesAt = (x, y, z) => getBlock({ x, y, z })?.shapes ?? []
  return {
    // Whether a point is inside a whole solid cube
    inWall (p) {
      return boxesAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)).some(([x0, y0, z0, x1, y1, z1]) => x0 <= 0 && y0 <= 0 && z0 <= 0 && x1 >= 1 && y1 >= 1 && z1 >= 1)
    },
    // Where a ray from one point to another first meets a box, or undefined
    clip (from, to) {
      const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
      const cell = { x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) }
      const end = { x: Math.floor(to.x), y: Math.floor(to.y), z: Math.floor(to.z) }
      const step = { x: Math.sign(d.x), y: Math.sign(d.y), z: Math.sign(d.z) }
      const next = axis => d[axis] === 0 ? Infinity : ((step[axis] > 0 ? cell[axis] + 1 : cell[axis]) - from[axis]) / d[axis]
      const tMax = { x: next('x'), y: next('y'), z: next('z') }
      const tDelta = { x: Math.abs(1 / d.x), y: Math.abs(1 / d.y), z: Math.abs(1 / d.z) }
      for (let i = 0; i < MAX_STEPS; i++) {
        // a box is within its block: the first block with a hit has the nearest
        let best
        for (const [x0, y0, z0, x1, y1, z1] of boxesAt(cell.x, cell.y, cell.z)) {
          const t = rayBox(from, d, { x: cell.x + x0, y: cell.y + y0, z: cell.z + z0 }, { x: cell.x + x1, y: cell.y + y1, z: cell.z + z1 })
          if (t !== undefined && (best === undefined || t < best)) best = t
        }
        if (best !== undefined) return { x: from.x + d.x * best, y: from.y + d.y * best, z: from.z + d.z * best }
        if (cell.x === end.x && cell.y === end.y && cell.z === end.z) return
        const axis = tMax.x < tMax.y ? (tMax.x < tMax.z ? 'x' : 'z') : (tMax.y < tMax.z ? 'y' : 'z')
        if (tMax[axis] > 1) return
        cell[axis] += step[axis]
        tMax[axis] += tDelta[axis]
      }
    }
  }
}

// The distance from the eyes the eight rays leave free toward the camera: Infinity when none meets a block
function clearDistance (blocks, eye, camera, near) {
  const d = { x: camera.x - eye.x, y: camera.y - eye.y, z: camera.z - eye.z }
  let clear = Infinity
  for (let i = 0; i < 8; i++) {
    const from = {
      x: eye.x + (((2 * i) & 2) - 1) * CORNER,
      y: eye.y + ((i & 2) - 1) * CORNER,
      z: eye.z + (((i >> 1) & 2) - 1) * CORNER
    }
    const hit = blocks.clip(from, { x: from.x + d.x, y: from.y + d.y, z: from.z + d.z })
    if (!hit) continue
    const distance = Math.hypot(eye.x - hit.x, eye.y - hit.y, eye.z - hit.z)
    clear = Math.min(clear, Math.max(near, distance - near))
  }
  return clear
}

// How far from the eyes a camera wanted at `camera` may be: 0 for the eyes themselves
function cameraDistance (blocks, eye, camera, near) {
  if (blocks.inWall(eye)) return 0
  const wanted = Math.hypot(camera.x - eye.x, camera.y - eye.y, camera.z - eye.z)
  const clear = clearDistance(blocks, eye, camera, near)
  return wanted < clear ? wanted : Math.max(clear, MIN_DISTANCE)
}

module.exports = { CameraRig, placeCamera, forward, cameraBlocks, cameraDistance, wrapDegrees, WALK_DISTANCE }
