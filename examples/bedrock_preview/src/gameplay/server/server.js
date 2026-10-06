// A Bedrock server of one version, with no network of its own: a connection is a MessagePort (accept), over which the
// server and the client exchange the game's packets as bedrock-protocol writes them. It sends a world source's columns
// (showcase.js showcaseWorld: { spawn, column(cx, cz) }) with hashed block ids or sequential ones, with the blob cache
// where the client asks for it, and keeps what players change in it. A recorded world has a source a dimension
// (overworld, nether, end): each player is in one, and its portals take it from one to another (portals.js).
//
// Run in a Web Worker by the gameplay page (gameplayServer.js), and in Node by the check (gameplayCheck.js). minecraft-data
// of the version must be loaded (viewer/lib/mcData.js preload) before createServer.
const { Vec3 } = require('vec3')
const { compile } = require('../protocol/codec')
const { fieldType, hashKey, mapperValues } = require('../protocol/schema')
const { showcaseWorld, statesOf } = require('../../showcase')
const { recordedWorld, DIMENSIONS } = require('./recordedWorld')
const { Connection, EYE_HEIGHT } = require('./connection')
const { hotbarOf } = require('./startGame')
const { runCommand } = require('./commands')
const { gateToggle } = require('../gates')

const TICK_MS = 50
// the blocks a placed block takes the place of
const REPLACEABLE = new Set(['air', 'water', 'flowing_water', 'lava', 'flowing_lava', 'short_grass', 'tallgrass', 'fern', 'deadbush', 'snow_layer', 'vine', 'seagrass'])
// how far from its eyes a player reaches a block (creative)
const REACH = 8

// The server. version: '1.26.51'; hashes: name block states by their hashes (from 1.19.80); world: a recorded world
// ({ meta, bin, dimension }: worldImport.js's files, the second unzipped, and the dimension to play: overworld, nether
// or end), else the showcase; maxRadius: the most chunks a client may see; budget: the columns a connection is sent a
// tick; verify: read back what is written; log: where its lines go
function createServer ({ version, hashes = false, world: recorded, maxRadius = 8, budget = 8, verify = false, log = () => {} }) {
  const registry = require('prismarine-registry')('bedrock_' + version)
  const useHashes = !!hashes && registry.supportFeature('blockHashes')
  // (the state ids the world is built with are those start_game will say: hashes, or the indexes)
  registry.handleStartGame({ block_network_ids_are_hashes: useHashes })
  const Chunk = require('prismarine-chunk')(registry)
  const { types } = compile(version)
  // the world of each dimension: a recorded world's each, the showcase's overworld; players start in the one asked for
  const worlds = new Map()
  if (recorded) {
    for (const name of Object.keys(recorded.meta.dimensions)) worlds.set(DIMENSIONS.indexOf(name), recordedWorld(registry, Chunk, recorded.meta, recorded.bin, name))
  } else {
    worlds.set(0, showcaseWorld(registry, Chunk))
  }
  const startDimension = recorded ? DIMENSIONS.indexOf(recorded.dimension ?? 'overworld') : 0
  if (!worlds.has(startDimension)) throw new Error(`world ${recorded.meta.name} has no ${recorded.dimension}`)
  const world = worlds.get(startDimension)
  const states = statesOf(registry)
  const toggleGate = gateToggle(registry)
  const air = registry.blocksByName.air.defaultState
  const water = new Set(['water', 'flowing_water'].map(name => registry.blocksByName[name]?.id).filter(id => id !== undefined))

  // the blobs every connection's cached columns name, by their hash's digits (prismarine-chunk asks for them with a
  // bigint on some versions and its digits on others)
  const blobs = new Map()
  const blobStore = {
    get: key => blobs.get(hashKey(key)),
    set: (key, value) => blobs.set(hashKey(key), value),
    has: key => blobs.has(hashKey(key))
  }

  const prepared = new Set()
  // A column as the network encoders take it: biomes (from 1.18) and sections (before) without holes, which they
  // cannot step over
  function column (cx, cz, dimension = startDimension) {
    const col = worlds.get(dimension).column(cx, cz)
    if (prepared.has(col)) return col
    prepared.add(col)
    if (registry.version['>=']('1.18.0')) {
      // (writeBiomes fills each missing biome section, as it writes them)
      const Stream = require('prismarine-chunk/src/bedrock/common/Stream')
      col.writeBiomes(new Stream())
    } else {
      for (let i = 0; i < col.sections.length; i++) if (!col.sections[i]) col.setBlockStateId(new Vec3(0, (i - col.co) * 16, 0), air)
    }
    return col
  }

  const local = pos => new Vec3(((pos.x % 16) + 16) % 16, pos.y, ((pos.z % 16) + 16) % 16)
  const columnAt = (pos, dimension) => column(Math.floor(pos.x / 16), Math.floor(pos.z / 16), dimension)

  const connections = new Set()
  const subchunkResult = fieldType(types, 'packet_subchunk', 'request_result')

  const server = {
    version,
    registry,
    hashes: useHashes,
    world,
    worlds,
    states,
    blobs,
    blobStore,
    codecTypes: types,
    verify,
    maxRadius,
    log,
    connections,
    hotbar: hotbarOf(registry),
    gameModes: mapperValues(types, 'GameMode').filter(mode => ['survival', 'creative', 'adventure', 'spectator'].includes(mode)),
    tick: 0,
    time: 1000,
    // the dimension players start in (0 overworld, 1 nether, 2 end)
    dimension: startDimension,
    // a dimension's bottom: a player below it has fallen out
    minYOf: dimension => registry.version['>=']('1.18.0') && dimension === 0 ? -64 : 0,
    // whether a section all air may be answered as one (1.18.0 cannot)
    allAir: !(subchunkResult && !mapperValues(types, subchunkResult).includes('success_all_air')),
    // from 1.26.40 an entry's payload and blob id are optional
    optionalSubchunkPayload: !!types.SubChunkEntry,
    column,

    accept (port) {
      const connection = new Connection(server, port)
      connections.add(connection)
      return connection
    },
    remove (connection) {
      connections.delete(connection)
    },

    getBlockStateId (pos, layer = 0, dimension = startDimension) {
      const at = local(pos)
      at.l = layer
      return columnAt(pos, dimension).getBlockStateId(at) ?? air
    },
    blockName (pos, dimension = startDimension) {
      return registry.blocksByStateId[server.getBlockStateId({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }, 0, dimension)]?.name ?? 'air'
    },
    // a block of a dimension changed: in its column (its section's blob is hashed again), and told every player in it
    setBlock (pos, stateId, layer = 0, dimension = startDimension) {
      const col = columnAt(pos, dimension)
      const at = local(pos)
      at.l = layer
      col.setBlockStateId(at, stateId)
      // (prismarine-chunk leaves a section unmarked when the state was in its palette already)
      const section = col.sections[col.co + (pos.y >> 4)]
      if (section) section.updated = true
      if (layer === 0 && col.getBlockEntity(at)) col.removeBlockEntity(at)
      for (const connection of connections) if (connection.dimension === dimension) server.sendBlock(connection, pos, layer)
    },
    sendBlock (connection, pos, layer = 0) {
      const position = { x: pos.x, y: pos.y, z: pos.z }
      // (1.16.201 names the position coordinates and the layer storage, and has a priority for the flags)
      connection.queue('update_block', { position, coordinates: position, block_runtime_id: server.getBlockStateId(pos, layer, connection.dimension), flags: { neighbors: true, network: true }, block_priority: 3, layer, storage: layer })
    },

    // creative breaking: the block goes at once, the water it held stays
    breakBlock (connection, pos) {
      if (connection.gamemode !== 'creative' || !reaches(connection, pos)) return refuse(connection, pos)
      const dimension = connection.dimension
      const held = server.getBlockStateId(pos, 1, dimension)
      server.setBlock(pos, water.has(registry.blocksByStateId[held]?.id) ? held : air, 0, dimension)
      if (held !== air) server.setBlock(pos, air, 1, dimension)
      connection.stats.broken++
    },
    // a use of a block that does something: a fence gate opens or shuts (not for a player sneaking, who places
    // against it). Whether it did.
    useBlock (connection, pos) {
      if (connection.sneaking) return false
      const dimension = connection.dimension
      const toggled = toggleGate(server.getBlockStateId(pos, 0, dimension))
      if (toggled === null) return false
      if (!reaches(connection, pos)) {
        refuse(connection, pos)
        return true
      }
      server.setBlock(pos, toggled, 0, dimension)
      return true
    },
    // the block of the hotbar slot, placed against the face clicked
    placeBlock (connection, against, face, slot, held) {
      const offset = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][face]
      const item = server.hotbar[slot]
      if (!offset || !item) return
      const at = { x: against.x + offset[0], y: against.y + offset[1], z: against.z + offset[2] }
      const dimension = connection.dimension
      const there = registry.blocksByStateId[server.getBlockStateId(at, 0, dimension)]?.name ?? 'air'
      if (!reaches(connection, at) || !REPLACEABLE.has(there) || inPlayer(connection, at)) return refuse(connection, at)
      if (held?.network_id !== undefined && held.network_id !== item.networkId) connection.stats.heldMismatches++
      server.setBlock(at, item.stateId, 0, dimension)
      if (server.getBlockStateId(at, 1, dimension) !== air) server.setBlock(at, air, 1, dimension)
      connection.stats.placed++
    },

    command (line, connection) {
      runCommand(server, line, connection)
    },
    setTime (time) {
      server.time = Math.max(0, Math.round(time))
      for (const connection of connections) connection.queue('set_time', { time: server.time })
    },

    // a tick: the time goes on, each connection is sent a few of its columns
    step () {
      server.tick++
      if (server.tick % 20 === 0) server.time++
      for (const connection of connections) connection.chunks.tick(budget)
    },
    // runs step() every 50 ms (the worker; the check steps the server itself)
    start () {
      server.timer = setInterval(server.step, TICK_MS)
    },
    close (reason = 'server closed') {
      clearInterval(server.timer)
      for (const connection of [...connections]) connection.close(reason)
    },
    stats () {
      return {
        tick: server.tick,
        blobs: blobs.size,
        connections: [...connections].map(c => ({ username: c.username, stage: c.stage, dimension: c.dimension, feet: c.feet, columns: c.chunks.sent.size, ...c.stats, channel: c.channel.stats }))
      }
    }
  }

  // refused: the block as it is, for the client to put back what it predicted
  function refuse (connection, pos) {
    connection.stats.refused++
    server.sendBlock(connection, pos, 0)
    server.sendBlock(connection, pos, 1)
  }

  function reaches (connection, pos) {
    const eyes = { x: connection.feet.x, y: connection.feet.y + EYE_HEIGHT, z: connection.feet.z }
    return Math.hypot(pos.x + 0.5 - eyes.x, pos.y + 0.5 - eyes.y, pos.z + 0.5 - eyes.z) <= REACH
  }

  // whether a block at `pos` would be in the player (0.6 wide, 1.8 high)
  function inPlayer (connection, pos) {
    const { x, y, z } = connection.feet
    return pos.x < x + 0.3 && pos.x + 1 > x - 0.3 && pos.y < y + 1.8 && pos.y + 1 > y && pos.z < z + 0.3 && pos.z + 1 > z - 0.3
  }

  log(`${version}: ${world.name} world (${[...worlds.keys()].map(d => DIMENSIONS[d]).join(', ')}), ${useHashes ? 'hashed' : 'sequential'} block ids, hotbar ${server.hotbar.map(item => item.name).join(', ')}` + (world.missing.size ? `; no ${[...world.missing].join(', ')}` : ''))
  return server
}

module.exports = { createServer, TICK_MS }
