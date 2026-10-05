// A Bedrock client over a MessagePort: it joins as the game's client does (with no RakNet, encryption or Xbox sign-in:
// its login is unsigned), reads the world it is sent, moves the player with prismarine-physics' Bedrock engine and tells
// the server, and breaks and places blocks. It draws nothing: what changes is told as events, which the gameplay page
// passes to the viewer; and it reads nothing of a page, so the Node check runs it too.
//
//   events   status (stage, text)   startGame (packet, { blockHashes })   column (prismarine-chunk column)
//            unloadColumn (x, z)    blockUpdate (pos, stateId, layer)       hotbar (slots, selected)
//            dimension (0 overworld, 1 nether, 2 end: change_dimension, the columns of the one before unloaded)
//            message (text)         step (tick)                             problem (text)   close (reason)
//
// Packets are handled in the order they arrive: one whose handling waits (a column being read) holds back the next.
const { EventEmitter } = require('events')
const { createCodec } = require('../protocol/codec')
const { PacketChannel } = require('../protocol/channel')
const { ChunkStore } = require('./chunks')
const { BlobStore } = require('./blobs')
const { Movement } = require('./movement')
const { Interaction } = require('./interaction')
const { fieldType, mapperValues } = require('../protocol/schema')

const DIMENSIONS = ['overworld', 'nether', 'end']
// a dimension as a packet names it: its number, or from 1.19.80 its name
const dimensionOf = value => typeof value === 'number' ? value : Math.max(0, DIMENSIONS.indexOf(value === 'the_end' ? 'end' : value))

// A JWT signed by nobody: the server reads it as it is
function unsignedJwt (payload) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(payload)}.`
}

const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (Math.random() * 16) >> (c / 4)).toString(16))

class Client extends EventEmitter {
  // port: one end of a MessageChannel, the server the other; version: '1.26.51'; cache: the blob cache on; blobStore:
  // the page's, kept from one join to the next; viewDistance: chunks; verify: read back what is written
  constructor ({ port, version, username = 'player', cache = false, viewDistance = 6, blobStore = new BlobStore(), verify = false, now = Date.now }) {
    super()
    this.version = version
    this.username = username
    this.cache = cache
    this.viewDistance = viewDistance
    this.blobStore = blobStore
    this.registry = require('prismarine-registry')('bedrock_' + version)
    this.codec = createCodec(version, { verify })
    this.channel = new PacketChannel(port, this.codec)
    this.chunks = new ChunkStore(this)
    this.interaction = new Interaction(this)
    this.controls = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false }
    this.look = { yaw: 0, pitch: 0 }
    this.gamemode = 'survival'
    this.dimension = 0
    this.time = 0
    this.stage = 'login'
    this.now = now
    this.stats = { columns: 0, sections: 0, blobs: { hits: 0, misses: 0, received: 0, pending: 0 }, unknownRuntimeIds: {}, teleports: 0, corrections: 0, problems: 0 }
    this.chain = Promise.resolve()
    this.channel.on('packet', (name, params) => {
      this.chain = this.chain.then(() => this.handle(name, params)).catch(err => this.problem(`${name}: ${err.stack ?? err}`))
    })
    this.channel.on('decodeError', (err, packet) => this.problem(`unreadable packet ${packet[0]}: ${err.message}`))
    this.channel.on('close', reason => {
      this.stage = 'closed'
      this.blobStore.forgetPending()
      this.emit('close', reason)
    })
    this.setStage('login', 'logging in')
    // from 1.19.30 the client asks for the network settings before it logs in
    if (this.codec.hasPacket('request_network_settings')) this.queue('request_network_settings', { client_protocol: this.registry.version.version })
    else this.login()
  }

  queue (name, params) {
    try {
      this.channel.queue(name, params)
    } catch (err) {
      this.problem(`${name} not written: ${err.message}`)
    }
  }

  problem (text) {
    this.stats.problems++
    this.emit('problem', text)
  }

  setStage (stage, text) {
    this.stage = stage
    this.emit('status', stage, text)
  }

  login () {
    const identity = uuid()
    const chain = [unsignedJwt({ extraData: { displayName: this.username, identity, XUID: '' }, identityPublicKey: '' })]
    this.queue('login', {
      protocol_version: this.registry.version.version,
      tokens: {
        identity: JSON.stringify({ chain }),
        client: unsignedJwt({ DeviceOS: 7, GameVersion: this.version, ThirdPartyName: this.username, SkinId: 'Standard_Steve' })
      }
    })
  }

  // the player: the engine's (feet, velocity, look), once start_game has come
  get player () {
    return this.movement?.player
  }

  get runtimeId () {
    return this.startGame?.runtime_entity_id ?? 1n
  }

  async handle (name, params) {
    if (this.stage === 'closed') return
    switch (name) {
      case 'network_settings':
        return this.login()
      case 'play_status':
        return this.playStatus(params.status)
      case 'resource_packs_info':
        this.queue('resource_pack_client_response', { response_status: 'have_all_packs', resourcepackids: [] })
        return
      case 'resource_pack_stack':
        this.queue('resource_pack_client_response', { response_status: 'completed', resourcepackids: [] })
        return
      case 'start_game':
        return this.start(params)
      case 'item_registry':
        this.registry.handleItemRegistry(params)
        return
      case 'update_abilities':
        return this.abilities(params)
      case 'adventure_settings':
        this.movement?.setAbilities({ mayFly: !!params.flags?.allow_flight, flying: !!params.flags?.flying })
        return
      case 'set_player_game_type':
        this.gamemode = params.gamemode
        this.movement?.handle(name, params)
        return
      case 'inventory_content':
        if (this.isInventory(params)) this.interaction.setSlots(params.input ?? [])
        return
      case 'inventory_slot':
        if (this.isInventory(params)) this.interaction.setSlots([params.item], params.slot)
        return
      case 'player_hotbar':
        if (params.select_slot) this.interaction.selectSlot(params.selected_slot, false)
        return
      case 'chunk_radius_update':
        this.viewDistance = params.chunk_radius
        return
      case 'network_chunk_publisher_update': {
        const center = { x: Math.floor(params.coordinates.x) >> 4, z: Math.floor(params.coordinates.z) >> 4 }
        this.chunks.keepAround(center, Math.ceil(params.radius / 16) + 1)
        return
      }
      case 'level_chunk':
        await this.chunks.levelChunk(params)
        return this.loadingProgress()
      case 'subchunk':
        await this.chunks.subChunk(params)
        return this.loadingProgress()
      case 'client_cache_miss_response':
        return this.chunks.missResponse(params)
      case 'update_block': {
        const pos = params.position ?? params.coordinates
        this.interaction.confirm(pos)
        this.chunks.setBlock(pos, params.block_runtime_id, params.layer ?? params.storage ?? 0)
        return
      }
      case 'move_player':
        if (this.movement?.handle(name, params)) this.stats.teleports++
        return
      case 'correct_player_move_prediction':
        if (this.movement?.handle(name, params)) this.stats.corrections++
        return
      case 'set_time':
        this.time = params.time
        return
      case 'text':
        this.emit('message', params.source_name ? `<${params.source_name}> ${params.message}` : params.message ?? '')
        return
      case 'change_dimension':
        return this.changeDimension(params)
      case 'disconnect':
        this.close(params.message ?? 'disconnected')
    }
  }

  isInventory (params) {
    const window = params.window_id ?? params.inventory_id
    return window === 'inventory' || window === 0
  }

  playStatus (status) {
    if (status === 'login_success') {
      this.queue('client_cache_status', { enabled: this.cache })
      this.setStage('joining', 'joining')
    } else if (status === 'player_spawn' && this.changingDimension) {
      // the dimension's columns around are out: the player moves again
      this.changingDimension = false
      // (after the change itself, which the engine takes on its next tick too)
      this.movement.session.schedule(() => this.movement.session.dimensionLoaded())
      const action = mapperValues(this.codec.types, fieldType(this.codec.types, 'packet_player_action', 'action')).find(name => /^dimension_change_(ack|done)/.test(name))
      if (action) this.queue('player_action', { runtime_entity_id: this.runtimeId, action, position: { x: 0, y: 0, z: 0 }, result_position: { x: 0, y: 0, z: 0 }, face: 0 })
      this.setStage('playing', 'playing')
    } else if (status === 'player_spawn') {
      // the game's client says its loading screen is over (from 1.21.20), then that the player is in
      if (this.codec.hasPacket('serverbound_loading_screen')) {
        this.queue('serverbound_loading_screen', { type: 1 })
        this.queue('serverbound_loading_screen', { type: 2 })
      }
      this.queue('set_local_player_as_initialized', { runtime_entity_id: this.runtimeId })
      this.movement.active = true
      this.setStage('playing', 'playing')
    } else {
      this.close(`the server refused the join: ${status}`)
    }
  }

  start (packet) {
    this.startGame = packet
    this.dimension = dimensionOf(packet.dimension)
    // (the registry's state ids become hashes where start_game says the server's are)
    this.registry.handleStartGame(packet)
    this.Chunk = require('prismarine-chunk')(this.registry)
    this.Block = require('prismarine-block')(this.registry)
    this.gamemode = packet.player_gamemode === 'fallback' ? packet.world_gamemode : packet.player_gamemode
    this.movement = new Movement(this, { now: this.now })
    this.movement.start(packet)
    const blockHashes = this.registry.supportFeature('blockHashes') && !!packet.block_network_ids_are_hashes
    this.emit('startGame', packet, { blockHashes })
    this.setStage('chunks', 'loading the world')
    this.queue('request_chunk_radius', { chunk_radius: this.viewDistance, max_radius: this.viewDistance })
  }

  // another dimension: what the client had of the one before goes, the player waits where it arrives (the engine holds
  // it still) until play_status player_spawn says the columns around are out
  changeDimension (packet) {
    this.dimension = dimensionOf(packet.dimension)
    this.chunks.clear()
    this.movement?.handle('change_dimension', packet)
    this.changingDimension = true
    this.emit('dimension', this.dimension)
    this.setStage('chunks', `going to the ${DIMENSIONS[this.dimension]}`)
  }

  abilities (packet) {
    const base = packet.abilities?.find(layer => layer.type === 'base') ?? packet.abilities?.[0]
    if (!base) return
    this.movement?.setAbilities({ mayFly: !!base.enabled?.may_fly, flying: !!base.enabled?.flying, flySpeed: base.fly_speed, verticalFlySpeed: base.vertical_fly_speed })
  }

  loadingProgress () {
    if (this.stage === 'chunks') this.emit('status', 'chunks', `loading the world: ${this.stats.columns} columns`)
  }

  // ---- what the page does --------------------------------------------------------------------------------------

  // a key of movement: forward, back, left, right, jump, sneak, sprint
  setControl (name, held) {
    if (name in this.controls) this.controls[name] = !!held
  }

  // the look, in mineflayer's radians (yaw 0 faces north, turning west; pitch up)
  setLook (yaw, pitch) {
    this.look = { yaw, pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)) }
  }

  // steps the player through the ticks due (a page calls it every 50 ms; the check whenever it likes)
  tick () {
    return this.movement?.tick() ?? 0
  }

  chat (text) {
    const line = String(text).trim()
    if (!line) return
    if (line.startsWith('/')) {
      this.queue('command_request', { command: line, origin: { type: 'player', uuid: '00000000-0000-0000-0000-000000000000', request_id: '', player_entity_id: 0n }, internal: false, version: 0 })
    } else {
      this.queue('text', { type: 'chat', needs_translation: false, source_name: this.username, message: line, xuid: '', platform_chat_id: '' })
    }
  }

  selectSlot (slot) {
    this.interaction.selectSlot(slot)
  }

  target (eye, dir, reach) {
    return this.movement ? this.interaction.target(eye, dir, reach) : null
  }

  breakBlock (target) {
    return this.interaction.breakBlock(target)
  }

  placeBlock (target) {
    return this.interaction.placeBlock(target)
  }

  close (reason = 'left') {
    if (this.stage === 'closed') return
    this.channel.close(reason)
  }
}

function createClient (options) {
  return new Client(options)
}

module.exports = { createClient, Client }
