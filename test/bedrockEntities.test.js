/**
 * @jest-environment node
 */
/* eslint-env jest */
const THREE = require('three')
global.THREE = THREE

// a Bedrock version's assets: a humanoid with hands, a helmet worn on its head, an effect of instant particles
const humanoid = {
  texturewidth: 64,
  textureheight: 32,
  bones: [
    { name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }] },
    { name: 'head', parent: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }] },
    { name: 'rightArm', parent: 'body', pivot: [-5, 22, 0], cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] }] },
    { name: 'rightItem', parent: 'rightArm', pivot: [-6, 15, 1], cubes: [] },
    { name: 'leftArm', parent: 'body', pivot: [5, 22, 0], cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [40, 16], mirror: true }] },
    { name: 'leftItem', parent: 'leftArm', pivot: [6, 15, 1], cubes: [] },
    { name: 'rightLeg', parent: 'body', pivot: [-1.9, 12, 0], cubes: [{ origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 16] }] },
    { name: 'leftLeg', parent: 'body', pivot: [1.9, 12, 0], cubes: [{ origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [0, 16], mirror: true }] }
  ]
}
const mockAssets = {
  'entities.json': { zombie: { identifier: 'minecraft:zombie', geometry: { default: humanoid }, textures: { default: 'textures/entity/zombie/zombie' } } },
  'attachables.json': { diamond_helmet: { slot: 'helmet', texture: 'textures/models/armor/diamond_1', geometry: { ...humanoid, bones: [{ name: 'head', pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], inflate: 1 }] }] } } },
  'items_textures.json': [{ name: 'diamond_sword', texture: 'minecraft:items/diamond_sword' }],
  'particles.json': {
    'minecraft:test_particle': {
      texture: 'textures/particle/particles',
      material: 'particles_alpha',
      components: {
        'minecraft:emitter_rate_instant': { num_particles: 5 },
        'minecraft:emitter_lifetime_once': { active_time: 1 },
        'minecraft:emitter_shape_sphere': { radius: 0.5 },
        'minecraft:particle_initial_speed': 1,
        'minecraft:particle_lifetime_expression': { max_lifetime: '1 + variable.particle_random_1' },
        'minecraft:particle_appearance_billboard': { size: [0.1, 0.1], uv: { texture_width: 128, texture_height: 128, uv: [0, 40], uv_size: [8, 8] } }
      }
    }
  }
}

jest.mock('../viewer/lib/utils', () => ({
  loadJSON: (url, onLoad) => onLoad(mockAssets[url.split('/').pop()]),
  loadPixels: (path, onLoad) => onLoad({ width: 1, height: 1, data: [255, 255, 255, 255] }),
  loadTexture: () => {}
}))
jest.mock('canvas', () => ({ createCanvas: () => ({}) }))

const { Entities } = require('../viewer/lib/entities')
const { Particles } = require('../viewer/lib/particles')

const flush = () => new Promise(resolve => setImmediate(resolve))

test('a Bedrock version draws its own entity, the item in its hand and the armor on its bones', async () => {
  const scene = new THREE.Scene()
  const entities = new Entities(scene)
  entities.setVersion('bedrock_1.21.0')
  entities.update({ id: 1, name: 'zombie', pos: { x: 0, y: 64, z: 0 }, width: 0.6, height: 1.9, equipment: ['diamond_sword', null, null, null, null, 'diamond_helmet'] })
  await flush()
  const mesh = entities.entities[1]
  expect(mesh.model).toBeTruthy()
  expect(mesh.walk).toBeTruthy()
  expect(mesh.model.bone('rightitem').children).toHaveLength(1)
  const armor = mesh.equipped.filter(m => m.isSkinnedMesh)
  expect(armor).toHaveLength(1)
  expect(armor[0].skeleton).toBe(mesh.model.skinned.skeleton)
  // what it wears changes: the old is taken off
  entities.update({ id: 1, equipment: [null, null, null, null, null, null] })
  await flush()
  expect(mesh.model.bone('rightitem').children).toHaveLength(0)
  expect(mesh.equipped).toHaveLength(0)
})

test('a Bedrock version spawns its own particle effects', async () => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  const particles = new Particles(scene, camera)
  particles.setVersion('bedrock_1.21.0')
  particles.spawn({ name: 'test_particle', pos: { x: 0, y: 64, z: 0 } })
  particles.spawn({ name: 'minecraft:no_such_effect', pos: { x: 0, y: 64, z: 0 } })
  await flush()
  expect(particles.emitters).toHaveLength(1)
  particles.update()
  expect(particles.emitters[0].particles).toHaveLength(5)
  expect(particles.emitters[0].geometry.drawRange.count).toBe(30)
})
