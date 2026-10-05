// A recording of a Bedrock client's packets, as the replay page plays it: what the viewer is told of the world's
// entities, in the messages a WorldView sends of a bot's (see viewer/lib/worldView.js). Read alike in Node
// (recording.js, from a file) and in the page (replayWorker.js, from what it fetched): nothing here reads files.
//
//   decodeRecording(records(bytes), parse, world) -> { version, recorded, world, start, events }
//     world   the world.json beside the recording ({ palette, fills }), or null
//     start   where the player started: { position, yaw, pitch }
//     events  [{ t (seconds), entity: { id, ... } } | { t, particle: { name, position } } | { t, level: { event, position,
//             data } } (a level event of particles) | { t, log }]
//
// Recordings are the .proxy.bin files of bedrock-observer and the proxy recorder: after the version, records of a
// kind (C from the server, S to it, L a log line), a time (ns) and a packet (a Buffer: bytes is one).
const { BedrockTracker } = require('../../../../viewer/lib/bedrockTracker')
const { nearestBedrockVersion, bedrockSupportedVersions } = require('../../../../viewer/lib/version')

const compare = (a, b) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}
// the protocols a client version may have spoken, of those the data has: its own, else the nearest before and after it
// (a client build the data has no version of shares the protocol of one of them: 1.21.1 that of 1.21.0, 1.20.60 that
// of 1.20.61)
function candidates (version, known) {
  if (known.includes(version)) return [version]
  const sorted = [...known].sort(compare)
  return [sorted.filter(v => compare(v, version) < 0).pop(), sorted.find(v => compare(v, version) > 0)].filter(Boolean)
}

function varint (buf, offset) {
  let value = 0
  let shift = 0
  for (;;) {
    const byte = buf[offset++]
    value |= (byte & 0x7f) << shift
    shift += 7
    if (byte < 0x80) return [value >>> 0, offset]
  }
}

function records (data) {
  let [length, offset] = varint(data, 0)
  const version = data.subarray(offset, offset + length).toString()
  offset += length
  const out = []
  while (offset < data.length) {
    const kind = String.fromCharCode(data[offset])
    const time = Number(data.readBigInt64LE(offset + 1))
    offset += 9
    if (kind === 'L') {
      const [len, o] = varint(data, offset)
      out.push({ kind, time, log: JSON.parse(data.subarray(o, o + len).toString()) })
      offset = o + len
      continue
    }
    const len = data.readUInt32LE(offset)
    offset += 4
    out.push({ kind, time, buffer: data.subarray(offset, offset + len) })
    offset += len
  }
  return { version, records: out }
}

const DEG = Math.PI / 180
const BYTE_ANGLE = 360 / 256
// the game's yaw and pitch (degrees; yaw 0 toward +z, clockwise) as mineflayer's, which the viewer takes
const yawOf = degrees => Math.PI - degrees * DEG
const pitchOf = degrees => -degrees * DEG
const plain = value => JSON.parse(JSON.stringify(value, (key, v) => typeof v === 'bigint' ? Number(v) : v))

// entity data as a WorldView sends it: { flags: { name: bool }, variant, ... }
function metadataOf (list) {
  const out = { flags: {} }
  for (const { key, value } of list ?? []) {
    if (key === 'flags' || key === 'flags_extended') {
      for (const [flag, on] of Object.entries(value ?? {})) if (!flag.startsWith('_')) out.flags[flag] = on
    } else {
      out[key] = plain(value)
    }
  }
  return out
}

function healthOf (attributes) {
  const health = (attributes ?? []).find(a => a.name === 'minecraft:health')
  return health ? { health: health.value ?? health.current, maxHealth: health.max } : {}
}

// What a recording tells the viewer: records(bytes) of it, its packets read by parse (a packet's bytes -> { name, params }),
// and the world.json beside it, or null
function decodeRecording ({ version, records: list }, parse, world = null) {
  const tracker = new BedrockTracker()
  const runtimeOf = new Map()
  const places = new Map()
  const items = new Map()
  const events = []
  let start = null
  const t0 = list[0]?.time ?? 0
  for (const record of list) {
    const t = (record.time - t0) / 1e9
    if (record.kind === 'L') {
      events.push({ t, log: record.log })
      const data = record.log?.data
      if (data?.type === 'test-case-start' && data.startPos) start = { position: data.startPos, yaw: data.yaw ?? 0, pitch: data.pitch ?? 0 }
      continue
    }
    if (record.kind !== 'C') continue
    let packet
    try {
      packet = parse(record.buffer)
    } catch {
      continue
    }
    const p = packet.params
    const emit = entity => events.push({ t, entity })
    const props = id => {
      const known = tracker.properties.get(id)
      return known ? { properties: known } : {}
    }
    switch (packet.name) {
      case 'start_game': {
        // (older protocols name the spawn only)
        const at = p.player_position ?? p.spawn_position
        if (at) start ??= { position: [at.x, at.y, at.z], yaw: p.rotation?.z ?? 0, pitch: p.rotation?.x ?? 0 }
        break
      }
      case 'item_registry':
        for (const item of p.itemstates ?? []) items.set(item.runtime_id, item.name.replace(/^minecraft:/, ''))
        break
      case 'sync_entity_property':
        tracker.define(p.nbt)
        break
      case 'add_entity': {
        // (older protocols name its ids runtime_entity_id and entity_id_self)
        const id = Number(p.runtime_id ?? p.runtime_entity_id)
        runtimeOf.set(String(p.unique_id ?? p.entity_id_self), id)
        tracker.tell(id, p.entity_type, p.properties)
        const place = { pos: { ...p.position }, yaw: p.yaw, pitch: p.pitch, headYaw: p.head_yaw, metadata: metadataOf(p.metadata) }
        places.set(id, place)
        emit({
          id,
          name: p.entity_type.replace(/^minecraft:/, ''),
          pos: place.pos,
          yaw: yawOf(place.yaw),
          pitch: pitchOf(place.pitch),
          headYaw: yawOf(place.headYaw),
          metadata: place.metadata,
          ...healthOf(p.attributes),
          ...props(id)
        })
        break
      }
      case 'add_player': {
        const id = Number(p.runtime_id)
        const place = { pos: { ...p.position }, yaw: p.yaw, pitch: p.pitch, headYaw: p.head_yaw, metadata: metadataOf(p.metadata) }
        places.set(id, place)
        emit({ id, name: 'player', username: p.username, pos: place.pos, yaw: yawOf(place.yaw), pitch: pitchOf(place.pitch), headYaw: yawOf(place.headYaw), metadata: place.metadata })
        break
      }
      case 'move_entity_delta': {
        const id = Number(p.runtime_entity_id)
        const place = places.get(id)
        if (!place) break
        // (what did not change is left out)
        if (p.x !== undefined) place.pos = { ...place.pos, x: p.x }
        if (p.y !== undefined) place.pos = { ...place.pos, y: p.y }
        if (p.z !== undefined) place.pos = { ...place.pos, z: p.z }
        if (p.rot_x !== undefined) place.pitch = p.rot_x * BYTE_ANGLE
        if (p.rot_y !== undefined) place.yaw = p.rot_y * BYTE_ANGLE
        if (p.rot_z !== undefined) place.headYaw = p.rot_z * BYTE_ANGLE
        emit({ id, pos: place.pos, yaw: yawOf(place.yaw), pitch: pitchOf(place.pitch), headYaw: yawOf(place.headYaw), onGround: !!p.on_ground })
        break
      }
      case 'move_entity': {
        const id = Number(p.runtime_entity_id)
        const place = places.get(id)
        if (!place) break
        place.pos = { ...p.position }
        if (p.rotation) Object.assign(place, { pitch: p.rotation.x, yaw: p.rotation.y, headYaw: p.rotation.z ?? p.rotation.y })
        emit({ id, pos: place.pos, yaw: yawOf(place.yaw), pitch: pitchOf(place.pitch), headYaw: yawOf(place.headYaw), onGround: !!p.on_ground })
        break
      }
      case 'set_entity_data': {
        const id = Number(p.runtime_entity_id)
        const place = places.get(id)
        if (!place) break
        if (p.properties) tracker.tell(id, null, p.properties)
        // (the packet has what changed: the entity's data is all it was told, as a WorldView sends it)
        const changed = metadataOf(p.metadata)
        place.metadata = { ...place.metadata, ...changed, flags: { ...place.metadata.flags, ...changed.flags } }
        emit({ id, metadata: place.metadata, ...props(id) })
        break
      }
      case 'update_attributes': {
        const id = Number(p.runtime_entity_id)
        if (!places.has(id)) break
        const health = (p.attributes ?? []).find(a => a.name === 'minecraft:health')
        if (health) emit({ id, health: health.current, maxHealth: health.max })
        break
      }
      case 'mob_equipment': {
        const id = Number(p.runtime_entity_id)
        if (!places.has(id)) break
        const item = p.item?.network_id ? items.get(p.item.network_id) : undefined
        emit({ id, equipment: { [p.window_id === 'offhand' ? 'offhand' : 'mainhand']: item } })
        break
      }
      case 'entity_event': {
        const id = Number(p.runtime_entity_id)
        if (places.has(id)) emit({ id, event: p.event_id, data: p.data })
        break
      }
      case 'animate': {
        const id = Number(p.runtime_entity_id)
        if (places.has(id)) emit({ id, event: p.action_id })
        break
      }
      case 'remove_entity': {
        const id = runtimeOf.get(String(p.entity_id_self))
        if (id === undefined) break
        places.delete(id)
        tracker.forget(id)
        emit({ id, delete: true })
        break
      }
      case 'spawn_particle_effect':
        events.push({ t, particle: { name: p.particle_name, position: p.position } })
        break
      // particles the game draws itself, by a level event (a block's pieces as it breaks, a dispenser's smoke)
      case 'level_event':
        if (/^particle/.test(String(p.event))) events.push({ t, level: { event: p.event, position: p.position, data: p.data } })
        break
    }
  }
  // the viewer shows it as the version of its assets nearest the client's
  return { version: nearestBedrockVersion('bedrock_' + version, bedrockSupportedVersions) ?? 'bedrock_' + version, recorded: version, world, start, events }
}

module.exports = { records, decodeRecording, candidates, compare }
