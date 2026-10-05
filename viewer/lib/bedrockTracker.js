// What a Bedrock bot's client is told that mineflayer does not keep, and the viewer draws entities with:
//  - entity properties (a cow's climate variant, a bee's nectar): the properties of each entity type, by index
//    (sync_entity_property, sent at login), and each entity's values of them (add_entity, set_entity_data)
//  - each player's skin (player_list, player_skin)
// Much of it comes at login, before a viewer usually starts: call trackBedrock(bot) right after creating the bot to
// keep it from the start. The viewer calls it itself when it starts, and knows what comes from then on. Nothing for a
// Java bot.
//
//   const tracker = trackBedrock(bot)
//   tracker.properties.get(entityId)   // { 'minecraft:climate_variant': 'warm' }
//   tracker.skins.get(uuid)            // encodeSkin() of the player's skin
//   tracker.on('skin', uuid => ...)    // a player's skin, new or changed
const EventEmitter = require('events')
const { encodeSkin } = require('./bedrock/entity/skinData')

// property types, as the game numbers them in sync_entity_property
const INT = 0
const FLOAT = 1
const BOOL = 2
const ENUM = 3

const toNumber = value => typeof value === 'bigint' ? Number(value) : (Array.isArray(value) ? value[0] * 2 ** 32 + (value[1] >>> 0) : value)

// prismarine-nbt's tags as plain values (bedrock-protocol gives the tags; a test may give them plain)
function simplify (tag) {
  if (!tag || typeof tag !== 'object' || !('type' in tag) || !('value' in tag) || typeof tag.type !== 'string') return tag
  switch (tag.type) {
    case 'compound':
      return Object.fromEntries(Object.entries(tag.value).map(([key, value]) => [key, simplify(value)]))
    case 'list':
      return (tag.value?.value ?? []).map(value => simplify({ type: tag.value.type, value }))
    case 'long':
      return toNumber(tag.value)
    default:
      return tag.value
  }
}

class BedrockTracker extends EventEmitter {
  constructor () {
    super()
    // entity identifier -> [{ name, type, values }], in the order the indexes count
    this.types = new Map()
    // runtime id -> { type, ints: Map(index -> value), floats: Map(index -> value) }, as told
    this.told = new Map()
    // runtime id -> { name: value }
    this.properties = new Map()
    this.uniqueToRuntime = new Map()
    // uuid -> encodeSkin()
    this.skins = new Map()
  }

  // the property definitions of an entity type
  define (nbt) {
    const data = simplify(nbt)
    const type = data?.type
    if (typeof type !== 'string' || !Array.isArray(data.properties)) return
    this.types.set(type, data.properties.map(p => ({ name: p.name, type: toNumber(p.type), values: p.enum ?? p.values ?? [] })))
    // what was told of entities of that type before their definitions
    for (const [id, told] of this.told) if (told.type === type) this.decode(id)
  }

  // what an entity's packet says of its properties (partial: only those changed)
  tell (id, type, properties) {
    if (id === null) return
    let told = this.told.get(id)
    if (!told) {
      told = { type, ints: new Map(), floats: new Map() }
      this.told.set(id, told)
    }
    if (type) told.type = type
    for (const { index, value } of properties?.ints ?? []) told.ints.set(index, value)
    for (const { index, value } of properties?.floats ?? []) told.floats.set(index, value)
    this.decode(id)
  }

  decode (id) {
    const told = this.told.get(id)
    const defs = this.types.get(told?.type)
    if (!defs) return
    const properties = {}
    for (const [index, value] of told.ints) {
      const def = defs[index]
      if (!def) continue
      if (def.type === ENUM) properties[def.name] = def.values[value] ?? value
      else if (def.type === BOOL) properties[def.name] = value ? 1 : 0
      else properties[def.name] = value
    }
    for (const [index, value] of told.floats) {
      const def = defs[index]
      if (def && (def.type === FLOAT || def.type === INT)) properties[def.name] = value
    }
    if (Object.keys(properties).length) this.properties.set(id, properties)
  }

  forget (id) {
    this.told.delete(id)
    this.properties.delete(id)
  }

  setSkin (uuid, skin) {
    const encoded = encodeSkin(skin)
    if (!uuid || this.skins.get(uuid)?.key === encoded?.key) return
    if (encoded) this.skins.set(uuid, encoded)
    else this.skins.delete(uuid)
    this.emit('skin', uuid)
  }
}

const runtimeId = value => {
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

const trackers = new WeakMap()

/** The tracker of a Bedrock bot (one per bot, listening from the first call), null for a Java bot. */
function trackBedrock (bot) {
  const client = bot?._client
  const bedrock = bot?.edition === 'bedrock' || bot?.registry?.type === 'bedrock'
  if (!bedrock || !client) return null
  if (trackers.has(client)) return trackers.get(client)
  const tracker = new BedrockTracker()
  trackers.set(client, tracker)
  // before mineflayer's own listeners, so that what an entity's spawn and update events tell is known by then
  const on = (name, listener) => client.prependListener(name, listener)
  on('sync_entity_property', packet => tracker.define(packet.nbt))
  on('add_entity', packet => {
    const id = runtimeId(packet.runtime_id ?? packet.runtime_entity_id)
    if (id === null) return
    tracker.forget(id)
    tracker.uniqueToRuntime.set(String(packet.unique_id ?? packet.entity_id_self), id)
    tracker.tell(id, packet.entity_type, packet.properties)
  })
  on('set_entity_data', packet => {
    if (packet.properties) tracker.tell(runtimeId(packet.runtime_entity_id), null, packet.properties)
  })
  on('remove_entity', packet => {
    const key = String(packet.entity_id_self)
    const id = tracker.uniqueToRuntime.get(key)
    tracker.uniqueToRuntime.delete(key)
    if (id !== undefined) tracker.forget(id)
  })
  on('player_list', packet => {
    const records = Array.isArray(packet.records) ? packet.records : (packet.records?.records ?? [])
    const type = Array.isArray(packet.records) ? null : packet.records?.type
    for (const record of records) {
      if ((record.type ?? type) === 'add') tracker.setSkin(record.uuid, record.skin_data)
      else if (record.uuid && tracker.skins.delete(record.uuid)) tracker.emit('skin', record.uuid)
    }
  })
  on('player_skin', packet => tracker.setSkin(packet.uuid, packet.skin))
  return tracker
}

module.exports = { trackBedrock, BedrockTracker, simplify }
