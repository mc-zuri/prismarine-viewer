/**
 * @jest-environment node
 */
/* eslint-env jest */
// What a Bedrock bot's WorldView tells of entities beyond what mineflayer keeps: their entity properties, by name
// (sync_entity_property, add_entity, set_entity_data), and the players' skins (player_list, player_skin), each skin
// whole once and by its key after.
const EventEmitter = require('events')
const { Vec3 } = require('vec3')
const { WorldView } = require('../viewer/lib/worldView')
const { trackBedrock } = require('../viewer/lib/bedrockTracker')
const { decodeSkin } = require('../viewer/lib/bedrock/entity/skinData')

// a bot whose client answers add_entity, set_entity_data and add_player as mineflayer's Bedrock plugin does: with
// entitySpawn and entityUpdate, its own listeners first
function bedrockBot () {
  const bot = new EventEmitter()
  bot.username = 'bot'
  bot.edition = 'bedrock'
  bot.registry = { type: 'bedrock' }
  bot.players = {}
  bot._client = new EventEmitter()
  bot.entity = { id: 1, position: new Vec3(0, 64, 0) }
  bot.entities = { 1: bot.entity }
  const entity = (id, props) => (bot.entities[id] = { id, position: new Vec3(0, 64, 0), metadata: {}, equipment: [], ...props })
  bot._client.on('add_entity', packet => bot.emit('entitySpawn', entity(Number(packet.runtime_id), { name: packet.entity_type.replace('minecraft:', ''), type: 'mob' })))
  bot._client.on('set_entity_data', packet => bot.emit('entityUpdate', bot.entities[Number(packet.runtime_entity_id)]))
  bot._client.on('add_player', packet => bot.emit('entitySpawn', entity(Number(packet.runtime_id), { name: 'player', type: 'player', username: packet.username, uuid: packet.uuid })))
  return bot
}

function view (bot) {
  const told = []
  const worldView = new WorldView({}, 4, new Vec3(0, 0, 0))
  worldView.on('entity', e => told.push(e))
  worldView.listenToBot(bot)
  return { worldView, told }
}

// sync_entity_property as bedrock-protocol reads it: prismarine-nbt tags
const tag = {
  string: value => ({ type: 'string', value }),
  int: value => ({ type: 'int', value })
}
function syncProperties (type, properties) {
  return {
    nbt: {
      type: 'compound',
      name: '',
      value: {
        type: tag.string(type),
        properties: {
          type: 'list',
          value: {
            type: 'compound',
            value: properties.map(p => ({ name: tag.string(p.name), type: tag.int(p.type), ...(p.enum ? { enum: { type: 'list', value: { type: 'string', value: p.enum } } } : {}) }))
          }
        }
      }
    }
  }
}
const climate = { name: 'minecraft:climate_variant', type: 3, enum: ['temperate', 'warm', 'cold'] }

describe('entity properties', () => {
  test('by name and enum value, at the spawn and on each change', () => {
    const bot = bedrockBot()
    const { told } = view(bot)
    bot._client.emit('sync_entity_property', syncProperties('minecraft:cow', [climate]))
    bot._client.emit('sync_entity_property', syncProperties('minecraft:bee', [{ name: 'minecraft:has_nectar', type: 2 }, { name: 'minecraft:speed', type: 1 }]))
    bot._client.emit('add_entity', { runtime_id: 5n, unique_id: -5n, entity_type: 'minecraft:cow', properties: { ints: [{ index: 0, value: 1 }], floats: [] } })
    expect(told[0]).toMatchObject({ id: 5, name: 'cow', properties: { 'minecraft:climate_variant': 'warm' } })
    bot._client.emit('set_entity_data', { runtime_entity_id: 5n, metadata: [], properties: { ints: [{ index: 0, value: 2 }], floats: [] } })
    expect(told[1]).toMatchObject({ id: 5, properties: { 'minecraft:climate_variant': 'cold' } })

    bot._client.emit('add_entity', { runtime_id: 6n, unique_id: -6n, entity_type: 'minecraft:bee', properties: { ints: [{ index: 0, value: 1 }], floats: [{ index: 1, value: 0.5 }] } })
    expect(told[2].properties).toEqual({ 'minecraft:has_nectar': 1, 'minecraft:speed': 0.5 })
    expect(() => JSON.stringify(told)).not.toThrow()
  })

  test('told before their definitions: named once these come; nothing for an entity type without any', () => {
    const bot = bedrockBot()
    const tracker = trackBedrock(bot)
    bot._client.emit('add_entity', { runtime_id: 7n, unique_id: -7n, entity_type: 'minecraft:pig', properties: { ints: [{ index: 0, value: 0 }], floats: [] } })
    expect(tracker.properties.get(7)).toBeUndefined()
    bot._client.emit('sync_entity_property', syncProperties('minecraft:pig', [climate]))
    expect(tracker.properties.get(7)).toEqual({ 'minecraft:climate_variant': 'temperate' })
    bot._client.emit('remove_entity', { entity_id_self: -7n })
    expect(tracker.properties.get(7)).toBeUndefined()
  })

  test('a Java bot has no tracker', () => {
    const bot = new EventEmitter()
    bot.registry = { type: 'pc' }
    bot._client = new EventEmitter()
    expect(trackBedrock(bot)).toBe(null)
    expect(bot._client.eventNames()).toEqual([])
  })
})

describe('player skins', () => {
  const rgba = (seed) => Uint8Array.from({ length: 64 * 64 * 4 }, (_, i) => (i * seed) & 255)
  const record = (uuid, seed) => ({
    type: 'add',
    uuid,
    username: 'steve' + seed,
    skin_data: { skin_resource_pack: '{"geometry":{"default":"geometry.humanoid.customSlim"}}', skin_data: { width: 64, height: 64, data: Buffer.from(rgba(seed)) }, geometry_data: '', arm_size: 'slim' }
  })

  test('sent whole with the player once, deflated, then by its key; a new skin anew', async () => {
    const bot = bedrockBot()
    const { told } = view(bot)
    bot._client.emit('player_list', { records: { type: 'add', records: [record('u-1', 3)] } })
    bot._client.emit('add_player', { runtime_id: 9n, uuid: 'u-1', username: 'steve3' })
    const skin = told[0].bedrockSkin
    expect(skin).toMatchObject({ width: 64, height: 64, armSize: 'slim', encoding: 'deflate' })
    expect(skin.data.length).toBeLessThan(64 * 64 * 4)
    const decoded = await decodeSkin(skin)
    expect(Array.from(decoded.image.data)).toEqual(Array.from(rgba(3)))
    expect(decoded.resourcePatch).toContain('customSlim')

    // the same player again (a respawn): its key only
    bot.emit('entitySpawn', bot.entities[9])
    expect(told[1].bedrockSkin).toEqual({ key: skin.key, armSize: 'slim' })

    // a skin changed: with the player's entity
    bot._client.emit('player_skin', { uuid: 'u-1', skin: record('u-1', 5).skin_data })
    expect(told[2]).toMatchObject({ id: 9, bedrockSkin: { width: 64, encoding: 'deflate' } })
    expect(told[2].bedrockSkin.key).not.toBe(skin.key)
  })

  test('a player whose skin was told before the view started has it too', () => {
    const bot = bedrockBot()
    trackBedrock(bot)
    bot._client.emit('player_list', { records: [record('u-2', 7)] })
    bot.entities[11] = { id: 11, name: 'player', type: 'player', uuid: 'u-2', position: new Vec3(0, 64, 0), metadata: {}, equipment: [] }
    const { told } = view(bot)
    expect(told[0].bedrockSkin.key).toMatch(/^64x64-/)
  })
})
