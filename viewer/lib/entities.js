const THREE = require('three')
const TWEEN = require('@tweenjs/tween.js')

const Entity = require('./entity/Entity')
const { getItemMesh, animateItem } = require('./entity/Item')
const { dispose3 } = require('./dispose')
const { supportedVersions } = require('./version')
const { loadEntityAssets } = require('./bedrock/entity/assets')
const { decodeSkin } = require('./bedrock/entity/skinData')
const { ParticleSystem } = require('./bedrock/particles/system')
const { createNameTag } = require('./nameTag')

// the longest an effect the server spawns runs, of those that would run on for ever (seconds)
const SERVER_EFFECT_SECONDS = 10

// the name an update tells of an entity: the name tag it was given (Bedrock's entity data), else a player's name;
// undefined when it tells none
const nameOf = entity => entity.metadata?.nametag !== undefined ? entity.metadata.nametag : entity.username

// the name over an entity, made when it first has one, and disposed with it
function nameTagOf (mesh, bedrock) {
  if (!mesh.nameTag) {
    mesh.nameTag = createNameTag({ bedrock })
    mesh.add(mesh.nameTag)
    const dispose = mesh.dispose
    mesh.dispose = () => {
      dispose?.call(mesh)
      mesh.nameTag.dispose()
    }
  }
  return mesh.nameTag
}

function getEntityMesh (entity, scene, version) {
  // A dropped item is its own item's model, and the stack only arrives after the spawn.
  if (entity.itemName) return getItemMesh(entity.itemName, version, () => missingModel(entity))
  if (entity.name === 'item') return null
  if (entity.name) {
    try {
      const textures = {}
      if (entity.skin) textures.default = entity.skin
      if (entity.cape) textures.cape = entity.cape
      const model = entity.name === 'player' && entity.skinModel === 'slim' ? 'player_slim' : entity.name
      const e = new Entity('1.16.4', model, scene, textures)

      const limbs = {}
      for (const name of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']) limbs[name] = e.mesh.getObjectByName(name)
      if (Object.values(limbs).every(Boolean)) {
        e.mesh.walk = { limbs, lastPos: null, speed: 0, pos: 0, age: 0, riding: false, zombieArms: zombieArmMobs.has(entity.name) }
      }

      return e.mesh
    } catch (err) {
      console.log(err)
    }
  }

  return missingModel(entity)
}

function missingModel (entity) {
  const geometry = new THREE.BoxGeometry(entity.width, entity.height, entity.width)
  geometry.translate(0, entity.height / 2, 0)
  const material = new THREE.MeshBasicMaterial({ color: 0xff00ff })
  const cube = new THREE.Mesh(geometry, material)
  return cube
}

// An entity of a Bedrock world: its version's client entity, a player as Steve (Alex for slim arms) until players'
// skins are told, a dropped item its icon by its stack's aux value; else Java's model of its name, else the
// placeholder. mineflayer names a Bedrock entity by its identifier without minecraft:. assets: the version's
// (bedrock/entity/assets.js), null when it has none built, and Java's newest version's item icons stand in. particles:
// the ParticleSystem its particle effects show in.
function getBedrockEntityMesh (entity, scene, version, assets, particles) {
  if (!assets) return getEntityMesh(entity, scene, supportedVersions[supportedVersions.length - 1])
  if (entity.itemName) return getItemMesh(entity.itemName, version, () => missingModel(entity), { textures: assets, aux: entity.itemAux })
  if (entity.name === 'item') return null
  let model = null
  try {
    // (its own skin, once it has been decoded: see bedrockSkin())
    if (entity.name === 'player') model = assets.player({ armSize: entity.bedrockSkin?.armSize ?? (entity.skinModel === 'slim' ? 'slim' : 'wide') })
    else if (assets.has('minecraft:' + entity.name)) model = assets.create('minecraft:' + entity.name)
  } catch (err) {
    console.log(err)
  }
  if (!model) return getEntityMesh(entity, scene, version)

  // it turns to the entity's yaw as Java models do; the model turns its body within that as the game does
  const mesh = new THREE.Group()
  mesh.add(model.object)
  mesh.bedrock = model
  mesh.dispose = () => mesh.bedrock?.dispose()
  model.setMotion({ position: mesh.position })
  model.particles = particles ?? null
  return mesh
}

// Bedrock players' skins, decoded, by key: a WorldView sends a skin whole once, then its key
const skins = new Map()

// A Bedrock player's own skin: its model is drawn with it once it is decoded (until then, and when it cannot be drawn,
// it is Steve or Alex)
function bedrockSkin (mesh, skin, assets) {
  if (!skin?.key || mesh.skinKey === skin.key) return
  mesh.skinKey = skin.key
  if (!skins.has(skin.key)) {
    if (!skin.data) return
    skins.set(skin.key, decodeSkin(skin).catch(() => null))
  }
  skins.get(skin.key).then(decoded => {
    if (!decoded || mesh.skinKey !== skin.key || !mesh.bedrock) return
    const model = assets.player(decoded)
    if (!model.ownSkin) return model.dispose()
    replaceModel(mesh, model)
  })
}

// another model in place of a mesh's, told what it was
function replaceModel (mesh, model) {
  const old = mesh.bedrock
  mesh.remove(old.object)
  old.dispose()
  mesh.add(model.object)
  mesh.bedrock = model
  model.particles = old.particles
  model.setState(old.state)
  model.setMotion({ ...old.motion, position: mesh.position })
}

const DEG = 180 / Math.PI
// mineflayer's yaw and pitch (radians; yaw 0 faces -z and turns anticlockwise seen from above, pitch up) as the
// game's, which Bedrock models read (degrees; yaw 0 faces +z and turns clockwise, pitch down)
const gameYaw = yaw => (Math.PI - yaw) * DEG
const gamePitch = pitch => -pitch * DEG

// what is told of a Bedrock entity, for its model
function updateBedrockModel (model, entity) {
  const state = {}
  if (entity.metadata) state.metadata = entity.metadata
  // its entity properties by name ({ 'minecraft:climate_variant': 'warm' }), which mineflayer does not keep yet
  if (entity.properties) state.properties = entity.properties
  if (entity.equipment) state.equipment = entity.equipment
  if (entity.health !== undefined) state.health = entity.health
  if (entity.maxHealth !== undefined) state.maxHealth = entity.maxHealth
  if (entity.vehicle !== undefined) state.vehicle = entity.vehicle
  const name = entity.metadata?.nametag || entity.username
  if (name) state.name = name
  if (Object.keys(state).length) model.setState(state)

  const motion = {}
  if (entity.yaw !== undefined) motion.yaw = gameYaw(entity.yaw)
  if (entity.headYaw !== undefined) motion.headYaw = gameYaw(entity.headYaw)
  if (entity.pitch !== undefined) motion.pitch = gamePitch(entity.pitch)
  if (entity.onGround !== undefined) motion.onGround = entity.onGround
  // in water or lava (a fish swims in water, and flops out of it)
  if (entity.inWater !== undefined) motion.inWater = entity.inWater
  if (entity.inLava !== undefined) motion.inLava = entity.inLava
  if (Object.keys(motion).length) model.setMotion(motion)

  // its events by the protocol's names (hurt_animation, death_animation, arm_swing...), an animation the server plays
  if (entity.hurt) model.event('hurt_animation')
  if (entity.event) model.event(entity.event, entity.data)
  if (entity.animation) model.playAnimation(entity.animation)
}

const zombieArmMobs = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin'])

// Vanilla rotations are in a y-down model space; this model is y-up, so x and z angles are negated
function animateWalk (mesh, ticks) {
  const w = mesh.walk
  const lastPos = w.lastPos
  w.lastPos = mesh.position.clone()
  w.age += ticks
  if (!lastPos) return

  if (w.riding) {
    w.speed = 0
    w.pos = 0
  } else {
    const moved = Math.hypot(mesh.position.x - lastPos.x, mesh.position.z - lastPos.z)
    const target = Math.min(1, moved / ticks * 4)
    w.speed += (target - w.speed) * (1 - Math.pow(0.6, ticks))
    w.pos += w.speed * ticks
  }

  const { leftArm, rightArm, leftLeg, rightLeg } = w.limbs
  const { speed, pos } = w
  const t = pos * 0.6662
  leftArm.rotation.set(-Math.cos(t) * speed, 0, 0)
  rightArm.rotation.set(-Math.cos(t + Math.PI) * speed, 0, 0)
  leftLeg.rotation.set(-Math.cos(t + Math.PI) * 1.4 * speed, -0.005, 0.005)
  rightLeg.rotation.set(-Math.cos(t) * 1.4 * speed, 0.005, -0.005)
  if (w.riding) {
    leftArm.rotation.x += Math.PI / 5
    rightArm.rotation.x += Math.PI / 5
    leftLeg.rotation.set(1.4137167, -Math.PI / 10, 0.07853982)
    rightLeg.rotation.set(1.4137167, Math.PI / 10, -0.07853982)
  }

  if (w.zombieArms) {
    const age = w.age
    leftArm.rotation.set(Math.PI / 2.25 + Math.sin(age * 0.067) * 0.05, 0.1, Math.cos(age * 0.09) * 0.05 + 0.05)
    rightArm.rotation.set(Math.PI / 2.25 - Math.sin(age * 0.067) * 0.05, -0.1, -(Math.cos(age * 0.09) * 0.05 + 0.05))
  }
}

class Entities {
  constructor (scene) {
    this.scene = scene
    this.entities = {}
    // What the spawn said about each dropped item, since later partial updates carry only the id
    this.items = {}
    // Bedrock: the version's entity assets ({ assets }), and what is told of entities while they load
    this.bedrock = null
    this.pending = {}
    this.lastAnimate = performance.now()
  }

  // version: a Java one, or a Bedrock one ('bedrock_1.26.51'), whose entities are drawn with its own client entities
  // and item icons once they have loaded, and its particles with its particle effects
  setVersion (version) {
    this.version = version
    this.clear()
    this.bedrock?.particles?.dispose()
    this.bedrock = null
    if (typeof version === 'string' && version.startsWith('bedrock_')) {
      // assets: undefined while they load, null when the version has none built
      const bedrock = { assets: undefined, particles: null }
      this.bedrock = bedrock
      loadEntityAssets(version).then(assets => {
        if (this.bedrock !== bedrock) return
        bedrock.assets = assets
        if (assets) bedrock.particles = new ParticleSystem(this.scene, assets)
        // what was told meanwhile
        const pending = Object.values(this.pending)
        this.pending = {}
        for (const entity of pending) this.update(entity)
      })
    }
  }

  // camera: the viewer's, which some Bedrock models turn to (an experience orb, a fireball), and particles face
  animate (camera) {
    const now = performance.now()
    const ticks = (now - this.lastAnimate) / 50
    this.lastAnimate = now
    if (ticks === 0) return
    this.animateEntities(ticks, camera)
    // (after the entities: the effects on them follow them where they are now)
    this.bedrock?.particles?.update(ticks / 20, camera)
  }

  animateEntities (ticks, camera) {
    for (const mesh of Object.values(this.entities)) {
      if (mesh.walk) animateWalk(mesh, ticks)
      if (mesh.item) animateItem(mesh, ticks)
      if (mesh.nameTag) mesh.nameTag.setHeight(mesh.bedrock ? mesh.bedrock.aabb().height : mesh.height ?? 1.8)
      if (mesh.bedrock) {
        try {
          if (camera) mesh.bedrock.setCamera(camera.position)
          mesh.bedrock.update(ticks / 20)
        } catch (err) {
          // a model its version's scripts break stays as it was
          console.log(err)
          mesh.bedrock = null
        }
      }
    }
  }

  clear () {
    for (const mesh of Object.values(this.entities)) {
      this.scene.remove(mesh)
      dispose3(mesh)
    }
    this.entities = {}
    this.items = {}
    this.pending = {}
    this.bedrock?.particles?.clear()
  }

  /**
   * A particle effect of a Bedrock version's packs, by its identifier ('minecraft:heart_particle'; minecraft: may be
   * left out), at a position: one the server spawns (spawn_particle_effect). options: what ParticleSystem.spawn takes
   * (variables, direction). An effect the game emits particles of itself (of manual rate) shows one; one that would
   * run on for ever stops after 10 seconds. Nothing shows of an effect the version has none of, or while its assets
   * load. -> whether it shows.
   */
  spawnParticle (name, position, options = {}) {
    const particles = this.bedrock?.particles
    if (!particles || !name || !position) return false
    const identifier = String(name).includes(':') ? String(name) : 'minecraft:' + name
    const def = particles.definition(identifier)
    if (!def) return false
    if (def.rate.kind === 'manual') return particles.emit(identifier, position, { variables: options.variables })
    return !!particles.spawn(identifier, { duration: def.lifetime.kind === 'once' ? undefined : SERVER_EFFECT_SECONDS, ...options, position })
  }

  update (entity) {
    if (entity.name === 'item') this.items[entity.id] = { name: entity.name, width: entity.width, height: entity.height }
    if (this.items[entity.id]) entity = { ...this.items[entity.id], ...entity }
    if (entity.delete) delete this.items[entity.id]

    // Bedrock: while the version's assets load, what is told of each entity waits for them
    if (this.bedrock && this.bedrock.assets === undefined) {
      if (entity.delete) delete this.pending[entity.id]
      else this.pending[entity.id] = { ...this.pending[entity.id], ...entity }
      return
    }

    // A dropped item's stack arrives after its spawn and can change; its mesh is that stack's model.
    const known = this.entities[entity.id]
    if (known && entity.itemName !== undefined && (known.itemName !== entity.itemName || known.itemAux !== entity.itemAux)) {
      this.scene.remove(known)
      dispose3(known)
      delete this.entities[entity.id]
    }
    if (!this.entities[entity.id]) {
      if (!entity.pos) return
      const mesh = this.bedrock ? getBedrockEntityMesh(entity, this.scene, this.version, this.bedrock.assets, this.bedrock.particles) : getEntityMesh(entity, this.scene, this.version)
      if (!mesh) return
      mesh.itemName = entity.itemName
      mesh.itemAux = entity.itemAux
      this.entities[entity.id] = mesh
      this.scene.add(mesh)
      if (entity.pos) mesh.position.set(entity.pos.x, entity.pos.y, entity.pos.z)
      if (mesh.bedrock && entity.yaw !== undefined) mesh.rotation.y = entity.yaw
    }

    const e = this.entities[entity.id]

    if (entity.delete) {
      this.scene.remove(e)
      dispose3(e)
      delete this.entities[entity.id]
      return
    }

    // its name over it, as high as it is (a Bedrock model's box: its entity data's, else its own measure)
    const name = nameOf(entity)
    if (name !== undefined && (name || e.nameTag)) nameTagOf(e, !!this.bedrock).setName(name)
    if (entity.height !== undefined) e.height = entity.height
    if (e.nameTag && entity.metadata?.flags?.sneaking !== undefined) e.nameTag.setSneaking(entity.metadata.flags.sneaking)

    if (entity.pos) {
      new TWEEN.Tween(e.position).to({ x: entity.pos.x, y: entity.pos.y, z: entity.pos.z }, 50).start()
    }
    if (e.walk) {
      if (entity.riding !== undefined) e.walk.riding = entity.riding
      if (entity.hurt) e.walk.speed = 1.5
    }
    if (e.bedrock) {
      updateBedrockModel(e.bedrock, entity)
      if (entity.bedrockSkin) bedrockSkin(e, entity.bedrockSkin, this.bedrock.assets)
    }
    if (e.bedrock ? entity.yaw !== undefined : entity.yaw) {
      const da = (entity.yaw - e.rotation.y) % (Math.PI * 2)
      const dy = 2 * da % (Math.PI * 2) - da
      new TWEEN.Tween(e.rotation).to({ y: e.rotation.y + dy }, 50).start()
    }
  }
}

module.exports = { Entities }
