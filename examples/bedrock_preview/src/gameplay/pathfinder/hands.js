// The player's hands for the pathfinder (mineflayer's dig, stopDigging, placeBlock, activateBlock and equip), as the
// player uses them (bedrock-demo packages/bedrock-client-pathfinder/src/hands.ts). The crosshair goes on the block
// first: on a point of it the ray from the eyes reaches, on the face asked for when placing against it. Then the block
// is broken (in creative: at once, as the server here breaks blocks), the held block placed once the client would place
// it there (a pillar's block once the jump took the player over it), or a gate used. An item is taken in hand by its
// hotbar slot. With the humanLike option the crosshair turns onto the block as the look turns (human.js), and the hand
// waits a person's moment more.

// the faces, by number: down, up, north, south, west, east
const FACES = [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]
// where on a face to aim: its middle, then nearer its corners
const SPOTS = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.15], [0.5, 0.85], [0.15, 0.5], [0.85, 0.5]]
const FULL_BLOCK = [0, 0, 0, 1, 1, 1]
const HOTBAR_SIZE = 9
// ticks given to the crosshair to reach a block (the player may still slide), and to a placement the client would make
const AIM_TICKS = 20
const PLACE_TICKS = 20
// humanLike: the ticks between the crosshair settling and the press, a person's moment
const REACTION_TICKS = [2, 4]

const same = (a, b) => !!a && a.x === b.x && a.y === b.y && a.z === b.z
const floored = v => ({ x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) })

class Hands {
  constructor (body, steering, emit) {
    this.body = body
    this.client = body.client
    this.steering = steering
    this.emit = emit
    this.digging = undefined
    // the waits for a tick going on, which cancel() ends
    this.waits = new Set()
  }

  // Breaks the block: the crosshair on it, then broken
  async dig (block) {
    if (this.digging) this.stopDigging()
    const position = floored(block.position)
    // gone already: the plugin may ask again for a block that broke as it planned
    if (this.open(position)) return
    const digging = { position, stopped: false }
    this.digging = digging
    try {
      await this.aim(position, undefined, () => digging.stopped)
      await this.react(() => digging.stopped)
      if (digging.stopped) throw new Error('digging aborted')
      if (this.client.gamemode !== 'creative') throw new Error('dig: blocks break in creative only here')
      const hit = this.body.target()
      if (!same(hit?.pos, position)) throw new Error('dig: the block is not in the crosshair')
      if (!this.client.breakBlock(hit)) throw new Error('dig: the block did not break')
      this.emit('diggingCompleted', block)
    } catch (error) {
      this.emit('diggingAborted', block)
      throw error
    } finally {
      if (this.digging === digging) this.digging = undefined
    }
  }

  // Lets go of the block being broken
  stopDigging () {
    if (!this.digging) return
    this.digging.stopped = true
    this.digging = undefined
  }

  // Ends what the hands are doing: the walk ended
  cancel () {
    this.stopDigging()
    for (const end of [...this.waits]) end(new Error('cancelled'))
  }

  // Places the block in hand against a face of a block: once the client would place it there
  async placeBlock (reference, face) {
    const position = floored(reference.position)
    const side = FACES.findIndex(f => same(f, face))
    if (side < 0) throw new Error(`place: ${face.x} ${face.y} ${face.z} is not a face`)
    const placed = { x: position.x + face.x, y: position.y + face.y, z: position.z + face.z }
    // there already: the plugin may ask again for the block it just placed, before it planned on
    if (!this.open(placed)) return
    await this.aim(position, side)
    await this.react()
    // the pathfinder sneaks to place against a block that opens: the engine (and the server) must know of the sneak first
    await this.until(() => !this.steering.wants('sneak') || this.body.sneaking, PLACE_TICKS)
    const { interaction } = this.client
    let target = null
    await this.until(() => {
      target = this.body.target()
      if (!this.onBlock(target, position, side)) {
        this.lookAt(this.aimPoint(position, side))
        return false
      }
      return interaction.useOf(target) === null && same(interaction.placement(target)?.at, placed)
    }, PLACE_TICKS, 'place: the click would place no block there')
    if (!this.client.placeBlock(target)) throw new Error('place: the block did not go in')
  }

  // Uses the block: a gate opens
  async activateBlock (block) {
    const position = floored(block.position)
    // open already: a use would shut it
    if (this.open(position)) return
    await this.aim(position)
    await this.react()
    const target = this.body.target()
    if (this.client.interaction.useOf(target) === null) throw new Error('activate: a use does nothing to it')
    this.client.placeBlock(target)
  }

  // Uses the held item in the air: a firework rocket boosts the glide
  useItem () {
    if (!this.client.useItem()) throw new Error('use: nothing in hand')
  }

  // Takes an item in hand: its hotbar slot (the inventory past it is not the client's here)
  async equip (item, destination = 'hand') {
    if (destination !== 'hand') throw new Error(`equip: only to the hand, not ${destination}`)
    if (item.slot >= HOTBAR_SIZE) throw new Error('equip: only from the hotbar')
    if (this.client.interaction.selectedSlot !== item.slot) this.client.selectSlot(item.slot)
  }

  // Puts the crosshair on the block (on the face, when given): at once, or with humanLike as the look turns. Waits
  // while the block is out of the ray's reach (the player sliding to a stop).
  async aim (position, face, stopped = () => false) {
    for (let tick = 0; ; tick++) {
      if (stopped()) return
      const point = this.aimPoint(position, face)
      if (point) {
        this.lookAt(point)
        if (this.steering.settled && this.onBlock(this.body.target(), position, face)) return
      }
      if (tick >= AIM_TICKS) throw new Error(`the block at ${position.x} ${position.y} ${position.z} is ${point ? 'not in the crosshair' : 'out of sight'}`)
      await this.step()
    }
  }

  lookAt (point) {
    if (point) this.steering.lookAt(point)
  }

  // whether nothing stops the player in the cell: air, a liquid, a plant, an open gate
  open (position) {
    return !this.body.blockAt(position)?.shapes?.length
  }

  // whether the crosshair is on the block, and on the face when given
  onBlock (hit, position, face) {
    return same(hit?.pos, position) && (face === undefined || hit.face === face)
  }

  // A point of the block the ray from the eyes reaches first (of the face, when given): the middles of its faces that
  // look toward the eyes first, then points nearer their corners. Tried by turning the look, which is put back.
  aimPoint (position, face) {
    const { body, client } = this
    const look = { ...client.look }
    const eyes = body.eyes()
    const shapes = body.blockAt(position)?.shapes
    const boxes = shapes?.length ? shapes : [FULL_BLOCK]
    const faces = face === undefined ? [0, 1, 2, 3, 4, 5] : [face]
    const candidates = []
    for (const box of boxes) {
      for (const side of faces) {
        const normal = FACES[side]
        // the face's plane, and the two axes across it
        const axis = normal.x !== 0 ? 'x' : normal.y !== 0 ? 'y' : 'z'
        const [u, v] = ['x', 'y', 'z'].filter(other => other !== axis)
        const at = name => {
          const index = { x: 0, y: 1, z: 2 }[name]
          return [box[index], box[index + 3]]
        }
        const plane = (normal[axis] > 0 ? at(axis)[1] : at(axis)[0]) + position[axis]
        const facing = (eyes[axis] - plane) * normal[axis]
        if (face === undefined && facing <= 0) continue
        for (const [su, sv] of SPOTS) {
          const point = { x: 0, y: 0, z: 0 }
          point[axis] = plane
          point[u] = position[u] + at(u)[0] + (at(u)[1] - at(u)[0]) * su
          point[v] = position[v] + at(v)[0] + (at(v)[1] - at(v)[0]) * sv
          candidates.push({ point, facing })
        }
      }
    }
    candidates.sort((a, b) => b.facing - a.facing)
    try {
      for (const { point } of candidates) {
        body.lookAt(point)
        if (this.onBlock(body.target(), position, face)) return point
      }
    } finally {
      client.setLook(look.yaw, look.pitch)
    }
    return undefined
  }

  // humanLike: a person's moment before the press
  async react (stopped = () => false) {
    if (!this.steering.enabled) return
    const [least, most] = REACTION_TICKS
    const ticks = least + Math.floor(Math.random() * (most - least + 1))
    for (let tick = 0; tick < ticks && !stopped(); tick++) await this.step()
  }

  // ticks until `done`, at most `most`: then it throws `failure`, or just returns
  async until (done, most, failure) {
    for (let tick = 0; !done(); tick++) {
      if (tick >= most) {
        if (failure) throw new Error(failure)
        return
      }
      await this.step()
    }
  }

  // the next tick the player moved; the client's close and cancel() end the wait
  step () {
    return new Promise((resolve, reject) => {
      const { client } = this
      const done = () => {
        client.off('step', stepped)
        client.off('close', closed)
        this.waits.delete(end)
      }
      const stepped = () => {
        done()
        resolve()
      }
      const end = error => {
        done()
        reject(error)
      }
      const closed = () => end(new Error('the client closed'))
      this.waits.add(end)
      client.on('step', stepped)
      client.on('close', closed)
    })
  }
}

module.exports = { Hands, FACES, HOTBAR_SIZE }
