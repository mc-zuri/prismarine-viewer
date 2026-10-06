// The entities the server added (boats), drawn with the version's Bedrock models where it has them, each where the client
// has it: a boat the player drives where the engine moved it. And which of them a ray from the eyes hits first (a click
// gets on a boat or breaks it).
const { rayBox } = require('../client/interaction')

const RADIANS = Math.PI / 180
// a boat's box: its width and height, and how far its position is above the box's floor
const BOAT = { width: 1.4, height: 0.455, offset: 0.375 }

// The box of an entity: [x0, y0, z0, x1, y1, z1]
function boxOf (entity) {
  const w = BOAT.width / 2
  const y = entity.pos.y - BOAT.offset
  return [entity.pos.x - w, y, entity.pos.z - w, entity.pos.x + w, y + BOAT.height, entity.pos.z + w]
}

// The entity a ray from `eye` along `dir` (a unit vector) hits first within `reach`: { entity, t }, or null
function entityHit (entities, eye, dir, reach) {
  let best = null
  for (const entity of entities.values()) {
    const hit = rayBox(eye, dir, boxOf(entity), reach)
    if (hit && (!best || hit.t < best.t)) best = { entity, t: hit.t }
  }
  return best
}

class EntityModels {
  constructor (viewer) {
    this.viewer = viewer
    this.assets = null
    // runtime id -> the model
    this.models = new Map()
    this.last = undefined
  }

  // The version's Bedrock entities: the models are made again with them
  use (assets) {
    if (assets === this.assets) return
    this.assets = assets
    this.dispose()
  }

  // entities: the client's (runtime id -> { type, pos, yaw })
  place (entities, now) {
    const seconds = this.last === undefined ? 0 : (now - this.last) / 1000
    this.last = now
    for (const [id, model] of this.models) {
      if (entities.has(id)) continue
      this.viewer.scene.remove(model.object)
      model.dispose()
      this.models.delete(id)
    }
    for (const entity of entities.values()) {
      let model = this.models.get(entity.runtimeId)
      if (!model) {
        if (!this.assets?.has(entity.type)) continue
        model = this.assets.create(entity.type)
        this.viewer.scene.add(model.object)
        this.models.set(entity.runtimeId, model)
      }
      const feet = { x: entity.pos.x, y: entity.pos.y - BOAT.offset, z: entity.pos.z }
      model.object.position.set(feet.x, feet.y, feet.z)
      // (a boat heads along +x at yaw 0; the model faces -z unturned)
      model.object.rotation.y = -(entity.yaw + 90) * RADIANS
      model.setMotion?.({ position: feet, yaw: entity.yaw, headYaw: entity.yaw, pitch: 0, onGround: false, inWater: true, inLava: false })
      model.setCamera?.(this.viewer.camera.position)
      model.update?.(seconds)
    }
  }

  dispose () {
    for (const model of this.models.values()) {
      this.viewer.scene.remove(model.object)
      model.dispose()
    }
    this.models.clear()
  }
}

module.exports = { EntityModels, entityHit, boxOf }
