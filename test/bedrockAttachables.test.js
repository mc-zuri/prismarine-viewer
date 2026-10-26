/**
 * @jest-environment node
 */
/* eslint-env jest */
// What a Bedrock entity wears and holds (viewer/lib/bedrock/entity/attachments.js), on a fixture shaped as the vanilla
// pack's: armour whose bones go on the wearer's bones of their names, its .player variant for players, a shield whose
// bone binds to the hand that holds it, and an item without an attachable as its icon in the hand.
const THREE = require('three')

const mockPixels = []
jest.mock('../viewer/lib/utils', () => ({
  loadPixels: (path, onLoad) => {
    mockPixels.push(path)
    onLoad({ width: 2, height: 2, data: new Uint8Array(16).fill(255) })
  },
  loadTexture: (path, onLoad) => onLoad(new (require('three').Texture)()),
  loadJSON: () => {},
  loadImage: () => {}
}))

const { BedrockEntity } = require('../viewer/lib/bedrock/entity/model')
const { attachableFor } = require('../viewer/lib/bedrock/entity/attachments')

const cube = (origin, size, inflate) => ({ origin, size, uv: [0, 0], ...(inflate ? { inflate } : {}) })
// a humanoid as the packs' are: the hand's bone under the arm
const humanoid = {
  texture_width: 64,
  texture_height: 64,
  bones: [
    { name: 'body', pivot: [0, 24, 0], cubes: [cube([-4, 12, -2], [8, 12, 4])] },
    { name: 'head', parent: 'body', pivot: [0, 24, 0], cubes: [cube([-4, 24, -4], [8, 8, 8])] },
    { name: 'rightArm', parent: 'body', pivot: [-5, 22, 0], cubes: [cube([-8, 12, -2], [4, 12, 4])] },
    { name: 'rightItem', parent: 'rightArm', pivot: [-6, 15, 1] }
  ]
}
const helmet = (inflate) => ({
  texture_width: 64,
  texture_height: 32,
  bones: [{ name: 'body', pivot: [0, 24, 0] }, { name: 'head', parent: 'body', pivot: [0, 24, 0], cubes: [cube([-4, 24, -4], [8, 8, 8], inflate)] }]
})

const assets = {
  entities: {
    'minecraft:zombie': { identifier: 'minecraft:zombie', textures: { default: 'textures/entity/zombie' }, geometry: { default: 'geometry.humanoid' } },
    'minecraft:player': { identifier: 'minecraft:player', textures: { default: 'textures/entity/steve' }, geometry: { default: 'geometry.humanoid' } }
  },
  attachables: {
    'minecraft:iron_helmet': {
      identifier: 'minecraft:iron_helmet',
      materials: { default: 'armor' },
      textures: { default: 'textures/models/armor/iron_1' },
      geometry: { default: 'geometry.humanoid.armor.helmet' },
      scripts: { parent_setup: 'variable.helmet_layer_visible = 0.0;' },
      render_controllers: ['controller.render.armor']
    },
    'minecraft:iron_helmet.player': {
      identifier: 'minecraft:iron_helmet.player',
      item: { 'minecraft:iron_helmet': "query.owner_identifier == 'minecraft:player'" },
      materials: { default: 'armor' },
      textures: { default: 'textures/models/armor/iron_1' },
      geometry: { default: 'geometry.player.armor.helmet' },
      scripts: { parent_setup: 'variable.helmet_layer_visible = 0.0;' },
      render_controllers: ['controller.render.armor']
    },
    'minecraft:shield': {
      identifier: 'minecraft:shield',
      materials: { default: 'entity_alphatest' },
      textures: { default: 'textures/entity/shield' },
      geometry: { default: 'geometry.shield' },
      animations: { wield: 'animation.shield.wield_third_person' },
      scripts: { animate: ['wield'] },
      render_controllers: ['controller.render.item_default']
    }
  },
  geometry: {
    'geometry.humanoid': humanoid,
    'geometry.humanoid.armor.helmet': helmet(1),
    'geometry.player.armor.helmet': helmet(1.5),
    'geometry.shield': { texture_width: 64, texture_height: 64, bones: [{ name: 'shield', binding: 'q.item_slot_to_bone_name(c.item_slot)', pivot: [1, 15.5, 3], cubes: [cube([-5, 17, -1], [12, 22, 1])] }] }
  },
  render_controllers: {
    'controller.render.armor': { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] },
    'controller.render.item_default': { geometry: 'geometry.default', materials: [{ '*': 'material.default' }], textures: ['texture.default'] }
  },
  animations: {
    'animation.shield.wield_third_person': { loop: true, bones: { shield: { position: ["c.item_slot == 'main_hand' ? -0.4 : -1.6", 9.0, 9.3], rotation: [-90, 0, 90] } } }
  },
  animation_controllers: {},
  materials: {},
  items: { diamond_sword: { texture: 'items/diamond_sword' }, iron_helmet: { texture: 'items/iron_helmet' } },
  textureUrl: path => 'textures/bedrock/' + path.replace(/\W/g, '_') + '.png',
  texture: () => null
}

const frames = (model, n = 2) => { for (let i = 0; i < n; i++) model.update(0.05) }
const worldPosition = object => object.getWorldPosition(new THREE.Vector3())

describe('attachables', () => {
  test('armour goes on the wearer\'s bones of its names, follows them, and sets the wearer up', () => {
    const zombie = new BedrockEntity(assets, 'minecraft:zombie')
    zombie.setState({ equipment: { head: 'iron_helmet' } })
    frames(zombie)
    const entry = zombie.attachments.slots.get('head')
    expect(entry.model.identifier).toBe('minecraft:iron_helmet')
    const head = zombie.findBone('head')
    const armourHead = [...entry.model.layers.values()][0].skeleton.bones.get('head')
    expect(armourHead.group.parent).toBe(head.group)
    expect(armourHead.group.position.length()).toBeCloseTo(0)
    expect(zombie.variables.helmet_layer_visible).toBe(0)

    // the wearer's head turns: the helmet with it
    head.group.rotation.set(0.5, 0, 0)
    zombie.object.updateMatrixWorld(true)
    expect(worldPosition(armourHead.group).distanceTo(worldPosition(head.group))).toBeCloseTo(0)
    expect(armourHead.group.getWorldQuaternion(new THREE.Quaternion()).angleTo(head.group.getWorldQuaternion(new THREE.Quaternion()))).toBeCloseTo(0)

    // taken off: nothing of it left on the wearer
    zombie.setState({ equipment: {} })
    expect(armourHead.group.parent).toBe(null)
    expect(zombie.attachments.slots.size).toBe(0)
  })

  test('a player wears the .player variant; another wearer the item\'s own', () => {
    const player = new BedrockEntity(assets, 'minecraft:player')
    const zombie = new BedrockEntity(assets, 'minecraft:zombie')
    expect(attachableFor(assets, 'minecraft:iron_helmet', player)).toBe('minecraft:iron_helmet.player')
    expect(attachableFor(assets, 'iron_helmet', zombie)).toBe('minecraft:iron_helmet')
    expect(attachableFor(assets, 'stone', zombie)).toBe(null)
  })

  test('a shield binds to the hand that holds it, posed there by its own animation', () => {
    const zombie = new BedrockEntity(assets, 'minecraft:zombie')
    zombie.setState({ equipment: { mainhand: 'shield' } })
    frames(zombie)
    const entry = zombie.attachments.slots.get('mainhand')
    const shield = [...entry.model.layers.values()][0].skeleton.bones.get('shield')
    const hand = zombie.findBone('rightitem')
    expect(shield.group.parent).toBe(hand.group)
    // from the hand as its geometry places it (pivot [1, 15.5, 3], x mirrored), 24 lower, as the game places a bound
    // bone; the animation's offset on that (x mirrored), which brings its handle into the hand
    expect(shield.restPosition.toArray()).toEqual([-1, -8.5, 3])
    expect(shield.group.position.toArray().map(v => Math.round(v * 10) / 10)).toEqual([-0.6, 0.5, 12.3])
  })

  test('an item without an attachable is its icon in the hand', () => {
    mockPixels.length = 0
    const zombie = new BedrockEntity(assets, 'minecraft:zombie')
    zombie.setState({ equipment: { mainhand: 'diamond_sword' } })
    frames(zombie)
    const icon = zombie.attachments.slots.get('mainhand').icon
    expect(icon.parent).toBe(zombie.findBone('rightitem').group)
    expect(icon.children).toHaveLength(1)
    expect(mockPixels).toEqual(['textures/bedrock/items_diamond_sword.png'])
    // armour without an attachable is not drawn as an icon
    zombie.setState({ equipment: { mainhand: 'diamond_sword', feet: 'iron_helmet' } })
    expect(zombie.attachments.slots.get('feet').model.identifier).toBe('minecraft:iron_helmet')
    zombie.setState({ equipment: { feet: 'stone' } })
    expect(zombie.attachments.slots.get('feet').icon).toBeUndefined()
    expect(icon.parent).toBe(null)
  })
})
