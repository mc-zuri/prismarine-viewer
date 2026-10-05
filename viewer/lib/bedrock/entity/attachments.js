// What an entity wears and holds, drawn as the client draws it:
//  - an item with an attachable (armour, a shield, a trident, an elytra, a spear...) by the attachable: its geometry,
//    render controllers, scripts and animations, as a model of its own whose bones go on the wearer's: a bone binds to
//    the bone its `binding` names (q.item_slot_to_bone_name(c.item_slot): the hand that holds it), else to the
//    wearer's bone of its name (armour: head, body, arms, legs). Its parent_setup script runs on the wearer (a helmet
//    hides the hat layer). Of the attachables of an item, the one whose `item` condition holds for the wearer
//    (minecraft:diamond_helmet.player for a player), else the item's own.
//  - another held item as its icon in the hand, an extruded sprite as a dropped item's is
//
//   const attachments = new Attachments(wearer)   // a BedrockEntity; its assets have attachables and items
//   attachments.set({ mainhand, offhand, head, chest, legs, feet, body })   // item names
//   attachments.parentSetup()   // the scripts the wearer runs after its pre_animation
//   attachments.update(dt)      // after the wearer posed its bones
const THREE = require('three')
const { compile, truthy } = require('./molang')
const { spriteGeometry } = require('../../entity/Item')
const { loadTexture, loadPixels } = globalThis.isElectron ? require('../../utils.electron.js') : require('../../utils')

// equipment slot -> the slot as Molang names it (c.item_slot)
const SLOTS = { mainhand: 'main_hand', offhand: 'off_hand', head: 'head', chest: 'chest', legs: 'legs', feet: 'feet', body: 'body' }
// q.item_slot_to_bone_name
const SLOT_BONES = { main_hand: 'rightitem', off_hand: 'leftitem', head: 'head', chest: 'body', legs: 'body', feet: 'body', body: 'body' }
// the queries an attachable answers itself; the rest are its wearer's
const OWN_QUERIES = new Set(['life_time', 'anim_time', 'delta_time', 'key_frame_lerp_time', 'all_animations_finished', 'any_animation_finished', 'get_default_bone_pivot'])
// a held icon, as Java's item models show it in a third person's right hand (thirdperson_righthand: rotation in degrees,
// translation in pixels, scale): tools as tools (item/handheld), a bow, a crossbow, a block, the rest as items
const DISPLAY = {
  generated: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: 0.55 },
  handheld: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: 0.85 },
  handheld_rod: { rotation: [0, 90, 55], translation: [0, 4, 2.5], scale: 0.85 },
  bow: { rotation: [-80, 260, -40], translation: [-1, -2, 2.5], scale: 0.9 },
  crossbow: { rotation: [-90, 0, -60], translation: [2, 0.1, -3], scale: 0.9 },
  block: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: 0.375 }
}
const HANDHELD = /(_sword|_axe|_pickaxe|_shovel|_hoe|^stick|^bone|^blaze_rod|^breeze_rod|^mace|_spear)$/
const HANDHELD_ROD = /(fishing_rod|_on_a_stick)$/

const strip = name => String(name ?? '').replace(/^minecraft:/, '')

// the attachable of an item on a wearer: one whose `item` condition holds for it, else the item's own
function attachableFor (assets, item, wearer) {
  const attachables = assets.attachables
  if (!attachables) return null
  const id = 'minecraft:' + strip(item)
  for (const [identifier, desc] of Object.entries(attachables)) {
    const condition = desc.item?.[id]
    if (condition === undefined) continue
    const ctx = { variables: {}, context: {}, temp: {}, query: (name, args) => name === 'owner_identifier' ? wearer.identifier : wearer.query(name, args) }
    if (condition === '' || truthy(compile(condition)(ctx))) return identifier
  }
  return attachables[id] && !attachables[id].item ? id : null
}

class Attachments {
  constructor (wearer) {
    this.wearer = wearer
    // slot -> { item, model?, icon?, bound: Map(layer -> [groups moved onto the wearer]) }
    this.slots = new Map()
  }

  set (equipment = {}) {
    for (const slot of Object.keys(SLOTS)) {
      const item = strip(equipment[slot])
      const current = this.slots.get(slot)
      if (current?.item === item) continue
      if (current) this.remove(slot)
      if (item) this.add(slot, item)
    }
  }

  add (slot, item) {
    const wearer = this.wearer
    const assets = wearer.assets
    const entry = { item, bound: new Map() }
    this.slots.set(slot, entry)
    const id = attachableFor(assets, item, wearer)
    if (id) {
      entry.model = attachableModel(assets, id, wearer, SLOTS[slot])
      if (entry.model) wearer.model.add(entry.model.object)
      return
    }
    if (slot === 'mainhand' || slot === 'offhand') entry.icon = heldIcon(assets, item)
  }

  remove (slot) {
    const entry = this.slots.get(slot)
    this.slots.delete(slot)
    if (!entry) return
    for (const groups of entry.bound.values()) for (const group of groups) group.parent?.remove(group)
    if (entry.model) {
      entry.model.object.parent?.remove(entry.model.object)
      entry.model.dispose()
    }
    if (entry.icon) {
      entry.icon.parent?.remove(entry.icon)
      entry.icon.userData.dispose()
    }
  }

  // the scripts the wearer runs after its own pre_animation
  parentSetup () {
    const scripts = []
    for (const entry of this.slots.values()) {
      const setup = entry.model?.desc.scripts?.parent_setup
      if (setup) scripts.push(setup)
    }
    return scripts
  }

  update (dt) {
    for (const [slot, entry] of this.slots) {
      if (entry.model) {
        try {
          entry.model.update(dt)
        } catch {
          // an attachable whose scripts break is not drawn
          this.remove(slot)
          this.slots.set(slot, { item: entry.item, bound: new Map() })
          continue
        }
        // it is drawn in the wearer's model space, which scales and turns it already
        entry.model.model.scale.set(1, 1, 1)
        entry.model.model.rotation.set(0, 0, 0)
        this.bind(entry)
      } else if (entry.icon && !entry.icon.parent) {
        const hand = this.wearer.findBone(SLOT_BONES[SLOTS[slot]])
        if (!hand) continue
        hand.group.add(entry.icon)
        placeHeld(entry.icon, hand, this.wearer.findBone(hand.parent ?? ''), slot === 'offhand')
      }
    }
  }

  // an attachable's bones onto the wearer's, once per layer it builds
  bind (entry) {
    const model = entry.model
    for (const layer of model.layers.values()) {
      if (!layer.skeleton || entry.bound.has(layer)) continue
      const moved = []
      const byName = new Map((layer.geometry?.bones ?? []).map(b => [b.name.toLowerCase(), b]))
      for (const [key, bone] of layer.skeleton.bones) {
        const def = byName.get(key)
        let target = null
        if (def?.binding) {
          model.ctx.resource = null
          target = compile(def.binding)(model.ctx)
        } else if (this.wearer.findBone(key)) {
          target = key
        } else if (!bone.parent && SLOT_BONES[model.ctx.context.item_slot] && (model.ctx.context.item_slot === 'main_hand' || model.ctx.context.item_slot === 'off_hand')) {
          // a held attachable's root bone that names no bone of the wearer: in the hand
          target = SLOT_BONES[model.ctx.context.item_slot]
        }
        const onto = typeof target === 'string' && target ? this.wearer.findBone(target) : null
        if (!onto) continue
        onto.group.add(bone.group)
        // a bone bound by name has the pivot of the wearer's (armour); one bound by its binding goes where the bone it
        // binds to is, its animations placing it from there (a shield's)
        bone.restPosition = def?.binding ? new THREE.Vector3() : bone.pivot.clone().sub(onto.pivot)
        bone.group.position.copy(bone.restPosition)
        moved.push(bone.group)
      }
      entry.bound.set(layer, moved)
    }
    // the layers it no longer draws
    for (const [layer, groups] of entry.bound) {
      if ([...model.layers.values()].includes(layer)) continue
      for (const group of groups) group.parent?.remove(group)
      entry.bound.delete(layer)
    }
  }

  dispose () {
    for (const slot of [...this.slots.keys()]) this.remove(slot)
  }
}

// an attachable as a model of its own: its context is its slot, seen in third person; its queries but its own time
// and animations are its wearer's
function attachableModel (assets, identifier, wearer, slot) {
  const { BedrockEntity } = require('./model')
  const view = Object.create(assets, { entities: { value: { [identifier]: assets.attachables[identifier] } } })
  let model
  try {
    model = new BedrockEntity(view, identifier)
  } catch {
    return null
  }
  model.ctx.context = { item_slot: slot, is_first_person: 0, owning_entity: wearer }
  const own = model.query.bind(model)
  model.query = (name, args) => {
    if (name === 'owner_identifier') return wearer.identifier
    if (name === 'item_slot_to_bone_name') return SLOT_BONES[args[0]] ?? ''
    if (name === 'is_first_person') return 0
    return OWN_QUERIES.has(name) ? own(name, args) : wearer.query(name, args)
  }
  return model
}

// An item's icon held in a hand, as Java's ItemInHandLayer draws it: from the arm's pivot turned and moved to the hand,
// then the item model's display in a third person's hand (mirrored for the left). This space is Java's model space
// turned half round z (y up, the model facing -z), the hand bone's pivot the arm's moved (1, -7, 1).
function heldIcon (assets, item) {
  const group = new THREE.Group()
  let disposed = false
  const owned = []
  group.userData.dispose = () => {
    disposed = true
    for (const mesh of owned) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
  const entry = assets.items?.[item]
  const texture = entry?.texture
  const url = texture && /^(items|blocks)\//.test(texture) ? assets.textureUrl(texture) : null
  if (!url) return group
  const block = texture.startsWith('blocks/')
  group.userData.display = DISPLAY[block ? 'block' : item === 'bow' ? 'bow' : item === 'crossbow' ? 'crossbow' : HANDHELD_ROD.test(item) ? 'handheld_rod' : HANDHELD.test(item) ? 'handheld' : 'generated']
  loadPixels(url, pixels => loadTexture(url, map => {
    if (disposed) return
    map.magFilter = THREE.NearestFilter
    map.minFilter = THREE.NearestFilter
    const material = new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
    // as an item model is, centred: a block a 16 pixel cube, an item its sprite a pixel deep
    const geometry = block ? new THREE.BoxGeometry(16, 16, 16) : spriteGeometry(pixels, 16, 1)
    const mesh = new THREE.Mesh(geometry, material)
    owned.push(mesh)
    group.add(mesh)
  }))
  return group
}

// Two crossed quads of a block texture, size pixels square, standing on the origin: a flower as its block model draws it
function crossSprite (assets, texture, size = 8) {
  const group = new THREE.Group()
  let disposed = false
  const owned = []
  group.userData.dispose = () => {
    disposed = true
    for (const mesh of owned) mesh.geometry.dispose()
    owned[0]?.material.dispose()
  }
  const url = assets.textureUrl?.(texture)
  if (!url) return group
  loadTexture(url, map => {
    if (disposed) return
    map.magFilter = THREE.NearestFilter
    map.minFilter = THREE.NearestFilter
    const material = new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const geometry = new THREE.PlaneGeometry(size, size).translate(0, size / 2, 0)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.rotation.y = angle
      owned.push(mesh)
      group.add(mesh)
    }
  })
  return group
}

const D = Math.PI / 180
const m4 = () => new THREE.Matrix4()

function placeHeld (group, hand, arm, left) {
  const display = group.userData.display ?? DISPLAY.generated
  const sign = left ? -1 : 1
  const offset = arm ? hand.pivot.clone().sub(arm.pivot) : new THREE.Vector3(sign, -7, 1)
  const [rx, ry, rz] = display.rotation
  const [tx, ty, tz] = display.translation
  const matrix = m4().makeTranslation(-offset.x, -offset.y, -offset.z)
    .multiply(m4().makeRotationZ(Math.PI))
    .multiply(m4().makeRotationX(-90 * D))
    .multiply(m4().makeRotationY(Math.PI))
    .multiply(m4().makeTranslation(sign, 2, -10))
    .multiply(m4().makeTranslation(sign * tx, ty, tz))
    .multiply(m4().makeRotationFromEuler(new THREE.Euler(rx * D, sign * ry * D, sign * rz * D, 'XYZ')))
    .multiply(m4().makeScale(display.scale, display.scale, display.scale))
  matrix.decompose(group.position, group.quaternion, group.scale)
}

module.exports = { Attachments, attachableFor, crossSprite, SLOTS, SLOT_BONES }
