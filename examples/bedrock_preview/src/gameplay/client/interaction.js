// What the player does to blocks: the block it looks at (a ray from its eyes through the world's blocks, against each
// block's shapes), breaking it (in creative, at once), using it (a fence gate opens or shuts, unless the player sneaks)
// and placing the block it holds against it. The client changes the
// block itself first, as the game's client predicts, and tells the server with an item use (inventory_transaction);
// the server's update_block confirms the block or puts back what it is. The hotbar is the inventory's first nine
// slots, as the server gave them, and the armour what the armour window has (an elytra worn glides). The held item is
// used in the air too: a firework rocket boosts a glide (the client's own boost, as the game's client gives itself).
const { heldItemWire, itemOf } = require('../protocol/items')
const { gateToggle } = require('../gates')
const { fieldType } = require('../protocol/schema')

// how far the player reaches (creative)
const REACH = 6
// a prediction the server has not answered in this many ticks is counted unconfirmed
const UNCONFIRMED_TICKS = 40
// the faces of a block, as Bedrock numbers them: the offset to the block beside each
const FACES = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]
const FULL = [[0, 0, 0, 1, 1, 1]]
const LIQUIDS = new Set(['water', 'flowing_water', 'lava', 'flowing_lava'])
// what a placed block takes the place of (the server's own list, server.js)
const REPLACEABLE = new Set(['air', 'water', 'flowing_water', 'lava', 'flowing_lava', 'short_grass', 'tallgrass', 'fern', 'deadbush', 'snow_layer', 'vine', 'seagrass'])

// where a ray (from `origin`, unit `dir`) enters a box, and through which face; null when it misses it within `far`
function rayBox (origin, dir, box, far) {
  let near = 0
  let face = -1
  for (const [axis, lowFace, highFace, lo, hi] of [['x', 4, 5, box[0], box[3]], ['y', 0, 1, box[1], box[4]], ['z', 2, 3, box[2], box[5]]]) {
    const o = origin[axis]
    const d = dir[axis]
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null
      continue
    }
    let t0 = (lo - o) / d
    let t1 = (hi - o) / d
    // entering through the low side when going up the axis
    let entered = lowFace
    if (t0 > t1) {
      [t0, t1] = [t1, t0]
      entered = highFace
    }
    if (t0 > near) {
      near = t0
      face = entered
    }
    if (t1 < far) far = t1
    if (near > far) return null
  }
  return face < 0 ? null : { t: near, face }
}

// The block a ray from the eyes hits within `reach`: { pos, face, point (in the block, 0..1), stateId, box }. A block
// without collision (a flower, a torch) is aimed at as a whole cube; liquids are looked through.
function raycast (world, eye, dir, reach = REACH) {
  const cell = { x: Math.floor(eye.x), y: Math.floor(eye.y), z: Math.floor(eye.z) }
  const step = { x: Math.sign(dir.x), y: Math.sign(dir.y), z: Math.sign(dir.z) }
  const next = axis => step[axis] > 0 ? (cell[axis] + 1 - eye[axis]) / dir[axis] : step[axis] < 0 ? (eye[axis] - cell[axis]) / -dir[axis] : Infinity
  const delta = axis => step[axis] ? Math.abs(1 / dir[axis]) : Infinity
  const tMax = { x: next('x'), y: next('y'), z: next('z') }
  const tDelta = { x: delta('x'), y: delta('y'), z: delta('z') }
  for (let t = 0; t <= reach;) {
    const block = world.getBlock(cell)
    if (block && block.name !== 'air' && !LIQUIDS.has(block.name)) {
      const shapes = block.shapes?.length ? block.shapes : FULL
      let best = null
      for (const shape of shapes) {
        const box = [cell.x + shape[0], cell.y + shape[1], cell.z + shape[2], cell.x + shape[3], cell.y + shape[4], cell.z + shape[5]]
        const hit = rayBox(eye, dir, box, reach)
        if (hit && (!best || hit.t < best.t)) best = { ...hit, box }
      }
      if (best) {
        const point = { x: eye.x + dir.x * best.t - cell.x, y: eye.y + dir.y * best.t - cell.y, z: eye.z + dir.z * best.t - cell.z }
        return { pos: { ...cell }, face: best.face, point, stateId: block.stateId, name: block.name, box: best.box }
      }
    }
    const axis = tMax.x < tMax.y ? (tMax.x < tMax.z ? 'x' : 'z') : (tMax.y < tMax.z ? 'y' : 'z')
    t = tMax[axis]
    cell[axis] += step[axis]
    tMax[axis] += tDelta[axis]
  }
  return null
}

class Interaction {
  constructor (client) {
    this.client = client
    this.hotbar = []
    this.selectedSlot = 0
    // head, chest, legs, feet
    this.armor = []
    // 'x,y,z' -> the tick the client changed the block on
    this.predictions = new Map()
  }

  target (eye, dir, reach = REACH) {
    return raycast(this.client.movement.world, eye, dir, reach)
  }

  get held () {
    return this.hotbar[this.selectedSlot]
  }

  // inventory_content / inventory_slot of the inventory: the hotbar's slots
  setSlots (list, start = 0) {
    const { registry } = this.client
    list.forEach((raw, i) => {
      const slot = start + i
      if (slot >= 9) return
      const item = itemOf(raw)
      this.hotbar[slot] = item.networkId ? { ...item, name: registry.items[item.networkId]?.name ?? `item ${item.networkId}` } : undefined
    })
    this.client.emit('hotbar', this.hotbar, this.selectedSlot)
  }

  // inventory_content / inventory_slot of the armour window
  setArmor (list, start = 0) {
    const { registry } = this.client
    list.forEach((raw, i) => {
      const item = itemOf(raw)
      this.armor[start + i] = item.networkId ? { ...item, name: registry.items[item.networkId]?.name ?? `item ${item.networkId}` } : undefined
    })
    this.client.emit('armor', this.armor)
  }

  // whether the player wears an elytra (the chest's)
  get elytra () {
    return this.armor[1]?.name === 'elytra'
  }

  // The held item used in the air (an item use clicking no block): a firework rocket boosts the glide from the next
  // tick, and in survival one of the stack goes. Whether something was used.
  useItem () {
    const { client } = this
    const item = this.held
    if (!item || client.gamemode === 'spectator') return false
    if (item.name === 'firework_rocket') {
      client.movement.useFirework()
      if (client.gamemode !== 'creative') {
        this.hotbar[this.selectedSlot] = item.count > 1 ? { ...item, count: item.count - 1, raw: { ...item.raw, count: item.count - 1 } } : undefined
        client.emit('hotbar', this.hotbar, this.selectedSlot)
      }
    }
    // (no face: -1, a byte of 255 where the version writes the face in one, from 1.26.50)
    const face = fieldType(client.codec.types, 'TransactionUseItem', 'face') === 'u8' ? 255 : -1
    this.use('click_air', { pos: { x: 0, y: 0, z: 0 }, face, point: { x: 0, y: 0, z: 0 }, stateId: 0 }, item)
    return true
  }

  selectSlot (slot, tell = true) {
    this.selectedSlot = Math.max(0, Math.min(8, slot))
    this.client.emit('hotbar', this.hotbar, this.selectedSlot)
    if (!tell) return
    const { client } = this
    // (1.16.201 names the window windows_id)
    client.queue('mob_equipment', { runtime_entity_id: client.runtimeId, item: heldItemWire(this.held?.raw), slot: this.selectedSlot, selected_slot: this.selectedSlot, window_id: 'inventory', windows_id: 'inventory' })
  }

  // creative: the block goes at once (the water it held stays)
  breakBlock (target) {
    const { client } = this
    if (!target || client.gamemode !== 'creative') return false
    const { registry, chunks } = client
    const air = registry.blocksByName.air.defaultState
    const held = chunks.getBlockStateId(target.pos, 1) ?? air
    const water = /water$/.test(registry.blocksByStateId[held]?.name ?? '')
    chunks.setBlock(target.pos, water ? held : air)
    if (held !== air) chunks.setBlock(target.pos, air, 1)
    this.use('break_block', target)
    return true
  }

  // Where the held block would go against the face aimed at, and its state: null where it would not (nothing in hand,
  // nothing replaceable there, the player in the way)
  placement (target) {
    const { client } = this
    const item = this.held
    if (!target || !item || client.gamemode === 'spectator') return null
    const { registry, chunks } = client
    const [dx, dy, dz] = FACES[target.face]
    const at = { x: target.pos.x + dx, y: target.pos.y + dy, z: target.pos.z + dz }
    const there = registry.blocksByStateId[chunks.getBlockStateId(at) ?? -1]?.name ?? 'air'
    const stateId = item.blockRuntimeId || registry.blocksByName[item.name]?.defaultState
    if (!REPLACEABLE.has(there) || stateId === undefined || this.inPlayer(at)) return null
    return { at, stateId }
  }

  // The state a use of the block aimed at would turn it to (a fence gate opened or shut); null where a use does
  // nothing to it, or the player sneaks (it then places against it)
  useOf (target) {
    if (!target || this.client.controls.sneak || this.client.gamemode === 'spectator') return null
    return gateToggle(this.client.registry)(target.stateId)
  }

  // the use of the block aimed at: a gate opens or shuts; else the held block goes against the face aimed at
  placeBlock (target) {
    const { client } = this
    const { registry, chunks } = client
    const used = this.useOf(target)
    if (used !== null) {
      chunks.setBlock(target.pos, used)
      this.predictions.set(`${target.pos.x},${target.pos.y},${target.pos.z}`, client.movement.last)
      this.use('click_block', target)
      return true
    }
    const placement = this.placement(target)
    if (!placement) return false
    const { at, stateId } = placement
    chunks.setBlock(at, stateId)
    if ((chunks.getBlockStateId(at, 1) ?? 0) !== registry.blocksByName.air.defaultState) chunks.setBlock(at, registry.blocksByName.air.defaultState, 1)
    this.predictions.set(`${at.x},${at.y},${at.z}`, this.client.movement.last)
    this.use('click_block', target)
    return true
  }

  inPlayer (at) {
    const { pos } = this.client.movement.player
    return at.x < pos.x + 0.3 && at.x + 1 > pos.x - 0.3 && at.y < pos.y + 1.8 && at.y + 1 > pos.y && at.z < pos.z + 0.3 && at.z + 1 > pos.z - 0.3
  }

  // the item use, as the version writes it (fill gives the fields of the version's transaction: 1.16.201 has one of its
  // own, 1.16.210 another list of actions, 1.26.30 an optional type)
  use (action, target, held = this.held) {
    const { client } = this
    const { pos } = client.movement.player
    const eyes = { x: pos.x, y: pos.y + client.movement.physics.eyeHeight, z: pos.z }
    if (action === 'break_block') this.predictions.set(`${target.pos.x},${target.pos.y},${target.pos.z}`, client.movement.last)
    client.queue('inventory_transaction', {
      transaction: {
        legacy: { legacy_request_id: 0 },
        legacy_request_id: 0,
        transaction_type: 'item_use',
        transaction_data: {
          action_type: action,
          trigger_type: 'player_input',
          block_position: target.pos,
          face: target.face,
          hotbar_slot: this.selectedSlot,
          hand: 'main_hand',
          held_item: heldItemWire(held?.raw),
          player_pos: eyes,
          click_pos: target.point,
          block_runtime_id: target.stateId ?? 0,
          client_prediction: 'success',
          client_cooldown_state: 'off'
        }
      }
    })
  }

  // update_block: the server's answer to a prediction there (or a change of its own)
  confirm (pos) {
    this.predictions.delete(`${pos.x},${pos.y},${pos.z}`)
  }

  // predictions the server left unanswered
  unconfirmed (tick) {
    let count = 0
    for (const at of this.predictions.values()) if (at !== null && tick - at > BigInt(UNCONFIRMED_TICKS)) count++
    return count
  }
}

module.exports = { Interaction, raycast, rayBox, REACH, FACES }
