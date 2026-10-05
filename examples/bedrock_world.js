// Shows a Bedrock world saved on disk (the LevelDB a Bedrock Dedicated Server keeps in worlds/<name>/db) in the browser.
//
//   npm install bedrock-provider leveldb-zlib
//   node examples/bedrock_world.js <world folder> <version> [x z] [--hashes]
//
// version: the Bedrock version the world was saved with (1.26.51); x z: where to look (the world's spawn, as
// level.dat has it, by default 0 0); --hashes: read its blocks with block network hashes as state ids, as a server
// started with them sends them. Then open http://localhost:3000 (or $PORT).
const path = require('path')
const { Vec3 } = require('vec3')
const { LevelDB } = require('leveldb-zlib')
const { WorldProvider } = require('bedrock-provider')
const standalone = require('prismarine-viewer').standalone

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const [folder, version] = args
const hashes = process.argv.includes('--hashes')
if (!folder || !version) {
  console.log('usage: node examples/bedrock_world.js <world folder> <version> [x z] [--hashes]')
  process.exit(1)
}

async function main () {
  const registry = require('prismarine-registry')('bedrock_' + version)
  if (hashes) registry.handleStartGame({ block_network_ids_are_hashes: true, itemstates: [] })
  const Chunk = require('prismarine-chunk')(registry)

  const dbPath = path.basename(folder) === 'db' ? folder : path.join(folder, 'db')
  const db = new LevelDB(dbPath, { createIfMissing: false })
  await db.open()
  const provider = new WorldProvider(db, { dimension: 0, registry })

  // the columns of the world, an empty one where it has none
  const columns = new Map()
  const world = {
    getColumn (x, z) {
      const key = `${x},${z}`
      if (!columns.has(key)) {
        columns.set(key, provider.load(x, z, true).catch(() => null).then(column => column ?? new Chunk({ x, z })))
      }
      return columns.get(key)
    }
  }

  const center = new Vec3(Number(args[2] ?? 0), 64, Number(args[3] ?? 0))
  // on the highest block there
  const column = await world.getColumn(Math.floor(center.x / 16), Math.floor(center.z / 16))
  for (let y = (column.maxCY ?? 16) * 16 - 1; y >= (column.minCY ?? 0) * 16; y--) {
    const state = column.getBlockStateId({ x: Math.floor(center.x) & 15, y, z: Math.floor(center.z) & 15 })
    const name = registry.blockStatesByStateId?.[state]?.name ?? registry.blockStates[state]?.name
    if (name && name !== 'air') {
      center.y = y + 1
      break
    }
  }

  standalone({ version: 'bedrock_' + version, world, center, viewDistance: 4, port: Number(process.env.PORT ?? 3000), worldOptions: { blockHashes: hashes } })
}

main()
