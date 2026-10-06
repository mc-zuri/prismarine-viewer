// The entities the server added (boats), and the boat the player rides (bedrock-demo
// packages/bedrock-client/src/movement/riding.ts): set_entity_link links the player to it as its driver, and the
// engine steps the boat as the game's client predicts it (the paddles, the turn, the buoyancy) from the player's keys,
// the player in its seat; the player's input reports the boat (from 1.20.71: before, the input reports the rider, as
// it cannot report a vehicle). The sneak key pressed leaves the boat, as a link of type 0 from the server takes the
// player off: it stands where the engine's dismount puts it, and tells the server (interact leave_vehicle).
const { Vec3 } = require('vec3')

const f = Math.fround
// set_entity_link's types: the link removed, the rider that steers
const REMOVE = 0
// the vehicles the client predicts when it drives one
const BOATS = ['boat', 'chest_boat']
// a boat driver's seat
const SEAT = { x: 0, y: f(1.0200101), z: 0 }
// move_entity's flags as the vanilla client sends them for the boat it drives (the rotation is pitch, yaw and head yaw
// on the wire, which the schema names yaw, pitch, head_yaw)
const MOVE_FLAGS = 248

const kindOf = type => String(type).replace(/^minecraft:/, '')

class Riding {
  constructor (client) {
    this.client = client
    // runtime id -> { runtimeId, uniqueId, type, pos, yaw }
    this.entities = new Map()
    // the entity the player rides
    this.entity = null
    this.sneaking = false
  }

  get vehicle () {
    return this.client.player?.vehicle
  }

  added (params) {
    const uniqueId = BigInt(params.unique_id ?? params.entity_id_self)
    const runtimeId = BigInt(params.runtime_id ?? params.runtime_entity_id)
    // (1.16.201 has the position's coordinates as fields)
    const { x, y, z } = params.position ?? params
    this.entities.set(runtimeId, { runtimeId, uniqueId, type: params.entity_type, pos: { x, y, z }, yaw: params.yaw ?? 0 })
    this.client.emit('entities', this.entities)
  }

  removed (params) {
    const uniqueId = BigInt(params.entity_id_self)
    for (const entity of this.entities.values()) {
      if (entity.uniqueId !== uniqueId) continue
      if (this.entity === entity) this.leave(false, true, false)
      this.entities.delete(entity.runtimeId)
    }
    this.client.emit('entities', this.entities)
  }

  byUniqueId (uniqueId) {
    for (const entity of this.entities.values()) if (entity.uniqueId === uniqueId) return entity
    return undefined
  }

  // set_entity_link: the player gets on a boat as its driver, or off
  link ({ ridden_entity_id: ridden, rider_entity_id: rider, type }) {
    if (BigInt(rider) !== this.client.runtimeId) return
    const entity = this.byUniqueId(BigInt(ridden))
    if (Number(type) === REMOVE) {
      if (this.entity && this.entity === entity) this.leave(false, true, false)
      return
    }
    if (entity) this.mount(entity)
  }

  mount (entity) {
    const player = this.client.player
    if (!player) return
    if (this.entity) this.leave(false, true, false)
    const kind = kindOf(entity.type)
    player.vehicle = {
      id: entity.uniqueId,
      kind,
      pos: new Vec3(f(entity.pos.x), f(entity.pos.y), f(entity.pos.z)),
      // a boat the player drives starts at rest
      vel: new Vec3(0, 0, 0),
      yaw: f(entity.yaw),
      pitch: 0,
      predicted: BOATS.includes(kind),
      jumpControlled: false,
      seat: { ...SEAT }
    }
    this.entity = entity
    this.client.emit('mount', entity)
  }

  // Leaves the boat: the player stands at the dismount spot and tells the server where (its eyes). `byRider` false: the
  // server took it off; `unlinked`: the server's link removal did; `tell` false: nothing to say
  leave (byRider = true, unlinked = false, tell = true) {
    const { client } = this
    const player = client.player
    const entity = this.entity
    if (!player?.vehicle || !entity) return
    this.follow()
    const { movement } = client
    movement.physics.dismount(player, movement.world, byRider, undefined, unlinked)
    this.entity = null
    if (tell) {
      const eyes = { x: f(player.pos.x), y: f(f(player.pos.y) + f(movement.physics.eyeHeight)), z: f(player.pos.z) }
      // (1.16.201 names the target target_runtime_entity_id)
      client.queue('interact', { action_id: 'leave_vehicle', target_entity_id: entity.runtimeId, target_runtime_entity_id: entity.runtimeId, has_position: true, position: eyes })
    }
    client.emit('dismount', entity)
  }

  // Another dimension: its entities are not these
  clear () {
    this.leave(false, true, false)
    this.entities.clear()
    this.client.emit('entities', this.entities)
  }

  // Before each tick: the sneak key pressed leaves the boat
  beforeStep () {
    const down = !!this.client.controls.sneak
    if (down && !this.sneaking && this.entity) this.leave()
    this.sneaking = down
  }

  // After each tick: the boat's entity is where the engine put it; before 1.20.71 the client tells the server so (the
  // boat's move_entity) when it moved
  follow (reportsVehicle = true) {
    const vehicle = this.vehicle
    const entity = this.entity
    if (!vehicle || !entity) return
    const moved = entity.pos.x !== vehicle.pos.x || entity.pos.y !== vehicle.pos.y || entity.pos.z !== vehicle.pos.z || entity.yaw !== vehicle.yaw
    entity.pos = { x: vehicle.pos.x, y: vehicle.pos.y, z: vehicle.pos.z }
    entity.yaw = vehicle.yaw
    if (moved && !reportsVehicle && vehicle.predicted) {
      const yaw = ((vehicle.yaw % 360) + 360) % 360
      this.client.queue('move_entity', { runtime_entity_id: entity.runtimeId, flags: MOVE_FLAGS, position: { ...entity.pos }, rotation: { yaw: 0, pitch: yaw, head_yaw: 0 } })
    }
  }

  // The input of a tick as the version reports a boat the player drives: before 1.20.71 the rider (its eyes, no
  // velocity) and no vehicle flags
  input (fields, reportsVehicle) {
    if (reportsVehicle || !this.vehicle?.predicted) return fields
    const { pos } = this.client.player
    const flags = fields.input_data.filter(name => !['client_predicted_vehicle', 'paddling_left', 'paddling_right'].includes(name))
    return { ...fields, input_data: flags, position: { x: f(pos.x), y: f(f(pos.y) + f(this.client.movement.physics.eyeHeight)), z: f(pos.z) }, delta: { x: 0, y: 0, z: 0 } }
  }
}

module.exports = { Riding, BOATS }
