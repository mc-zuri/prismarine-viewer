// A player connected to the server: the join as a Bedrock server leads it (with no RakNet, encryption or Xbox sign-in:
// the client's login is read, not verified), then what the player does. bedrock-demo's own server
// (packages/bedrock-server/src/index.ts) without bedrock-protocol's Server around it.
//
//   client                                server
//   request_network_settings (1.19.30)    network_settings
//   login                                 play_status login_success, resource_packs_info
//   client_cache_status
//   resource_pack_client_response         resource_pack_stack
//   resource_pack_client_response         start_game, item_registry (1.21.60), abilities, inventory, hotbar
//   request_chunk_radius                  chunk_radius_update, network_chunk_publisher_update, level_chunk...
//   subchunk_request (1.18)...            subchunk..., play_status player_spawn
//   set_local_player_as_initialized
//   player_auth_input every tick
//
// A player standing in a portal is taken to the dimension it leads to (portals.js): change_dimension, the columns of
// the dimension around where it arrives, and play_status player_spawn once they are out. A portal takes a player only
// once it has stepped out of the one it came through (or spawned in).
//
// A boat item used on water puts a boat there (add_entity); a use of the boat (an item use on the entity) gets on it
// (set_entity_link), the player's interact leave_vehicle takes it off, and a hit breaks it, the item back in the
// hotbar out of creative. The player drives it: its input reports the boat (from 1.20.71), which the server keeps.
const { EventEmitter } = require('events')
const { createCodec } = require('../protocol/codec')
const { PacketChannel } = require('../protocol/channel')
const { ChunkStreamer } = require('./chunks')
const { EYE_HEIGHT, PLAYER_ID, buildStartGame, abilitiesPacket, inventoryPacket, armorPacket, slotPacket } = require('./startGame')

const HOTBAR_SIZE = 9
const MAX_STACK = 64
// the rider's eyes over the boat's position (a boat driver's seat)
const SEAT_EYES = Math.fround(1.0200101)
const { PORTAL_TICKS, portalDestination } = require('./portals')
const { DIMENSIONS } = require('./recordedWorld')

// The JSON of a JWT's payload, read without checking its signature (the client signs nothing here)
function jwtPayload (token) {
  try {
    const part = String(token).split('.')[1]
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return {}
  }
}

// The name a login gives: its identity chain's extraData (the chain itself, or in a Certificate from 1.21.90)
function displayNameOf (tokens) {
  try {
    let identity = JSON.parse(tokens.identity)
    if (identity.Certificate) identity = JSON.parse(identity.Certificate)
    for (const token of identity.chain ?? []) {
      const name = jwtPayload(token).extraData?.displayName
      if (name) return name
    }
  } catch {}
  return 'player'
}

class Connection extends EventEmitter {
  constructor (server, port) {
    super()
    this.server = server
    this.codec = createCodec(server.version, { verify: server.verify })
    this.channel = new PacketChannel(port, this.codec)
    this.channel.on('packet', (name, params) => {
      try {
        this.handle(name, params)
      } catch (err) {
        server.log(`${name}: ${err.stack ?? err}`)
      }
    })
    this.channel.on('decodeError', (err, packet) => server.log(`unreadable packet ${packet[0]}: ${err.message}`))
    this.channel.on('close', reason => {
      server.remove(this)
      this.emit('close', reason)
    })
    this.username = 'player'
    this.stage = 'login'
    this.cache = false
    this.radius = 0
    this.gamemode = 'creative'
    this.flying = false
    // the dimension the player is in, its feet and look (Bedrock degrees), as its inputs say
    this.dimension = server.dimension
    const spawn = server.worlds.get(this.dimension).spawn
    this.feet = { x: spawn.x, y: spawn.y, z: spawn.z }
    this.yaw = spawn.yaw ?? 0
    this.pitch = spawn.pitch ?? 0
    // the portal it stands in: whether it may take it (it stepped out of the last), and for how many ticks
    this.portal = { armed: false, ticks: 0 }
    this.lastInputTick = 0n
    // a teleport sent: positions far from it are of ticks before the client took it
    this.teleportTarget = null
    this.selectedSlot = 0
    // what the player holds: its hotbar (the server's to start with) and the armour it wears (head, chest, legs, feet)
    this.hotbar = server.hotbar.map(item => ({ ...item }))
    this.armor = [null, null, null, null]
    // the boat it rides
    this.riding = null
    this.chunks = new ChunkStreamer(this, server)
    this.spawnChunk = { x: Math.floor(this.feet.x) >> 4, z: Math.floor(this.feet.z) >> 4 }
    this.spawnSent = false
    this.columnsAroundSpawn = 0
    this.stats = { placed: 0, broken: 0, refused: 0, heldMismatches: 0, inputs: 0, used: 0, boats: 0 }
  }

  queue (name, params) {
    try {
      this.channel.queue(name, params)
    } catch (err) {
      this.server.log(`${name} not written: ${err.message}`)
    }
  }

  close (reason) {
    this.channel.close(reason)
  }

  say (message) {
    this.queue('text', { type: 'raw', needs_translation: false, message })
  }

  handle (name, params) {
    const { server } = this
    switch (name) {
      case 'request_network_settings':
        this.queue('network_settings', { compression_threshold: 512, compression_algorithm: 'deflate', client_throttle: false, client_throttle_threshold: 0, client_throttle_scalar: 0 })
        return
      case 'login':
        return this.login(params)
      case 'client_cache_status':
        this.cache = !!params.enabled
        return
      case 'resource_pack_client_response':
        // the first answers the packs (there are none), the second the stack
        if (this.stage !== 'packs') return
        if (this.stackSent) return this.startGame()
        this.stackSent = true
        this.queue('resource_pack_stack', { must_accept: false, behavior_packs: [], resource_packs: [], game_version: '*', experiments: [], experiments_previously_used: false, has_editor_packs: false })
        return
      case 'request_chunk_radius':
        this.radius = Math.max(1, Math.min(Number(params.chunk_radius) || 1, server.maxRadius))
        this.queue('chunk_radius_update', { chunk_radius: this.radius })
        this.chunks.setRadius(this.radius)
        if (this.stage !== 'login' && this.stage !== 'packs') this.chunks.recenter(this.feet)
        return
      case 'subchunk_request':
        this.chunks.subchunkRequest(params)
        return
      case 'client_cache_blob_status':
        this.chunks.blobStatus(params)
        return
      case 'set_local_player_as_initialized':
        this.stage = 'playing'
        this.emit('spawn')
        return
      case 'player_auth_input':
        return this.input(params)
      case 'text':
        if (params.message) this.queue('text', { type: 'chat', needs_translation: false, source_name: this.username, message: params.message })
        return
      case 'command_request':
        server.command(params.command, this)
        return
      case 'inventory_transaction':
        return this.transaction(params.transaction)
      case 'interact':
        if (params.action_id === 'leave_vehicle') server.leaveBoat(this)
        return
      case 'move_entity':
        // (before 1.20.71 the driver tells where its boat is so)
        if (this.riding && BigInt(params.runtime_entity_id) === this.riding.id) this.riding.pos = { ...params.position }
        return
      case 'mob_equipment':
        this.selectedSlot = params.selected_slot ?? params.slot ?? 0
    }
  }

  login (params) {
    const protocol = this.server.registry.version.version
    if (params.protocol_version !== protocol) {
      this.queue('play_status', { status: 'failed_client' })
      this.close(`this server plays protocol ${protocol}, the client ${params.protocol_version}`)
      return
    }
    this.username = displayNameOf(params.tokens ?? {})
    this.queue('play_status', { status: 'login_success' })
    this.stage = 'packs'
    this.queue('resource_packs_info', {
      must_accept: false,
      has_addons: false,
      has_scripts: false,
      force_server_packs: false,
      world_template: { uuid: '00000000-0000-0000-0000-000000000000', version: '0.0.0' },
      behaviour_packs: [],
      texture_packs: [],
      resource_pack_links: []
    })
    this.server.log(`${this.username} joined`)
  }

  startGame () {
    const { server, codec } = this
    this.stage = 'started'
    this.queue('start_game', buildStartGame({ registry: server.registry, codec, spawn: server.worlds.get(this.dimension).spawn, hashes: server.hashes, tick: server.tick, gamemode: this.gamemode, dimension: this.dimension }))
    if (codec.hasPacket('item_registry')) this.queue('item_registry', { itemstates: server.registry.writeItemStates() })
    this.queue(...abilitiesPacket(codec, { gamemode: this.gamemode, flying: this.flying }))
    this.queue(...inventoryPacket(this.hotbar))
    this.queue(...armorPacket(this.armor))
    this.queue('player_hotbar', { selected_slot: 0, window_id: 'inventory', select_slot: true })
    this.queue('set_time', { time: server.time })
    if (this.radius) this.chunks.recenter(this.feet)
  }

  // a column went: before 1.18 the player spawns once those around its chunk are out
  columnSent (x, z) {
    if (this.spawnSent || this.chunks.requestMode) return
    if (Math.abs(x - this.spawnChunk.x) <= 1 && Math.abs(z - this.spawnChunk.z) <= 1 && ++this.columnsAroundSpawn === 9) this.spawn()
  }

  // a section went: from 1.18 the player spawns once the first sections of its column are out
  sectionSent (x, y, z) {
    if (!this.spawnSent && x === this.spawnChunk.x && z === this.spawnChunk.z) this.spawn()
  }

  spawn () {
    this.spawnSent = true
    this.queue('play_status', { status: 'player_spawn' })
    for (const entity of this.server.entities.values()) if (entity.dimension === this.dimension) this.addEntity(entity)
  }

  // an entity (a boat) appears, or goes; a rider gets on it, or off (link type 1: the driver, 0: off)
  addEntity (entity) {
    const position = { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z }
    // (1.16.201 names the ids entity_id_self and runtime_entity_id, and has the position's coordinates as fields)
    this.queue('add_entity', { unique_id: entity.id, entity_id_self: entity.id, runtime_id: entity.id, runtime_entity_id: entity.id, entity_type: entity.type, position, ...position, velocity: { x: 0, y: 0, z: 0 }, pitch: 0, yaw: entity.yaw, head_yaw: entity.yaw, body_yaw: entity.yaw })
  }

  removeEntity (entity) {
    this.queue('remove_entity', { entity_id_self: entity.id })
  }

  link (entity, type) {
    this.queue('set_entity_link', { link: { ridden_entity_id: entity.id, rider_entity_id: PLAYER_ID, type, immediate: false, rider_initiated: true, angular_velocity: 0 } })
  }

  // an item into the hotbar: onto a stack of it there, else into a free slot; the slot, or -1 when it is full
  give (item) {
    const hotbar = this.hotbar
    let slot = hotbar.findIndex((held, i) => i < HOTBAR_SIZE && held?.name === item.name && held.count + item.count <= MAX_STACK)
    const count = slot >= 0 ? hotbar[slot].count + item.count : item.count
    if (slot < 0) slot = [...Array(HOTBAR_SIZE).keys()].find(i => !hotbar[i]) ?? -1
    if (slot >= 0) this.setHotbarSlot(slot, { ...item, count })
    return slot
  }

  input (params) {
    this.stats.inputs++
    this.lastInputTick = params.tick ?? this.lastInputTick
    const flags = params.input_data
    const has = flag => Array.isArray(flags) ? flags.includes(flag) : !!flags?.[flag]
    const eyes = params.position
    if (!eyes) return
    // driving a boat, the input reports the boat (its position and rotation): the rider sits in it
    const boat = this.riding && has('client_predicted_vehicle') ? this.riding : null
    if (boat) {
      boat.pos = { x: eyes.x, y: eyes.y, z: eyes.z }
      boat.yaw = params.vehicle_rotation?.z ?? boat.yaw
    }
    const feet = boat ? { x: eyes.x, y: eyes.y + SEAT_EYES - EYE_HEIGHT, z: eyes.z } : { x: eyes.x, y: eyes.y - EYE_HEIGHT, z: eyes.z }
    if (this.teleportTarget) {
      const t = this.teleportTarget
      if (Math.abs(feet.x - t.x) > 2 || Math.abs(feet.y - t.y) > 2 || Math.abs(feet.z - t.z) > 2) return
      this.teleportTarget = null
    }
    this.feet = feet
    this.yaw = params.yaw ?? this.yaw
    this.pitch = params.pitch ?? this.pitch
    if (has('start_flying')) this.flying = true
    // (a use while sneaking places against a gate rather than opening it)
    this.sneaking = has('sneaking') || has('sneak_down')
    if (has('stop_flying')) this.flying = false
    this.chunks.recenter(feet)
    // fallen out of the world: back to where the dimension starts
    if (feet.y < this.server.minYOf(this.dimension) - 32) {
      this.teleport(this.server.worlds.get(this.dimension).spawn)
      this.say('fell out of the world: back to the start')
      return
    }
    this.enterPortal(feet)
  }

  // a portal the player stands in (at its feet or its head): a nether portal takes it after a while, an end portal at
  // once
  enterPortal (feet) {
    const { server } = this
    const at = { x: Math.floor(feet.x), y: Math.floor(feet.y), z: Math.floor(feet.z) }
    const names = [server.blockName(at, this.dimension), server.blockName({ ...at, y: at.y + 1 }, this.dimension)]
    const kind = names.includes('end_portal') ? 'end_portal' : names.includes('portal') ? 'portal' : null
    if (!kind) {
      this.portal = { armed: true, ticks: 0 }
      return
    }
    if (!this.portal.armed) return
    if (kind === 'portal' && ++this.portal.ticks < (PORTAL_TICKS[this.gamemode] ?? PORTAL_TICKS.survival)) return
    const to = portalDestination(server, this.dimension, feet, kind)
    if (!to) {
      this.portal.armed = false
      this.say(`this world has no ${kind === 'end_portal' ? 'end' : 'nether'} to go to`)
      return
    }
    this.changeDimension(to.dimension, to.feet)
  }

  // takes the player to another dimension (its feet there): the client shows its loading screen, asks for the columns
  // around, and plays on once play_status player_spawn says they are out
  changeDimension (dimension, feet) {
    this.server.leaveBoat(this)
    this.dimension = dimension
    this.portal = { armed: false, ticks: 0 }
    this.feet = { x: feet.x, y: feet.y, z: feet.z }
    this.teleportTarget = this.feet
    this.spawnChunk = { x: Math.floor(feet.x) >> 4, z: Math.floor(feet.z) >> 4 }
    this.spawnSent = false
    this.columnsAroundSpawn = 0
    // (the position is the feet, where move_player has the eyes)
    this.queue('change_dimension', { dimension, position: this.feet, respawn: false })
    this.chunks.reset()
    this.chunks.recenter(this.feet)
    this.server.log(`${this.username} went to the ${DIMENSIONS[dimension]}`)
  }

  // moves the player (its feet) where it cannot walk to
  teleport (to) {
    const feet = { x: to.x, y: to.y, z: to.z }
    this.teleportTarget = feet
    this.feet = feet
    this.queue('move_player', {
      runtime_id: PLAYER_ID,
      position: { x: feet.x, y: feet.y + EYE_HEIGHT, z: feet.z },
      pitch: to.pitch ?? this.pitch,
      yaw: to.yaw ?? this.yaw,
      head_yaw: to.yaw ?? this.yaw,
      mode: 'teleport',
      on_ground: false,
      ridden_runtime_id: 0,
      teleport: { cause: 'command', source_entity_type: 0 },
      tick: this.lastInputTick
    })
    this.chunks.recenter(feet)
  }

  setGamemode (gamemode) {
    this.gamemode = gamemode
    if (gamemode !== 'creative') this.flying = false
    this.queue('set_player_game_type', { gamemode })
    this.queue(...abilitiesPacket(this.codec, { gamemode, flying: this.flying }))
  }

  // a hotbar slot (0 to 8) or an armour slot (0 to 3) holds an item now (null: nothing)
  setHotbarSlot (slot, item) {
    this.hotbar[slot] = item ?? undefined
    this.queue(...slotPacket('inventory', slot, item))
  }

  setArmorSlot (slot, item) {
    this.armor[slot] = item ?? null
    this.queue(...slotPacket('armor', slot, item))
  }

  // a block broken, placed or used (an item use on it; the transaction of 1.16.201 is its own container), or the held
  // item used in the air
  transaction (transaction) {
    const data = transaction?.transaction_data ?? {}
    if (transaction?.transaction_type === 'item_use_on_entity') {
      if (data.action_type === 'interact') this.server.rideBoat(this, data.entity_runtime_id)
      else if (data.action_type === 'attack') this.server.breakBoat(this, data.entity_runtime_id)
      return
    }
    if (transaction?.transaction_type !== 'item_use') return
    if (data.action_type === 'click_air') return this.server.useItem(this, data.hotbar_slot ?? this.selectedSlot)
    const pos = data.block_position
    if (!pos) return
    if (data.action_type === 'break_block') this.server.breakBlock(this, pos)
    else if (data.action_type === 'click_block' && !this.server.useBlock(this, pos) && !this.server.placeBoat(this, pos, data.hotbar_slot ?? this.selectedSlot)) this.server.placeBlock(this, pos, data.face, data.hotbar_slot ?? this.selectedSlot, data.held_item)
  }
}

module.exports = { Connection, displayNameOf, EYE_HEIGHT }
