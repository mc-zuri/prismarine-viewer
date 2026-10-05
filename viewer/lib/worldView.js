const { spiral, ViewRect, chunkPos } = require('./simpleUtils')
const { Vec3 } = require('vec3')
const EventEmitter = require('events')
const { trackBedrock } = require('./bedrockTracker')

// Skin and cape texture URLs of a player entity (textures.minecraft.net on
// online-mode servers); nothing for other entities or players without skin data
function playerSkin (bot, e) {
  const skinData = e.username !== undefined && bot.players[e.username]?.skinData
  if (!skinData) return { skinModel: defaultSkinModel(e.uuid) }
  return { skin: skinData.url, skinModel: skinData.model, cape: skinData.capeUrl }
}

// Vanilla's DefaultPlayerSkin: a player without skin data is Alex when the Java hashCode of
// their UUID is odd, which is the xor of the lowest bit of each 32-bit quarter.
function defaultSkinModel (uuid) {
  if (typeof uuid !== 'string') return undefined
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32) return undefined
  const odd = [7, 15, 23, 31].reduce((acc, i) => acc ^ parseInt(hex[i], 16), 0) & 1
  return odd ? 'slim' : undefined
}

// A dropped item's stack lives in the entity's metadata, keyed by the raw metadata index.
function droppedItemName (registry, entity) {
  if (entity.name !== 'item' || !entity.metadata) return undefined
  const keys = registry.entitiesByName?.item?.metadataKeys
  const slots = keys ? [entity.metadata[keys.indexOf('item')]] : Object.values(entity.metadata)
  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') continue
    if (slot.present === false || slot.itemCount === 0) continue
    const id = slot.itemId ?? slot.blockId
    if (id === undefined || id < 0) continue
    return registry.items[id]?.name
  }
}

// NBT as socket.io and the worker can carry it: longs as strings
function plainNbt (tag) {
  return tag && JSON.parse(JSON.stringify(tag, (key, value) => typeof value === 'bigint' ? value.toString() : value))
}

// Bedrock: an entity's data as socket.io can carry it, longs (the entity ids of its owner, its target) as numbers
function plainMetadata (metadata) {
  return metadata && JSON.parse(JSON.stringify(metadata, (key, value) => typeof value === 'bigint' ? Number(value) : value))
}

// Bedrock: what an entity's model is drawn by beyond what a Java one is: its entity data (flags, variant, colour...),
// its head's turn, what it wears and holds, its health, its stack when it is a dropped item (whose aux value picks
// its icon)
function bedrockEntity (e) {
  const entity = { metadata: plainMetadata(e.metadata), headYaw: e.headYaw, onGround: e.onGround, equipment: bedrockEquipment(e), ...bedrockHealth(e) }
  if (e.name === 'item' && e.item) Object.assign(entity, { itemName: e.item.name, itemAux: e.item.metadata })
  return entity
}

// Bedrock: whether an entity is in water or lava, which the game works out itself from the block at its feet (either
// layer: water in kelp, a waterlogged slab). Fish swim in water and flop out of it.
const WATER = /^(flowing_)?water$/
const LAVA = /^(flowing_)?lava$/
function bedrockLiquid (bot, e) {
  const pos = e.position
  const column = pos && bot.world?.sync?.getColumnAt?.(pos)
  if (!column?.getBlock) return {}
  const at = { x: Math.floor(pos.x) & 15, y: Math.floor(pos.y), z: Math.floor(pos.z) & 15 }
  const names = [0, 1].map(l => {
    try { return column.getBlock({ ...at, l }, false)?.name ?? '' } catch { return '' }
  })
  return { inWater: names.some(name => WATER.test(name)), inLava: names.some(name => LAVA.test(name)) }
}

// Bedrock: an entity's health, when the server said it (an iron golem's cracks show it)
function bedrockHealth (e) {
  const health = e.attributes?.['minecraft:health']
  return health ? { health: health.value, maxHealth: health.max } : {}
}

// Bedrock: what an entity wears and holds, by item name (mineflayer keeps them as Bedrock sends them: held, then head
// to feet)
function bedrockEquipment (e) {
  const [mainhand, head, chest, legs, feet] = (e.equipment ?? []).map(item => item?.name)
  return { mainhand, head, chest, legs, feet }
}

// Bedrock: what entities do that their models show, which mineflayer has no event for (or one for several), by the
// protocol's names: entity_event (hurt_animation, death_animation, arm_swing, eat_grass_animation, ...), animate
// (swing_arm), and animate_entity (an animation the server plays)
function bedrockEntityEvents (bot, emit) {
  const idOf = runtimeId => {
    const id = Number(runtimeId)
    return bot.entities[id] && bot.entities[id] !== bot.entity ? id : null
  }
  return {
    entity_event: packet => {
      const id = idOf(packet.runtime_entity_id)
      if (id !== null) emit({ id, event: packet.event_id, data: packet.data })
    },
    animate: packet => {
      const id = idOf(packet.runtime_entity_id)
      if (id !== null) emit({ id, event: packet.action_id })
    },
    animate_entity: packet => {
      const animation = { animation: packet.animation, nextState: packet.next_state, stopCondition: packet.stop_condition, controller: packet.controller, blendOutTime: packet.blend_out_time }
      for (const runtimeId of packet.runtime_entity_ids ?? []) {
        const id = idOf(runtimeId)
        if (id !== null) emit({ id, animation })
      }
    }
  }
}

// Bedrock: the Molang variables a spawn_particle_effect gives its effect (a JSON list of { name, value: { type,
// value } }, a struct's members in a member_array), by name without variable.; nothing it cannot read
function molangVariables (json) {
  const variables = {}
  const add = (name, value) => {
    if (value?.type === 'member_array' && Array.isArray(value.value)) {
      for (const member of value.value) add(name + '.' + String(member.name).replace(/^\./, ''), member.value)
    } else if (typeof value?.value === 'number') variables[name] = value.value
    else if (typeof value === 'number') variables[name] = value
  }
  try {
    for (const entry of JSON.parse(json)) add(String(entry.name).toLowerCase().replace(/^(variable|v)\./, ''), entry.value)
  } catch {}
  return variables
}

// Bedrock: the particle effects the server spawns (spawn_particle_effect), by their identifiers, at a position; one
// on an entity is relative to where it is
function bedrockParticles (bot, tracker, emit) {
  return {
    spawn_particle_effect: packet => {
      const at = packet.position
      if (!packet.particle_name || !at) return
      const pos = { x: at.x, y: at.y, z: at.z }
      const unique = packet.entity_id === undefined ? -1 : Number(packet.entity_id)
      if (unique !== -1) {
        const entity = bot.entities[tracker?.uniqueToRuntime.get(String(packet.entity_id))]
        if (entity?.position) {
          pos.x += entity.position.x
          pos.y += entity.position.y
          pos.z += entity.position.z
        }
      }
      const particle = { name: packet.particle_name, pos }
      if (packet.molang_variables) particle.variables = molangVariables(packet.molang_variables)
      emit(particle)
    }
  }
}

const signedCoordinate = value => value > 0x7fffffff ? value - 0x100000000 : value

// Bedrock: the changes to the liquid layer of blocks (the water of waterlogged blocks), which mineflayer writes to its
// columns without a blockUpdate event. id: a block network id, of the server's ids
function bedrockLiquidUpdates (bot, emit) {
  const update = (position, id, layer) => {
    if (!position || layer !== 1) return
    const block = bot.registry.blocksByRuntimeId?.[id]
    if (!block) return
    emit({ pos: { x: position.x, y: signedCoordinate(position.y), z: position.z }, stateId: block.stateId, layer })
  }
  return {
    update_block: packet => update(packet.position ?? packet.coordinates, packet.block_runtime_id, packet.layer ?? packet.storage ?? 0),
    update_block_synced: packet => update(packet.position, packet.block_runtime_id, packet.layer ?? 0),
    update_subchunk_blocks: packet => {
      for (const extra of packet.extra ?? []) update(extra.position, extra.runtime_id, 1)
    }
  }
}

class WorldView extends EventEmitter {
  constructor (world, viewDistance, position = new Vec3(0, 0, 0), emitter = null) {
    super()
    this.world = world
    this.viewDistance = viewDistance
    this.loadedChunks = {}
    // loadChunk awaits the world, so a load can finish after its column was unloaded or the world
    // was replaced. Each load records a token under its column key and the world generation it read
    // from; it only emits if both are still current once the column arrives.
    this.pendingLoads = {}
    this.nextLoadToken = 0
    this.worldGeneration = 0
    this.lastPos = new Vec3(0, 0, 0).update(position)
    this.emitter = emitter || this

    this.listeners = {}
    this.emitter.on('mouseClick', async (click) => {
      const ori = new Vec3(click.origin.x, click.origin.y, click.origin.z)
      const dir = new Vec3(click.direction.x, click.direction.y, click.direction.z)
      // (a prismarine-world async world raycasts in a promise)
      const block = await this.world.raycast(ori, dir, 256)
      if (!block) return
      this.emit('blockClicked', block, block.face, click.button)
    })
  }

  listenToBot (bot) {
    const worldView = this
    const bedrock = bot.registry?.type === 'bedrock'
    // Bedrock: the entity properties and the players' skins, which mineflayer does not keep
    const tracker = bedrock ? trackBedrock(bot) : null
    const sentSkins = new Set()
    const properties = e => {
      const known = tracker?.properties.get(e.id)
      return known ? { properties: known } : {}
    }
    // a player's skin: the whole of it the first time this view sends it, its key after
    const skin = e => {
      const encoded = e.type === 'player' && e.uuid && tracker?.skins.get(e.uuid)
      if (!encoded) return {}
      if (sentSkins.has(encoded.key)) return { bedrockSkin: { key: encoded.key, armSize: encoded.armSize } }
      sentSkins.add(encoded.key)
      return { bedrockSkin: encoded }
    }
    // an entity as it spawns, or as it is when the view starts
    const spawned = e => {
      const entity = { id: e.id, name: e.name, pos: e.position, width: e.width, height: e.height, username: e.username, riding: !!e.vehicle, itemName: droppedItemName(bot.registry, e), ...playerSkin(bot, e) }
      return bedrock ? { ...entity, yaw: e.yaw, pitch: e.pitch, ...bedrockEntity(e), ...bedrockLiquid(bot, e), ...properties(e), ...skin(e) } : entity
    }
    this.listeners[bot.username] = {
      // 'move': botPosition,
      entitySpawn: function (e) {
        if (e === bot.entity) return
        worldView.emitter.emit('entity', spawned(e))
      },
      entityUpdate: function (e) {
        if (bedrock) {
          if (e !== bot.entity) worldView.emitter.emit('entity', { id: e.id, pos: e.position, ...bedrockEntity(e), ...bedrockLiquid(bot, e), ...properties(e) })
          return
        }
        const itemName = droppedItemName(bot.registry, e)
        if (itemName !== undefined) worldView.emitter.emit('entity', { id: e.id, pos: e.position, itemName })
      },
      entityMoved: function (e) {
        if (bedrock) {
          // (a Bedrock bot's own moves are entityMoved events too)
          if (e !== bot.entity) worldView.emitter.emit('entity', { id: e.id, pos: e.position, pitch: e.pitch, yaw: e.yaw, headYaw: e.headYaw, onGround: e.onGround, ...bedrockLiquid(bot, e) })
          return
        }
        worldView.emitter.emit('entity', { id: e.id, pos: e.position, pitch: e.pitch, yaw: e.yaw })
      },
      entityAttach: function (e) {
        worldView.emitter.emit('entity', { id: e.id, riding: true })
      },
      entityDetach: function (e) {
        worldView.emitter.emit('entity', { id: e.id, riding: false })
      },
      entityHurt: function (e) {
        worldView.emitter.emit('entity', { id: e.id, hurt: true })
      },
      entityGone: function (e) {
        worldView.emitter.emit('entity', { id: e.id, delete: true })
      },
      chunkColumnLoad: function (pos) {
        worldView.loadChunk(pos)
      },
      chunkColumnUnload: function (pos) {
        worldView.unloadChunk(pos)
      },
      // A dimension change or server transfer unloads every column (each arrives above as a
      // chunkColumnUnload) and may replace bot.world with a fresh object; follow it so chunks that
      // load afterwards are read from the world the bot is now in, not the one it left.
      login: function () {
        worldView.setWorld(bot.world)
      },
      // Bedrock bots swap bot.world on a dimension change without a login
      game: function () {
        if (bot.world !== worldView.world) worldView.setWorld(bot.world)
      },
      blockUpdate: function (oldBlock, newBlock) {
        // (state 0 is a block like any other: a Bedrock world's first state is cyan terracotta)
        const stateId = newBlock.stateId ?? ((newBlock.type << 4) | newBlock.metadata)
        worldView.emitter.emit('blockUpdate', { pos: oldBlock.position, stateId })
      }
    }
    if (bedrock) {
      const listeners = this.listeners[bot.username]
      const emitEntity = entity => worldView.emitter.emit('entity', entity)
      // block entities draw some Bedrock blocks: a bed's colour is its block entity's
      listeners.blockEntityData = function (block) {
        if (!block?.position) return
        const tag = bot.blockEntityAt?.(block.position) ?? block.blockEntity
        worldView.emitter.emit('blockEntity', { pos: block.position, tag: plainNbt(tag) })
      }
      // what a Bedrock model is drawn by besides: what it rides, what it wears and holds, its health
      listeners.entityAttach = function (e, vehicle) {
        emitEntity({ id: e.id, riding: true, vehicle: vehicle?.name ?? null })
      }
      listeners.entityDetach = function (e) {
        emitEntity({ id: e.id, riding: false, vehicle: null })
      }
      listeners.entityEquip = function (e) {
        if (e !== bot.entity) emitEntity({ id: e.id, equipment: bedrockEquipment(e) })
      }
      listeners.entityAttributes = function (e) {
        if (e !== bot.entity) emitEntity({ id: e.id, ...bedrockHealth(e) })
      }
    }
    // a player's skin told after its entity (player_skin, or a player_list after add_player)
    if (tracker) {
      const onSkin = uuid => {
        for (const e of Object.values(bot.entities)) {
          if (e !== bot.entity && e.uuid === uuid) worldView.emitter.emit('entity', { id: e.id, ...skin(e) })
        }
      }
      tracker.on('skin', onSkin)
      this.trackerListeners = { ...this.trackerListeners, [bot.username]: () => tracker.removeListener('skin', onSkin) }
    }

    for (const [evt, listener] of Object.entries(this.listeners[bot.username])) {
      bot.on(evt, listener)
    }
    this.packetListeners = this.packetListeners ?? {}
    if (bedrock && bot._client) {
      this.packetListeners[bot.username] = {
        ...bedrockLiquidUpdates(bot, update => worldView.emitter.emit('blockUpdate', update)),
        ...bedrockEntityEvents(bot, entity => worldView.emitter.emit('entity', entity)),
        ...bedrockParticles(bot, tracker, particle => worldView.emitter.emit('particle', particle))
      }
      for (const [name, listener] of Object.entries(this.packetListeners[bot.username])) {
        bot._client.on(name, listener)
      }
    }

    for (const id in bot.entities) {
      const e = bot.entities[id]
      if (e && e !== bot.entity) {
        this.emitter.emit('entity', spawned(e))
      }
    }
  }

  removeListenersFromBot (bot) {
    for (const [evt, listener] of Object.entries(this.listeners[bot.username])) {
      bot.removeListener(evt, listener)
    }
    delete this.listeners[bot.username]
    for (const [name, listener] of Object.entries(this.packetListeners?.[bot.username] ?? {})) {
      bot._client.removeListener(name, listener)
    }
    delete this.packetListeners?.[bot.username]
    this.trackerListeners?.[bot.username]?.()
    delete this.trackerListeners?.[bot.username]
  }

  async init (pos) {
    const [botX, botZ] = chunkPos(pos)

    const positions = []
    spiral(this.viewDistance * 2, this.viewDistance * 2, (x, z) => {
      const p = new Vec3((botX + x) * 16, 0, (botZ + z) * 16)
      positions.push(p)
    })

    this.lastPos.update(pos)
    await this._loadChunks(positions)
  }

  async _loadChunks (positions, sliceSize = 5, waitTime = 0) {
    for (let i = 0; i < positions.length; i += sliceSize) {
      await new Promise((resolve) => setTimeout(resolve, waitTime))
      await Promise.all(positions.slice(i, i + sliceSize).map(p => this.loadChunk(p)))
    }
  }

  setWorld (world) {
    this.world = world
    this.worldGeneration++
  }

  async loadChunk (pos) {
    const [botX, botZ] = chunkPos(this.lastPos)
    const dx = Math.abs(botX - Math.floor(pos.x / 16))
    const dz = Math.abs(botZ - Math.floor(pos.z / 16))
    if (dx < this.viewDistance && dz < this.viewDistance) {
      const key = `${pos.x},${pos.z}`
      const token = ++this.nextLoadToken
      const generation = this.worldGeneration
      this.pendingLoads[key] = token
      const column = await this.world.getColumnAt(pos)
      if (this.pendingLoads[key] !== token || this.worldGeneration !== generation) return
      delete this.pendingLoads[key]
      if (column) {
        const chunk = column.toJson()
        this.emitter.emit('loadChunk', { x: pos.x, z: pos.z, chunk })
        this.loadedChunks[key] = true
      }
    }
  }

  unloadChunk (pos) {
    this.emitter.emit('unloadChunk', { x: pos.x, z: pos.z })
    delete this.loadedChunks[`${pos.x},${pos.z}`]
    delete this.pendingLoads[`${pos.x},${pos.z}`]
  }

  async updatePosition (pos, force = false) {
    const [lastX, lastZ] = chunkPos(this.lastPos)
    const [botX, botZ] = chunkPos(pos)
    if (lastX !== botX || lastZ !== botZ || force) {
      const newView = new ViewRect(botX, botZ, this.viewDistance)
      for (const coords of Object.keys(this.loadedChunks)) {
        const x = parseInt(coords.split(',')[0])
        const z = parseInt(coords.split(',')[1])
        const p = new Vec3(x, 0, z)
        if (!newView.contains(Math.floor(x / 16), Math.floor(z / 16))) {
          this.unloadChunk(p)
        }
      }
      const positions = []
      spiral(this.viewDistance * 2, this.viewDistance * 2, (x, z) => {
        const p = new Vec3((botX + x) * 16, 0, (botZ + z) * 16)
        if (!this.loadedChunks[`${p.x},${p.z}`]) {
          positions.push(p)
        }
      })
      this.lastPos.update(pos)
      await this._loadChunks(positions)
    } else {
      this.lastPos.update(pos)
    }
  }
}

module.exports = { WorldView }
