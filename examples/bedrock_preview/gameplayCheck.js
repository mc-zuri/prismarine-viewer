// Plays the gameplay page's server and client against each other in Node, over a MessageChannel as the page and its
// worker do, for every version the page offers, with the blob cache off and on and hashed block ids off and on (from
// 1.19.80), and checks what a player would see:
//
//   schema     every packet of the version, completed from nothing (schema.js fill), is written, read and written
//              again the same
//   join       the client gets to play, with the hashed ids the server chose, reading every packet as it was written
//   columns    every section the client read is the server's, block for block, with its block entities
//   cache      joining again with the blobs of the first join, the client lacks none
//   walk       40 ticks forward on the ground: the player goes 3 blocks or more, stays on the ground, and the server
//              has it where the client does
//   build      a block placed and broken is placed and broken in both worlds
//   portals    in a recorded world with them: the overworld's nether portal takes the player to the nether, its end
//              portal to the end, each dimension's columns the same on both sides; /dimension takes it back
//   commands   /setblock, /tp, /gamemode survival and /time do what they say
//
//   node examples/bedrock_preview/gameplayCheck.js [versions...] [--cache on,off] [--hashes on,off] [--verbose]
//
// Needs Node 22.18 or later (the physics engine is TypeScript, run through its own hooks), and the gameplay page's
// minecraft-data: the files the bundles fetch, read here from the minecraft-data the viewer is installed with.
require('prismarine-physics-bedrock/lib/ts-hooks')
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { MessageChannel } = require('worker_threads')
const { Vec3 } = require('vec3')
const { createLazyData, preload } = require('../../viewer/lib/mcData')
const { listDataFiles } = require('../../viewer/webpack/lazyDataLoader')
const { WORKER_KEYS } = require('../../viewer/webpack/lazyMinecraftData')
const { GAMEPLAY_KEYS, compareVersions, hasProtocol, supportsHashes } = require('./src/gameplay/data')

// minecraft-data as the bundles have it: the table of lazyDataLoader.js, its files read from disk
const dataDir = path.join(path.dirname(require.resolve('minecraft-data/package.json')), 'minecraft-data', 'data')
const { paths, files } = listDataFiles(dataDir, { keys: GAMEPLAY_KEYS })
const loaders = Object.fromEntries(files.map(id => [id, async () => JSON.parse(fs.readFileSync(path.join(dataDir, id + '.json'), 'utf8'))]))
const dataJs = require.resolve('minecraft-data/data.js')
const lazy = new Module(dataJs)
lazy.filename = dataJs
lazy.loaded = true
lazy.exports = createLazyData({ paths, files: loaders })
require.cache[dataJs] = lazy

const { createServer } = require('./src/gameplay/server/server')
const { createClient } = require('./src/gameplay/client/client')
const { BlobStore } = require('./src/gameplay/client/blobs')
const { compile } = require('./src/gameplay/protocol/codec')
const { createCodec } = require('./src/gameplay/protocol/codec')
const { G } = require('./src/showcase')
const { exact } = require('prismarine-physics-bedrock/lib/bedrock/index.ts')

// packets of old versions whose schema protodef cannot write from defaults (none the gameplay sends)
const SCHEMA_GAPS = { clientbound_map_item_data: ['1.16.201', '1.16.210'], update_block_synced: ['1.16.201', '1.16.210', '1.16.220', '1.17.0', '1.17.10'], player_armor_damage: ['1.16.201'] }

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args.splice(i, 2)[1].split(',').map(v => v === 'on')
}
const verbose = args.includes('--verbose') && !!args.splice(args.indexOf('--verbose'), 1)
// a world of worldImport.js's (public/worlds/<name>, and a dimension of it: explore:nether), else the showcase
const worldName = args.includes('--world') ? args.splice(args.indexOf('--world'), 2)[1] : null
const [recordedName, recordedDimension = 'overworld'] = (worldName ?? '').split(':')
const recorded = worldName && {
  meta: JSON.parse(fs.readFileSync(path.join(__dirname, 'public/worlds', recordedName + '.json'), 'utf8')),
  bin: require('zlib').gunzipSync(fs.readFileSync(path.join(__dirname, 'public/worlds', recordedName + '.bin'))),
  dimension: recordedDimension
}
const caches = option('--cache', [false, true])
const hashings = option('--hashes', [false, true])
const viewerVersions = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/worldBounds.json'), 'utf8')))
  .filter(v => v.startsWith('bedrock_')).map(v => v.slice(8)).filter(hasProtocol).sort(compareVersions)
const versions = args.length ? args : viewerVersions

// lets messages cross the ports and the client's packets be handled
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
}

function checkSchema (version) {
  const codec = createCodec(version)
  const failed = []
  for (const type of Object.keys(codec.types).filter(t => t.startsWith('packet_'))) {
    const name = type.slice(7)
    if (SCHEMA_GAPS[name]?.includes(version)) continue
    try {
      const a = codec.encode(name, {})
      const data = codec.decode(a)
      if (!a.equals(codec.encode(data.name, data.params))) failed.push(`${name} (written otherwise)`)
    } catch (err) {
      failed.push(`${name}: ${err.message.split('\n')[0]}`)
    }
  }
  return failed
}

// A server and a client of a version, joined; a fake clock the check moves on
async function join (version, { cache, hashes, blobStore, log }) {
  let time = 0
  const now = () => time
  const server = createServer({ version, hashes, world: recorded, verify: true, log })
  const { port1, port2 } = new MessageChannel()
  const connection = server.accept(port2)
  const client = createClient({ port: port1, version, cache, blobStore, verify: true, now })
  const problems = []
  client.on('problem', text => problems.push(text))
  const session = {
    server,
    connection,
    client,
    problems,
    // a tick of both: the server sends what it has to, the client steps the player
    async tick (n = 1) {
      for (let i = 0; i < n; i++) {
        server.step()
        time += 50
        client.tick()
        await settle()
      }
      await client.chain
    },
    async until (what, ticks, test) {
      for (let i = 0; i < ticks; i++) {
        if (test()) return
        await session.tick()
      }
      if (test()) return
      const received = Object.entries(client.channel.stats.received).map(([name, { count }]) => `${name} ${count}`).join(', ')
      const sent = Object.entries(client.channel.stats.sent).map(([name, { count }]) => `${name} ${count}`).join(', ')
      throw new Error(`${what}: not in ${ticks} ticks (client ${client.stage}, server ${connection.stage}; the client got ${received}; sent ${sent}; ${problems.join('; ')})`)
    },
    close () {
      client.close()
      server.close()
      port1.close()
      port2.close()
    }
  }
  await session.until('join', 200, () => client.stage === 'playing')
  // every column within the radius, and their sections
  await session.until('the world', 600, () => connection.chunks.settled && !pendingSections(client) && client.stats.blobs.pending === 0 && blobStore.waiters.length === 0)
  await session.tick(2)
  return session
}

function pendingSections (client) {
  for (const sections of client.chunks.requested.values()) if (sections.size) return true
  return false
}

// the first difference between the server's columns and the client's
function compareColumns (server, client, dimension = server.dimension) {
  const local = (x, y, z, l) => ({ x, y, z, l })
  let columns = 0
  let sections = 0
  for (const name of client.chunks.loaded) {
    const [cx, cz] = name.split(',').map(Number)
    const theirs = client.chunks.columns.get(name)
    const ours = server.column(cx, cz, dimension)
    columns++
    for (let sy = ours.minCY; sy < ours.maxCY; sy++) {
      const a = ours.getSectionAtIndex(sy)
      const b = theirs.getSectionAtIndex(sy)
      if (!a && !b) continue
      sections++
      for (let y = sy * 16; y < sy * 16 + 16; y++) {
        for (let x = 0; x < 16; x++) {
          for (let z = 0; z < 16; z++) {
            for (const l of [0, 1]) {
              const want = ours.getBlockStateId(local(x, y, z, l)) ?? server.registry.blocksByName.air.defaultState
              const got = theirs.getBlockStateId(local(x, y, z, l)) ?? server.registry.blocksByName.air.defaultState
              if (want !== got) return { columns, sections, wrong: `${cx * 16 + x},${y},${cz * 16 + z} layer ${l}: ${want} (${server.registry.blocksByStateId[want]?.name}) read as ${got} (${server.registry.blocksByStateId[got]?.name})` }
            }
          }
        }
      }
    }
    const wanted = Object.keys(ours.blockEntities).sort().join(';')
    const got = Object.keys(theirs.blockEntities).sort().join(';')
    if (wanted !== got) return { columns, sections, wrong: `block entities of ${cx},${cz}: ${wanted} read as ${got}` }
    if (ours.getBiomeId(new Vec3(5, G, 5)) !== theirs.getBiomeId(new Vec3(5, G, 5))) return { columns, sections, wrong: `the biome of ${cx},${cz}` }
  }
  return { columns, sections, wrong: null }
}

// the direction from the eyes to a point
function aimAt (client, point) {
  const { pos } = client.player
  const eye = new Vec3(pos.x, pos.y + client.movement.physics.eyeHeight, pos.z)
  const d = point.minus(eye)
  return { eye, dir: d.scaled(1 / d.norm()) }
}

async function play (version, cache, hashes) {
  const row = { version, cache, hashes, ok: true, notes: [] }
  const fail = text => {
    row.ok = false
    row.notes.push(text)
  }
  const log = verbose ? line => console.log(`  [server] ${line}`) : () => {}
  const blobStore = new BlobStore()
  let session
  try {
    session = await join(version, { cache, hashes, blobStore, log })
    const { server, connection, client } = session
    const startHashes = client.registry.supportFeature('blockHashes') && !!client.startGame.block_network_ids_are_hashes
    if (startHashes !== server.hashes) fail(`start_game says hashed ids ${startHashes}, the server ${server.hashes}`)
    if (client.dimension !== server.dimension) fail(`start_game says dimension ${client.dimension}, the server's world is ${server.dimension}`)
    // columns
    const compared = compareColumns(server, client)
    row.columns = compared.columns
    row.sections = compared.sections
    if (compared.wrong) fail(`columns: ${compared.wrong}`)
    row.misses = client.stats.blobs.misses
    row.hits = client.stats.blobs.hits

    // walk north (yaw 0): in the showcase along x = 0.5, the lane clear to the world's edge; in a recorded world
    // wherever it leads, the server having the player where the client has it
    const start = client.player.pos.clone()
    client.setLook(0, 0)
    client.setControl('forward', true)
    await session.tick(40)
    client.setControl('forward', false)
    await session.tick(5)
    const walked = start.z - client.player.pos.z
    row.walked = walked.toFixed(2)
    if (!recorded && walked < 3) fail(`walked ${walked.toFixed(2)} blocks`)
    if (!recorded && Math.abs(client.player.pos.y - G) > 1e-3) fail(`feet at ${client.player.pos.y} after the walk`)
    const feet = connection.feet
    if (Math.abs(feet.x - client.player.pos.x) > 1e-3 || Math.abs(feet.z - client.player.pos.z) > 1e-3) fail(`the server has the player at ${feet.x},${feet.z}, the client at ${client.player.pos.x},${client.player.pos.z}`)
    if (client.stats.corrections) fail(`${client.stats.corrections} corrections`)

    // build: a block of the hotbar on the ground two blocks ahead, then broken (the showcase's ground)
    const ground = new Vec3(Math.floor(client.player.pos.x), G - 1, Math.floor(client.player.pos.z) - 2)
    const { eye, dir } = aimAt(client, ground.offset(0.5, 1, 0.5))
    const target = client.target(eye, dir)
    if (recorded) {
      // (a recorded world's ground is where it is)
    } else if (!target || target.pos.y !== G - 1 || target.face !== 1) {
      fail(`aimed at ${JSON.stringify(target?.pos)} face ${target?.face}, not the ground's top`)
    } else {
      client.selectSlot(4)
      const item = client.interaction.held
      client.placeBlock(target)
      await session.tick(3)
      const placed = ground.offset(0, 1, 0)
      const want = server.hotbar[4]?.stateId
      if (server.getBlockStateId(placed) !== want || client.chunks.getBlockStateId(placed) !== want) fail(`placed ${item?.name}: the server has ${server.getBlockStateId(placed)}, the client ${client.chunks.getBlockStateId(placed)}, not ${want}`)
      const again = aimAt(client, placed.offset(0.5, 0.5, 0.5))
      client.breakBlock(client.target(again.eye, again.dir))
      await session.tick(3)
      const air = server.registry.blocksByName.air.defaultState
      if (server.getBlockStateId(placed) !== air || client.chunks.getBlockStateId(placed) !== air) fail(`broken: the server has ${server.getBlockStateId(placed)}, the client ${client.chunks.getBlockStateId(placed)}`)
      if (connection.stats.refused) fail(`${connection.stats.refused} refused`)
      if (connection.stats.heldMismatches) fail('the held item is not the hotbar\'s')
    }

    // portals: into the overworld's nether portal and its end portal, each dimension's columns read as the server has
    // them, and back with /dimension
    if (recorded && server.dimension === 0) {
      for (const [kind, to] of [['portal', 1], ['end_portal', 2]]) {
        const blocks = server.world.find?.(kind) ?? []
        if (!blocks.length || !server.worlds.has(to)) continue
        const at = blocks.reduce((low, b) => b.x === blocks[0].x && b.z === blocks[0].z && b.y < low.y ? b : low, blocks[0])
        // (a portal takes a player who stepped out of the last: a moment in the air first)
        client.chat(`/tp ${at.x + 0.5} ${at.y + 6} ${at.z + 0.5}`)
        await session.tick(4)
        client.chat(`/tp ${at.x + 0.5} ${at.y} ${at.z + 0.5}`)
        await session.until(`through the ${kind}`, 400, () => client.dimension === to && client.stage === 'playing' && connection.chunks.settled && !pendingSections(client))
        await session.tick(5)
        const there = compareColumns(server, client, to)
        if (there.wrong) fail(`${kind}: ${there.wrong}`)
        if (!there.columns) fail(`${kind}: no columns there`)
        if (connection.dimension !== to || Math.abs(client.player.pos.x - connection.feet.x) > 1e-3) fail(`${kind}: the server has the player in ${connection.dimension} at ${connection.feet.x}, the client at ${client.player.pos.x}`)
        row.portals = (row.portals ?? '') + `${kind === 'portal' ? 'nether' : 'end'} ${there.columns} `
        client.chat('/dimension overworld')
        await session.until('back to the overworld', 400, () => client.dimension === 0 && client.stage === 'playing' && connection.chunks.settled && !pendingSections(client))
        await session.tick(5)
      }
    }

    // commands
    client.chat('/setblock ~ ~ ~3 glass')
    await session.tick(3)
    const glass = new Vec3(Math.floor(connection.feet.x), Math.floor(connection.feet.y), Math.floor(connection.feet.z) + 3)
    const glassState = server.registry.blocksByName.glass.defaultState
    if (server.getBlockStateId(glass) !== glassState || client.chunks.getBlockStateId(glass) !== glassState) fail('/setblock')
    client.chat('/time set noon')
    client.chat('/gamemode survival')
    const before = client.player.pos.clone()
    client.chat(recorded ? '/tp ~8 ~6 ~8' : '/tp 8.5 70 8.5')
    await session.tick(5)
    if (client.time !== 6000) fail(`/time: ${client.time}`)
    if (client.gamemode !== 'survival' || client.player.mayFly) fail(`/gamemode: ${client.gamemode}, may fly ${client.player.mayFly}`)
    const tpX = recorded ? before.x + 8 : 8.5
    if (Math.abs(client.player.pos.x - tpX) > 1e-3 || (!recorded && (client.player.pos.y > 70 || client.player.pos.y < G))) fail(`/tp: at ${client.player.pos}`)
    if (!client.stats.teleports) fail('/tp: no teleport')
    if (!exact) fail('the physics trig is not exact')
    const errors = client.channel.stats.decodeErrors + connection.channel.stats.decodeErrors
    const mismatches = client.codec.stats.verifyMismatches + connection.codec.stats.verifyMismatches
    const unknown = Object.keys(client.stats.unknownRuntimeIds).length
    if (errors) fail(`${errors} packets unread`)
    if (mismatches) fail(`${mismatches} packets read back otherwise`)
    if (unknown) fail(`${unknown} unknown runtime ids`)
    for (const problem of session.problems) fail(problem)
    session.close()

    // the cache: a second join finds every blob
    if (cache) {
      session = await join(version, { cache, hashes, blobStore, log })
      row.rejoinMisses = session.client.stats.blobs.misses
      if (row.rejoinMisses) fail(`joined again, ${row.rejoinMisses} blobs missing`)
      session.close()
    }
  } catch (err) {
    fail(verbose ? err.stack : err.message)
    session?.close()
  }
  return row
}

async function main () {
  console.log(`physics exact: ${exact}; versions: ${versions.join(' ')}`)
  let failed = 0
  for (const version of versions) {
    await preload('bedrock_' + version)
    compile(version)
    const gaps = checkSchema(version)
    if (gaps.length) {
      failed++
      console.log(`${version} schema: ${gaps.join('; ')}`)
    }
    for (const cache of caches) {
      for (const hashes of hashings) {
        if (hashes && !supportsHashes(version)) continue
        const t0 = Date.now()
        const row = await play(version, cache, hashes)
        if (!row.ok) failed++
        const cells = `${row.columns ?? '-'} columns ${row.sections ?? '-'} sections, blobs ${row.hits ?? 0} hit ${row.misses ?? 0} missed${cache ? `, again ${row.rejoinMisses ?? '-'} missed` : ''}, walked ${row.walked ?? '-'}${row.portals ? `, portals: ${row.portals.trim()}` : ''}`
        console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${version.padEnd(9)} cache ${cache ? 'on ' : 'off'} hashes ${hashes ? 'on ' : 'off'} ${cells} (${Date.now() - t0} ms)`)
        for (const note of row.notes) console.log(`       ${note}`)
      }
    }
  }
  console.log(failed ? `${failed} failed` : 'all passed')
  process.exit(failed ? 1 : 0)
}

// (WORKER_KEYS: the viewer's own; the gameplay's keys are a superset of them)
if (!WORKER_KEYS.every(key => GAMEPLAY_KEYS.includes(key))) throw new Error('GAMEPLAY_KEYS must hold the viewer\'s WORKER_KEYS')
main()
