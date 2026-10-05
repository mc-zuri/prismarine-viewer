/**
 * @jest-environment node
 */
/* eslint-env jest */
// The entities of a Bedrock world: drawn with their version's client entities and item icons (built here, as
// prerender.js builds them, into a folder the page's files are read from), with Java's models or the placeholder for
// what the version has none of; and what a Bedrock bot's WorldView tells of them.
const fs = require('fs')
const os = require('os')
const path = require('path')
const EventEmitter = require('events')
const THREE = require('three')
const { Vec3 } = require('vec3')

let mockPublic = null
const mockPixels = []
jest.mock('../viewer/lib/utils', () => ({
  loadJSON: (url, onLoad, onError) => {
    let data
    try {
      data = JSON.parse(require('fs').readFileSync(require('path').join(mockPublic, url), 'utf8'))
    } catch (err) {
      if (!onError) throw err
      return onError(err)
    }
    onLoad(data)
  },
  loadImage: () => {},
  loadPixels: (path, onLoad) => {
    mockPixels.push(path)
    onLoad({ width: 1, height: 1, data: [255, 255, 255, 255] })
  },
  loadTexture: (path, onLoad) => onLoad(new (require('three').Texture)())
}))
jest.mock('canvas', () => ({ createCanvas: () => ({ getContext: () => ({ fillText () {} }) }) }))
jest.mock('../viewer/lib/entity/Entity', () => function () { throw new Error('no Java models here') })

const { Entities } = require('../viewer/lib/entities')
const { WorldView } = require('../viewer/lib/worldView')
const { entityAssets, writeEntityAssets } = require('../viewer/lib/bedrock/entity/prerender')
const { encodeSkin } = require('../viewer/lib/bedrock/entity/skinData')

const VERSION = 'bedrock_1.26.51'
const flush = () => new Promise(resolve => setImmediate(resolve))
const pos = { x: 0, y: 64, z: 0 }
const isMissingModel = o => o.isMesh && o.material.color?.getHex() === 0xff00ff

// a version of a cow and a player, and beds
function versionAssets () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-version-'))
  for (const [file, content] of [['entity/cow/cow_v2.png', 'cow'], ['entity/steve.png', 'steve'], ['entity/alex.png', 'alex'], ['items/bed_white.png', 'white'], ['items/bed_red.png', 'red']]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  const box = name => ({ texture_width: 64, texture_height: 64, bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [{ origin: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] }] }, { name: 'head', parent: 'body', pivot: [0, 8, 0], cubes: [{ origin: [-4, 8, -4], size: [8, 8, 8], uv: [0, 16] }] }] })
  return {
    entities: {
      entities: {
        'minecraft:cow': { identifier: 'minecraft:cow', textures: { default: 'textures/entity/cow/cow_v2' }, geometry: { default: 'geometry.cow' } },
        'minecraft:player': { identifier: 'minecraft:player', textures: { default: 'textures/entity/steve' }, geometry: { default: 'geometry.humanoid.custom' } }
      },
      geometry: { 'geometry.cow': box(), 'geometry.humanoid.custom': box(), 'geometry.humanoid.customSlim': box() },
      render_controllers: {},
      animations: {},
      animation_controllers: {},
      materials: {}
    },
    itemsArray: [{ name: 'bed', texture: 'items/bed_white', variants: { 14: 'items/bed_red' } }],
    // a heart the game emits itself, and flames that would burn on for ever
    particles: {
      particles: {
        'minecraft:heart_particle': { description: { identifier: 'minecraft:heart_particle', basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/particles' } }, components: { 'minecraft:emitter_rate_manual': {}, 'minecraft:emitter_lifetime_expression': {}, 'minecraft:particle_lifetime_expression': { max_lifetime: 1 } } },
        'minecraft:flames': { description: { identifier: 'minecraft:flames', basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/particles' } }, components: { 'minecraft:emitter_rate_steady': {}, 'minecraft:emitter_lifetime_expression': {}, 'minecraft:particle_lifetime_expression': { max_lifetime: 1 } } }
      }
    },
    pathOf: entry => path.join(dir, entry)
  }
}

beforeAll(() => {
  mockPublic = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-public-'))
  writeEntityAssets(mockPublic, VERSION, entityAssets(versionAssets()))
})

async function setup (version = VERSION) {
  const scene = new THREE.Scene()
  const entities = new Entities(scene)
  entities.setVersion(version)
  return { scene, entities }
}

describe('Bedrock entities', () => {
  test('one told of while the version\'s assets load is drawn with its client entity once they have', async () => {
    const { entities } = await setup()
    entities.update({ id: 1, name: 'cow', pos, width: 0.9, height: 1.3, yaw: Math.PI / 2, headYaw: Math.PI, pitch: -0.5 })
    expect(entities.entities[1]).toBeUndefined()
    await flush()
    const model = entities.entities[1].bedrock
    expect(model.identifier).toBe('minecraft:cow')
    expect(entities.entities[1].rotation.y).toBeCloseTo(Math.PI / 2)
    // the game's angles: yaw clockwise from +z, pitch down
    expect(model.motion.yaw).toBeCloseTo(90)
    expect(model.motion.headYaw).toBeCloseTo(0)
    expect(model.motion.pitch).toBeCloseTo(0.5 * 180 / Math.PI)
  })

  test('its data and its events go to its model, and each frame runs it', async () => {
    const { entities } = await setup()
    entities.update({ id: 1, name: 'cow', pos, width: 0.9, height: 1.3, metadata: { flags: { baby: true } } })
    await flush()
    const model = entities.entities[1].bedrock
    expect(model.query('is_baby', [])).toBe(1)
    entities.update({ id: 1, event: 'hurt_animation' })
    expect(model.actor.hurt()).toBe(true)
    entities.update({ id: 1, metadata: { flags: {}, variant: 2 }, health: 4, maxHealth: 10 })
    expect(model.query('variant', [])).toBe(2)
    expect(model.query('health', [])).toBe(4)
    entities.update({ id: 1, properties: { 'minecraft:climate_variant': 'warm' } })
    expect(model.query('property', ['minecraft:climate_variant'])).toBe('warm')
    await new Promise(resolve => setTimeout(resolve, 20))
    entities.animate(new THREE.PerspectiveCamera())
    expect(model.lifeTime).toBeGreaterThan(0)
    expect(model.layers.size).toBe(1)
  })

  test('a player is Steve, or Alex for slim arms, with its name over its head', async () => {
    const { entities } = await setup()
    entities.update({ id: 2, name: 'player', username: 'steve', pos, width: 0.6, height: 1.8 })
    entities.update({ id: 3, name: 'player', username: 'alex', skinModel: 'slim', pos, width: 0.6, height: 1.8 })
    await flush()
    expect(entities.entities[2].bedrock.overrides.geometry.default).toBe('geometry.humanoid.custom')
    expect(entities.entities[3].bedrock.overrides.geometry.default).toBe('geometry.humanoid.customSlim')
    expect(entities.entities[3].nameTag.parent).toBe(entities.entities[3])
  })

  test('a player with its own skin is drawn with it once decoded; one that cannot be drawn stays Steve', async () => {
    const { entities } = await setup()
    const skin = (patch, alpha = 255) => encodeSkin({
      skin_resource_pack: JSON.stringify({ geometry: { default: patch } }),
      skin_data: { width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4, alpha) },
      geometry_data: '',
      arm_size: 'slim'
    })
    const own = skin('geometry.humanoid.customSlim')
    entities.update({ id: 6, name: 'player', username: 'own', pos, width: 0.6, height: 1.8, bedrockSkin: own })
    entities.update({ id: 7, name: 'player', username: 'none', pos, width: 0.6, height: 1.8, bedrockSkin: skin('geometry.nowhere') })
    for (let i = 0; i < 5; i++) await flush()
    const model = entities.entities[6].bedrock
    expect(model.ownSkin).toBe(true)
    expect(model.overrides.textures.default.image.width).toBe(64)
    expect(entities.entities[7].bedrock.ownSkin).toBe(false)
    // told again by its key: the same model
    entities.update({ id: 6, pos, bedrockSkin: { key: own.key, armSize: 'slim' } })
    await flush()
    expect(entities.entities[6].bedrock).toBe(model)
  })

  test('one the version has no client entity of is Java\'s model, else the placeholder', async () => {
    const { entities } = await setup()
    entities.update({ id: 4, name: 'falling_block', pos, width: 0.98, height: 0.98 })
    await flush()
    expect(isMissingModel(entities.entities[4])).toBe(true)
  })

  test('a dropped item is the icon its stack\'s aux value picks', async () => {
    const { entities } = await setup()
    mockPixels.length = 0
    entities.update({ id: 5, name: 'item', pos, width: 0.25, height: 0.25, itemName: 'bed', itemAux: 14 })
    await flush()
    await flush()
    const files = JSON.parse(fs.readFileSync(path.join(mockPublic, 'entities', 'bedrock_1.26.51.json'), 'utf8')).textureFiles
    expect(mockPixels).toEqual(['textures/' + files['items/bed_red']])
    expect(entities.entities[5].item.pivot.children).toHaveLength(1)
    // another stack of it is drawn anew
    const before = entities.entities[5]
    entities.update({ id: 5, pos, itemName: 'bed', itemAux: 0 })
    await flush()
    expect(entities.entities[5]).not.toBe(before)
    expect(mockPixels[1]).toBe('textures/' + files['items/bed_white'])
  })

  test('the server\'s particle effects show, and those its entities start', async () => {
    const { entities } = await setup()
    entities.update({ id: 1, name: 'cow', pos, width: 0.9, height: 1.3 })
    await flush()
    const particles = entities.bedrock.particles
    // one heart, of the effect the game emits itself
    expect(entities.spawnParticle('heart_particle', pos)).toBe(true)
    expect(particles.count()).toBe(1)
    // flames that would burn on for ever stop after 10 seconds
    expect(entities.spawnParticle('minecraft:flames', pos)).toBe(true)
    const flames = particles.emitters.find(e => e.identifier === 'minecraft:flames')
    expect(flames.duration).toBe(10)
    expect(entities.spawnParticle('minecraft:nowhere', pos)).toBe(false)
    // the cow's model shows its effects in the same system
    const model = entities.entities[1].bedrock
    expect(model.particles).toBe(particles)
    model.particleEffects.burn = 'minecraft:flames'
    const own = model.startEffect({ effect: 'burn' })
    expect(particles.emitters).toContain(own)
    entities.update({ id: 1, delete: true })
    expect(own.expired).toBe(true)
  })

  test('a version with no entities built draws Java\'s models', async () => {
    const { entities } = await setup('bedrock_1.21.0')
    entities.update({ id: 1, name: 'cow', pos, width: 0.9, height: 1.3 })
    await flush()
    expect(entities.entities[1].bedrock).toBeUndefined()
    expect(isMissingModel(entities.entities[1])).toBe(true)
    // and no particle effects
    expect(entities.spawnParticle('heart_particle', pos)).toBe(false)
  })
})

describe('what a Bedrock bot\'s WorldView tells of its entities', () => {
  function setupBot (type = 'bedrock') {
    const bot = new EventEmitter()
    bot.username = 'bot'
    bot.registry = { type }
    bot.players = {}
    bot._client = new EventEmitter()
    bot.entity = { id: 1, position: new Vec3(0, 64, 0) }
    bot.entities = { 1: bot.entity }
    const view = new WorldView({}, 4, new Vec3(0, 0, 0))
    const told = []
    view.on('entity', e => told.push(e))
    view.listenToBot(bot)
    return { bot, told, view }
  }

  const cow = () => ({
    id: 5,
    name: 'cow',
    position: new Vec3(1, 64, 1),
    width: 0.9,
    height: 1.3,
    yaw: 1,
    pitch: 0,
    headYaw: 1.5,
    onGround: true,
    metadata: { flags: { baby: true }, target_eid: 7n, owner_eid: -1n, variant: 1 },
    equipment: [{ name: 'iron_sword' }],
    attributes: { 'minecraft:health': { value: 8, max: 10 } }
  })

  test('its data with longs as numbers, its head\'s turn, what it holds, its health; a dropped item\'s stack', () => {
    const { bot, told } = setupBot()
    bot.entities[5] = cow()
    bot.emit('entitySpawn', bot.entities[5])
    bot.emit('entitySpawn', { id: 6, name: 'item', position: new Vec3(2, 64, 2), width: 0.25, height: 0.25, metadata: {}, item: { name: 'bed', metadata: 14 } })
    expect(told[0]).toMatchObject({ id: 5, name: 'cow', yaw: 1, headYaw: 1.5, onGround: true, health: 8, maxHealth: 10, metadata: { target_eid: 7, owner_eid: -1, variant: 1 }, equipment: { mainhand: 'iron_sword' } })
    expect(told[1]).toMatchObject({ id: 6, name: 'item', itemName: 'bed', itemAux: 14 })
    // as socket.io sends it
    expect(() => JSON.stringify(told)).not.toThrow()
  })

  test('what it does, by the protocol\'s names; nothing of the bot itself', () => {
    const { bot, told } = setupBot()
    bot.entities[5] = cow()
    bot._client.emit('entity_event', { runtime_entity_id: 5n, event_id: 'hurt_animation', data: 0 })
    bot._client.emit('animate', { runtime_entity_id: 5n, action_id: 'swing_arm' })
    bot._client.emit('animate_entity', { animation: 'animation.cow.wave', next_state: 'default', stop_condition: '', controller: '', blend_out_time: 0, runtime_entity_ids: [5n, 1n] })
    bot._client.emit('entity_event', { runtime_entity_id: 1n, event_id: 'hurt_animation', data: 0 })
    bot.emit('entityMoved', bot.entity)
    bot.emit('entityUpdate', bot.entity)
    expect(told).toEqual([
      { id: 5, event: 'hurt_animation', data: 0 },
      { id: 5, event: 'swing_arm' },
      { id: 5, animation: { animation: 'animation.cow.wave', nextState: 'default', stopCondition: '', controller: '', blendOutTime: 0 } }
    ])
  })

  test('the particle effects the server spawns, by identifier; on an entity, where it is', () => {
    const { bot, view } = setupBot()
    const told = []
    bot.entities[5] = cow()
    // (the tracker knows the cow's unique id from its spawn)
    bot._client.emit('add_entity', { runtime_id: 5n, unique_id: -5n, entity_type: 'minecraft:cow' })
    view.on('particle', p => told.push(p))
    bot._client.emit('spawn_particle_effect', { dimension: 0, entity_id: -1n, position: { x: 1, y: 2, z: 3 }, particle_name: 'minecraft:heart_particle' })
    bot._client.emit('spawn_particle_effect', { dimension: 0, entity_id: -5n, position: { x: 0, y: 1, z: 0 }, particle_name: 'minecraft:villager_happy', molang_variables: JSON.stringify([{ name: 'variable.direction', value: { type: 'member_array', value: [{ name: '.x', value: { type: 'float', value: 1 } }] } }, { name: 'variable.size', value: { type: 'float', value: 2 } }]) })
    expect(told).toEqual([
      { name: 'minecraft:heart_particle', pos: { x: 1, y: 2, z: 3 } },
      { name: 'minecraft:villager_happy', pos: { x: 1, y: 65, z: 1 }, variables: { 'direction.x': 1, size: 2 } }
    ])
  })

  test('a Java bot\'s entities are told as before', () => {
    const { bot, told } = setupBot('pc')
    bot.registry.items = {}
    const e = cow()
    bot.emit('entitySpawn', e)
    bot.emit('entityMoved', e)
    bot.emit('entityUpdate', e)
    expect(told).toEqual([
      { id: 5, name: 'cow', pos: e.position, width: 0.9, height: 1.3, username: undefined, riding: false, itemName: undefined, skinModel: undefined },
      { id: 5, pos: e.position, pitch: 0, yaw: 1 }
    ])
  })
})
