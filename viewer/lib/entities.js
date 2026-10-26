const THREE = require('three')
const TWEEN = require('@tweenjs/tween.js')

const Entity = require('./entity/Entity')
const { getItemMesh, getHeldItemMesh, animateItem } = require('./entity/Item')
const { dispose3 } = require('./dispose')
const { loadJSON } = globalThis.isElectron ? require('./utils.electron.js') : require('./utils')

const { createCanvas } = require('canvas')

const isBedrock = version => String(version).startsWith('bedrock_')

// A Bedrock version's entity models (entities.json) and the armor its entities wear (attachables.json), from its
// assets, loaded the first time they are needed
const assetFiles = {}
function assetFile (version, file) {
  const key = version + '/' + file
  if (!assetFiles[key]) assetFiles[key] = new Promise(resolve => loadJSON(`textures/${version}/${file}`, resolve))
  return assetFiles[key]
}

function getEntityMesh (entity, scene, version) {
  // A dropped item is its own item's model, and the stack only arrives after the spawn.
  if (entity.itemName) return getItemMesh(entity.itemName, version, () => missingModel(entity))
  if (entity.name === 'item') return null
  if (!entity.name) return missingModel(entity)
  if (!isBedrock(version)) return entityModel(entity, scene, '1.16.4')?.mesh ?? missingModel(entity)
  // a Bedrock version draws its own entities: the mesh is filled once its models have loaded
  const group = new THREE.Object3D()
  assetFile(version, 'entities.json').then(models => {
    if (group.disposed) return
    const e = entityModel(entity, scene, version, models)
    group.add(e ? e.mesh : missingModel(entity))
    if (!e) return
    group.model = e
    group.walk = e.mesh.walk
    delete e.mesh.walk
    if (group.equipment) equip(group, version)
  })
  group.dispose = () => { group.disposed = true }
  return group
}

// the Entity of an entity, with its name above it and the limbs it walks with; null when there is no model of it
function entityModel (entity, scene, version, models) {
  try {
    const textures = {}
    if (entity.skin) textures.default = entity.skin
    if (entity.cape) textures.cape = entity.cape
    const model = entity.name === 'player' && entity.skinModel === 'slim' ? 'player_slim' : entity.name
    if (models && !models[model]) return null
    const e = new Entity(version, model, scene, textures, models)
    e.mesh.model = e

    if (entity.username !== undefined) {
      const canvas = createCanvas(500, 100)

      const ctx = canvas.getContext('2d')
      ctx.font = '50pt Arial'
      ctx.fillStyle = '#000000'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'

      const txt = entity.username
      ctx.fillText(txt, 100, 0)

      const tex = new THREE.Texture(canvas)
      tex.needsUpdate = true
      const spriteMat = new THREE.SpriteMaterial({ map: tex })
      const sprite = new THREE.Sprite(spriteMat)
      sprite.position.y += entity.height + 0.6

      e.mesh.add(sprite)
    }
    const limbs = {}
    for (const name of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']) limbs[name] = e.bone(name)
    if (Object.values(limbs).every(Boolean)) {
      e.mesh.walk = { limbs, lastPos: null, speed: 0, pos: 0, age: 0, riding: false, zombieArms: zombieArmMobs.has(entity.name) }
    }

    return e
  } catch (err) {
    console.log(err)
  }

  return null
}

// What an entity holds and wears (equipment: [main hand, off hand, boots, leggings, chestplate, helmet], as mineflayer
// keeps it: item names, or items with a name): the items in its hands, on its rightItem and leftItem bones; the armor
// a Bedrock version's attachables draw, on its bones.
function equip (mesh, version) {
  const model = mesh.model
  if (!model) return
  for (const old of mesh.equipped ?? []) {
    old.parent?.remove(old)
    old.geometry?.dispose()
    old.material?.dispose()
    old.dispose?.()
  }
  mesh.equipped = []
  const names = (mesh.equipment ?? []).map(item => typeof item === 'string' ? item : item?.name ?? null)
  const [mainHand, offHand, ...armor] = names
  for (const [item, boneName] of [[mainHand, 'rightItem'], [offHand, 'leftItem']]) {
    const bone = item && model.bone(boneName)
    if (!bone) continue
    const held = getHeldItemMesh(item, version)
    bone.add(held)
    mesh.equipped.push(held)
  }
  if (!isBedrock(version) || !armor.some(Boolean)) return
  const equipped = mesh.equipped
  assetFile(version, 'attachables.json').then(attachables => {
    if (mesh.disposed || mesh.equipped !== equipped) return
    for (const item of armor) {
      const attachable = item && attachables[item]
      if (attachable) equipped.push(model.wear(attachable))
    }
  })
}

function missingModel (entity) {
  const geometry = new THREE.BoxGeometry(entity.width, entity.height, entity.width)
  geometry.translate(0, entity.height / 2, 0)
  const material = new THREE.MeshBasicMaterial({ color: 0xff00ff })
  const cube = new THREE.Mesh(geometry, material)
  return cube
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
    this.lastAnimate = performance.now()
  }

  setVersion (version) {
    this.version = version
    this.clear()
  }

  animate () {
    const now = performance.now()
    const ticks = (now - this.lastAnimate) / 50
    this.lastAnimate = now
    if (ticks === 0) return
    for (const mesh of Object.values(this.entities)) {
      if (mesh.walk) animateWalk(mesh, ticks)
      if (mesh.item) animateItem(mesh, ticks)
    }
  }

  clear () {
    for (const mesh of Object.values(this.entities)) {
      this.scene.remove(mesh)
      dispose3(mesh)
    }
    this.entities = {}
    this.items = {}
  }

  update (entity) {
    if (entity.name === 'item') this.items[entity.id] = { name: entity.name, width: entity.width, height: entity.height }
    if (this.items[entity.id]) entity = { ...this.items[entity.id], ...entity }
    if (entity.delete) delete this.items[entity.id]

    // A dropped item's stack arrives after its spawn and can change; its mesh is that stack's model.
    const known = this.entities[entity.id]
    if (known && entity.itemName !== undefined && known.itemName !== entity.itemName) {
      this.scene.remove(known)
      dispose3(known)
      delete this.entities[entity.id]
    }
    if (!this.entities[entity.id]) {
      if (!entity.pos) return
      const mesh = getEntityMesh(entity, this.scene, this.version)
      if (!mesh) return
      mesh.itemName = entity.itemName
      this.entities[entity.id] = mesh
      this.scene.add(mesh)
      if (entity.pos) mesh.position.set(entity.pos.x, entity.pos.y, entity.pos.z)
    }

    const e = this.entities[entity.id]

    if (entity.equipment !== undefined) {
      e.equipment = entity.equipment
      equip(e, this.version)
    }

    if (entity.delete) {
      this.scene.remove(e)
      dispose3(e)
      delete this.entities[entity.id]
    }

    if (entity.pos) {
      new TWEEN.Tween(e.position).to({ x: entity.pos.x, y: entity.pos.y, z: entity.pos.z }, 50).start()
    }
    if (e.walk) {
      if (entity.riding !== undefined) e.walk.riding = entity.riding
      if (entity.hurt) e.walk.speed = 1.5
    }
    if (entity.yaw) {
      const da = (entity.yaw - e.rotation.y) % (Math.PI * 2)
      const dy = 2 * da % (Math.PI * 2) - da
      new TWEEN.Tween(e.rotation).to({ y: e.rotation.y + dy }, 50).start()
    }
  }
}

module.exports = { Entities }
