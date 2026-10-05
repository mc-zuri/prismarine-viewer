// Makes a Bedrock world on disk (a LevelDB db/ folder, as Bedrock Dedicated Server keeps it, or as bedrock-demo's proxy
// saves what passes through it) a world the gameplay page plays in every version it offers (see
// src/gameplay/server/recordedWorld.js for the files):
//
//   node examples/bedrock_preview/worldImport.js <world folder> [--name <name>] [--version <version>] [--out <folder>]
//
// The folder holds db/, and demo.json (bedrock-demo's: { version, spawn }) unless --version names the version the world
// was saved by. The files go to examples/bedrock_preview/public/worlds/ (with index.json, the list the page offers).
//
// Each block is kept by its name and states, as the world has them, and each is also worked out once for every version:
//   1. the same block where the version has its name, in the state nearest its own;
//   2. else the block it was before (Bedrock's flattening: granite was stone with stone_type=granite), through Java's
//      name for it: minecraft-data's blocksB2J of the world's version, then blocksJ2B of the version (before 1.17,
//      which have none, 1.17.0's, and the nearest state of the version);
//   3. else a stand-in: deepslate's ores as the ores, anything solid as stone, the rest air.
// Biomes go by name (plains where a version has no such biome). The biomes of a world are read as the game writes
// them (32-bit ids) or as bedrock-demo's proxy wrote them before (the network's varints).
//
// Reading the world takes leveldb-zlib (a native module the viewer does not install): npm install leveldb-zlib, or run
// with NODE_PATH pointing at a node_modules that has it (bedrock-demo's).
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const nbt = require('prismarine-nbt')
const { compareVersions } = require('./src/gameplay/data')
const { FORMAT, DIMENSIONS, stateKey, writeColumns } = require('./src/gameplay/server/recordedWorld')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args.splice(i, 2)[1]
}
const out = path.resolve(option('--out', path.join(__dirname, 'public', 'worlds')))
const asked = { name: option('--name'), version: option('--version') }
const folder = args[0]
if (!folder) {
  console.log('node examples/bedrock_preview/worldImport.js <world folder> [--name <name>] [--version <version>] [--out <folder>]')
  process.exit(1)
}

const dataDir = path.join(path.dirname(require.resolve('minecraft-data/package.json')), 'minecraft-data', 'data')
const dataPaths = JSON.parse(fs.readFileSync(path.join(dataDir, 'dataPaths.json'), 'utf8')).bedrock
const dataFile = (version, key) => dataPaths[version]?.[key] && JSON.parse(fs.readFileSync(path.join(dataDir, dataPaths[version][key], key + '.json'), 'utf8'))
// the versions the page offers (those the viewer has assets of, with packets)
const pageVersions = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/worldBounds.json'), 'utf8')))
  .filter(v => v.startsWith('bedrock_')).map(v => v.slice(8)).filter(v => dataPaths[v]?.protocol).sort(compareVersions)

// ---- reading the world ------------------------------------------------------------------------------------------------

const TAG = { DATA_3D: 43, SUB_CHUNK: 47 }

// the world's own palette: every block state it has, by name and states
const palette = []
const paletteIndex = new Map()
function paletteEntry (name, states) {
  const key = stateKey(name, states)
  if (!paletteIndex.has(key)) {
    paletteIndex.set(key, palette.length)
    palette.push([name, states])
  }
  return paletteIndex.get(key)
}

// A sub-chunk as the game keeps it on disk (version 8 or 9, or 1: one layer): each layer its blocks' indices into a
// palette of named states (little-endian NBT)
function readSection (buffer) {
  let o = 0
  const version = buffer[o++]
  let layerCount = 1
  let y
  if (version === 8 || version === 9) {
    layerCount = buffer[o++]
    if (version === 9) y = buffer.readInt8(o++)
  } else if (version !== 1) {
    throw new Error(`sub-chunk version ${version}`)
  }
  const layers = []
  for (let l = 0; l < layerCount; l++) {
    const bits = buffer[o++] >> 1
    const indices = new Uint16Array(4096)
    if (bits) {
      const perWord = Math.floor(32 / bits)
      const mask = (1 << bits) - 1
      for (let i = 0; i < 4096; i++) indices[i] = (buffer.readUInt32LE(o + Math.floor(i / perWord) * 4) >>> ((i % perWord) * bits)) & mask
      o += Math.ceil(4096 / perWord) * 4
    }
    const size = buffer.readUInt32LE(o)
    o += 4
    const local = []
    for (let i = 0; i < size; i++) {
      const { data, metadata } = nbt.protos.little.parsePacketBuffer('nbt', buffer, o)
      o += metadata.size
      const tag = data.value
      local.push(paletteEntry(tag.name.value.replace(/^minecraft:/, ''), tag.states?.value ?? {}))
    }
    layers.push({ palette: local, indices })
  }
  return { y, layers }
}

// The 3D biomes of a Data3D key (after its 512 bytes of heightmap): a section from the bottom up (0xff: the one below
// again), each a palette of biome ids, as 32-bit ints (the game) or zigzag varints (the proxy before it was fixed).
// null when neither reads the whole key into biomes the version knows.
function readBiomes (buffer, known) {
  for (const disk of [true, false]) {
    try {
      let o = 0
      const varint = () => {
        let value = 0
        let shift = 0
        let byte
        do {
          byte = buffer[o++]
          value |= (byte & 0x7f) << shift
          shift += 7
        } while (byte & 0x80)
        return value >>> 1
      }
      const id = () => {
        if (!disk) return varint()
        o += 4
        return buffer.readInt32LE(o - 4)
      }
      const sections = []
      while (o < buffer.length) {
        const header = buffer[o++]
        if (header === 0xff) {
          sections.push(sections[sections.length - 1])
          continue
        }
        if (!(header & 1)) throw new Error('not a biome palette')
        const bits = header >> 1
        if (!bits) {
          sections.push({ palette: [id()], indices: null })
          continue
        }
        const perWord = Math.floor(32 / bits)
        const mask = (1 << bits) - 1
        const indices = new Uint16Array(4096)
        for (let i = 0; i < 4096; i++) indices[i] = (buffer.readUInt32LE(o + Math.floor(i / perWord) * 4) >>> ((i % perWord) * bits)) & mask
        o += Math.ceil(4096 / perWord) * 4
        const size = disk ? id() : varint()
        const ids = []
        for (let i = 0; i < size; i++) ids.push(id())
        sections.push({ palette: ids, indices })
      }
      if (o === buffer.length && sections.every(s => s.palette.every(b => known(b)))) return sections
    } catch {}
  }
  return null
}

async function readWorld (dir, version) {
  let leveldb
  try {
    leveldb = require('leveldb-zlib')
  } catch {
    throw new Error('reading a world takes leveldb-zlib: npm install leveldb-zlib, or set NODE_PATH to a node_modules with it (bedrock-demo\'s)')
  }
  const db = new leveldb.LevelDB(path.join(dir, 'db'), { createIfMissing: false })
  await db.open()
  const biomeNames = dataFile(version, 'biomes')
  const byId = new Map(biomeNames.map(b => [b.id, b.name]))
  // 'dimension:x,z' -> { dimension, x, z, sections: Map(y -> section), biomes }
  const columns = new Map()
  const columnOf = (dimension, x, z) => {
    const key = `${dimension}:${x},${z}`
    if (!columns.has(key)) columns.set(key, { dimension, x, z, sections: new Map(), biomes: null })
    return columns.get(key)
  }
  let unread = 0
  try {
    for await (const [key, value] of db.getIterator({ values: true })) {
      // a chunk's keys: x, z, the dimension unless the overworld, a tag, and a sub-chunk's y
      if (key.length < 9 || key.length > 14 || key.length === 11 || key.length === 12) continue
      const withDimension = key.length >= 13
      const dimension = withDimension ? key.readInt32LE(8) : 0
      const tag = key[withDimension ? 12 : 8]
      const subChunk = key.length === 10 || key.length === 14
      if (dimension < 0 || dimension > 2) continue
      const x = key.readInt32LE(0)
      const z = key.readInt32LE(4)
      try {
        if (tag === TAG.SUB_CHUNK && subChunk) {
          const section = readSection(value)
          columnOf(dimension, x, z).sections.set(section.y ?? key.readInt8(key.length - 1), section)
        } else if (tag === TAG.DATA_3D && !subChunk) {
          const column = columnOf(dimension, x, z)
          column.biomes = readBiomes(value.subarray(512), id => byId.has(id))
          if (!column.biomes) unread++
        }
      } catch (err) {
        unread++
        if (unread < 5) console.warn(`${x},${z} tag ${tag}: ${err.message}`)
      }
    }
  } finally {
    await db.close()
  }
  return { columns, byId, unread }
}

// ---- the blocks in every version -------------------------------------------------------------------------------------

// a state's value as the tables write it: bits as 0 and 1 (one table writes them true and false)
const norm = value => value === true || value === 'true' ? '1' : value === false || value === 'false' ? '0' : String(value)
const propsOf = states => Object.fromEntries(Object.entries(states ?? {}).map(([k, v]) => [k, norm(v.value)]))

// 'minecraft:oak_stairs[upside_down_bit=1,weirdo_direction=3]' -> { name, props }
function parseState (text) {
  const match = /^(?:minecraft:)?([^[]+)(?:\[(.*)\])?$/.exec(text)
  const props = {}
  for (const pair of (match[2] ?? '').split(',').filter(Boolean)) {
    const at = pair.lastIndexOf('=')
    props[pair.slice(0, at)] = norm(pair.slice(at + 1))
  }
  return { name: match[1], props }
}

// a table (state text -> state text) indexed by the name of its keys
function indexTable (table) {
  const index = new Map()
  for (const [from, to] of Object.entries(table ?? {})) {
    const { name, props } = parseState(from)
    if (!index.has(name)) index.set(name, [])
    index.get(name).push({ props, to })
  }
  return index
}

// the entry of an indexed table whose states agree most with props (those it names that props has too)
function bestOf (entries, props) {
  let best = null
  let score = -Infinity
  for (const entry of entries ?? []) {
    let s = 0
    for (const [k, v] of Object.entries(entry.props)) {
      if (!(k in props)) continue
      s += props[k] === v ? 1 : -1
    }
    if (s > score) {
      score = s
      best = entry
    }
  }
  return best
}

// Java renamed some blocks after the tables of older versions were made
const JAVA_RENAMES = { short_grass: 'grass', iron_chain: 'chain', short_dry_grass: 'dead_bush', tall_dry_grass: 'dead_bush' }
// stand-ins of blocks a version does not have, before shape decides (solid: stone, else air)
const STAND_INS = [[/^deepslate_(.+_ore)$/, '$1'], [/^cobbled_deepslate$/, 'cobblestone'], [/^(.+)_(stairs|slab|double_slab|wall)$/, 'stone'], [/^raw_(iron|gold|copper)_block$/, '$1_block']]

class Versions {
  constructor (recorded) {
    this.recorded = recorded
    this.tables = new Map()
    this.states = new Map()
    this.b2j = indexTable(dataFile(recorded, 'blocksB2J'))
    // the oldest version with tables, for those before it
    this.oldestTables = Object.keys(dataPaths).filter(v => dataPaths[v].blocksJ2B).sort(compareVersions)[0]
    const shapes = dataFile(recorded, 'blockCollisionShapes')
    this.solid = name => {
      const ids = shapes?.blocks?.[name]
      const id = Array.isArray(ids) ? ids[0] : ids
      return !!(id && shapes.shapes[id]?.length)
    }
  }

  // a version's states: name -> [{ states, props, isDefault }]
  statesOf (version) {
    if (!this.states.has(version)) {
      const byName = new Map()
      const blocks = dataFile(version, 'blocks')
      const defaults = new Set(blocks.map(b => b.defaultState))
      dataFile(version, 'blockStates').forEach((state, index) => {
        if (!byName.has(state.name)) byName.set(state.name, [])
        byName.get(state.name).push({ states: state.states ?? {}, props: propsOf(state.states), isDefault: defaults.has(index) })
      })
      this.states.set(version, byName)
    }
    return this.states.get(version)
  }

  j2b (version) {
    const from = dataPaths[version]?.blocksJ2B ? version : this.oldestTables
    if (!this.tables.has(from)) this.tables.set(from, indexTable(dataFile(from, 'blocksJ2B')))
    return this.tables.get(from)
  }

  // the state of `name` in a version nearest props, as [name, states]; null when the version has no such block
  nearest (version, name, props) {
    const candidates = this.statesOf(version).get(name)
    if (!candidates) return null
    let best = null
    let score = -Infinity
    for (const c of candidates) {
      let s = c.isDefault ? 0.5 : 0
      for (const [k, v] of Object.entries(props)) if (k in c.props) s += c.props[k] === v ? 1 : -1
      if (s > score) {
        score = s
        best = c
      }
    }
    return [name, best.states]
  }

  // what a block of the world is in a version: [name, states], or null (air); and how it was found
  map (version, name, states) {
    if (name === 'air') return { target: null, how: 'same' }
    const props = propsOf(states)
    const same = this.nearest(version, name, props)
    if (same) return { target: same, how: 'same' }
    // through Java
    const java = bestOf(this.b2j.get(name), props)
    if (java) {
      const j = parseState(java.to)
      const table = this.j2b(version)
      const back = bestOf(table.get(j.name) ?? table.get(JAVA_RENAMES[j.name]), j.props)
      if (back) {
        const b = parseState(back.to)
        const found = this.nearest(version, b.name, b.props)
        if (found) return { target: found, how: 'java' }
      }
    }
    for (const [pattern, replacement] of STAND_INS) {
      if (!pattern.test(name)) continue
      const found = this.nearest(version, name.replace(pattern, replacement), {})
      if (found) return { target: found, how: 'stand-in' }
    }
    if (this.solid(name)) return { target: this.nearest(version, 'stone', {}), how: 'stone' }
    return { target: null, how: 'air' }
  }
}

// ---- writing ---------------------------------------------------------------------------------------------------------

const LIQUIDS = new Set(['water', 'flowing_water', 'lava', 'flowing_lava'])

// the block at a position of a dimension, by name ('air' where nothing was kept)
function blockAt (written, dimension, x, y, z) {
  const column = written.find(c => c.dimension === dimension && c.x === x >> 4 && c.z === z >> 4)
  const section = column?.sections.find(s => s.y === y >> 4)
  if (!section) return 'air'
  const layer = section.layers[0]
  return palette[layer.palette[layer.indices[((x & 15) << 8) | ((z & 15) << 4) | (y & 15)]]][0]
}

// A spawn moved up out of the blocks it is in (a recording's spawn may be a little low: the proxy before its fix kept
// a dimension change's feet as eyes), to where two blocks of air are
function settle (written, dimension, spawn) {
  const x = Math.floor(spawn.x)
  const z = Math.floor(spawn.z)
  const free = y => !SOLID_FREE.has(blockAt(written, dimension, x, y, z)) ? false : SOLID_FREE.has(blockAt(written, dimension, x, y + 1, z))
  for (let y = Math.floor(spawn.y); y < Math.floor(spawn.y) + 8; y++) {
    if (free(y)) return y === Math.floor(spawn.y) ? spawn : { ...spawn, y }
  }
  return spawn
}

// what a player can stand in
const SOLID_FREE = new Set(['air', 'portal', 'end_portal', 'end_gateway', 'water', 'flowing_water', 'short_grass', 'tall_grass', 'torch', 'fire', 'vine', 'snow_layer'])

// The feet of a player standing on a solid block with two blocks of air over it, in the columns of a dimension
// nearest the middle of its bounds; from below in the nether (its roof is bedrock), from above elsewhere
function standingPlace (written, dimension, bounds, isAir) {
  const middle = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
  const near = written.filter(c => c.dimension === dimension).sort((a, b) => Math.hypot(a.x - middle.x, a.z - middle.z) - Math.hypot(b.x - middle.x, b.z - middle.z))
  for (const column of near.slice(0, 64)) {
    const byY = new Map(column.sections.map(s => [s.y, s]))
    const ys = column.sections.map(s => s.y)
    const name = (y, x, z) => {
      const section = byY.get(y >> 4)
      if (!section) return 'air'
      const layer = section.layers[0]
      return palette[layer.palette[layer.indices[(x << 8) | (z << 4) | (y & 15)]]][0]
    }
    const low = Math.min(...ys) * 16
    const high = Math.max(...ys) * 16 + 16
    const ground = y => { const n = name(y, 8, 8); return n !== 'air' && !LIQUIDS.has(n) }
    const open = y => name(y, 8, 8) === 'air' && name(y + 1, 8, 8) === 'air'
    const heights = []
    for (let y = low; y < high; y++) heights.push(y)
    if (dimension !== 1) heights.reverse()
    const y = heights.find(y => ground(y) && open(y + 1))
    if (y !== undefined) return { x: column.x * 16 + 8.5, y: y + 1, z: column.z * 16 + 8.5 }
  }
  return { x: middle.x * 16 + 8.5, y: dimension === 1 ? 64 : 100, z: middle.z * 16 + 8.5 }
}

async function main () {
  const info = fs.existsSync(path.join(folder, 'demo.json')) ? JSON.parse(fs.readFileSync(path.join(folder, 'demo.json'), 'utf8')) : {}
  const version = asked.version ?? info.version
  if (!version || !dataPaths[version]) throw new Error(`the world's version (${version}) is not one minecraft-data has: --version`)
  const name = asked.name ?? path.basename(path.resolve(folder)).toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  const t0 = Date.now()
  const { columns, byId, unread } = await readWorld(folder, version)
  console.log(`${name}: ${version}, ${columns.size} columns, ${palette.length} block states, ${unread} keys unread (${Date.now() - t0} ms)`)

  // the biome of each x, z: at its highest block that is not air (a world's biomes are 3D, the page's 2D)
  const biomes = []
  const biomeIndex = new Map()
  const biomeOf = id => {
    const n = byId.get(id) ?? 'plains'
    if (!biomeIndex.has(n)) {
      biomeIndex.set(n, biomes.length)
      biomes.push(n)
    }
    return biomeIndex.get(n)
  }
  const isAir = new Set(palette.map(([n], i) => n === 'air' ? i : -1))
  const written = []
  // each dimension's columns: overworld, nether, end -> { bounds, columns }
  const dimensions = {}
  for (const column of [...columns.values()].sort((a, b) => a.dimension - b.dimension || a.x - b.x || a.z - b.z)) {
    const sections = [...column.sections.values()].filter(s => s.layers.length && s.layers.some(l => l.palette.some(p => !isAir.has(p)))).sort((a, b) => a.y - b.y)
    if (!sections.length) continue
    const own = dimensions[DIMENSIONS[column.dimension]] ??= { bounds: null, columns: 0 }
    const bounds = own.bounds
    own.bounds = bounds ? { minX: Math.min(bounds.minX, column.x), maxX: Math.max(bounds.maxX, column.x), minZ: Math.min(bounds.minZ, column.z), maxZ: Math.max(bounds.maxZ, column.z) } : { minX: column.x, maxX: column.x, minZ: column.z, maxZ: column.z }
    own.columns++
    // the biomes' sections start at the dimension's bottom: -64 in the overworld (from 1.18), 0 in the others
    const lowest = column.dimension === 0 ? -4 : 0
    const map = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      const x = i >> 4
      const z = i & 15
      let top = null
      for (let s = sections.length - 1; s >= 0 && top === null; s--) {
        const layer = sections[s].layers[0]
        for (let y = 15; y >= 0; y--) {
          if (!isAir.has(layer.palette[layer.indices[(x << 8) | (z << 4) | y]])) {
            top = sections[s].y * 16 + y
            break
          }
        }
      }
      const b = column.biomes?.[((top ?? 64) >> 4) - lowest] ?? column.biomes?.[column.biomes.length - 1]
      const id = !b ? 1 : b.indices ? b.palette[b.indices[(x << 8) | (z << 4) | ((top ?? 64) & 15)]] : b.palette[0]
      map[i] = biomeOf(id)
    }
    written.push({ dimension: column.dimension, x: column.x, z: column.z, biomes: map, sections })
  }

  // where a player starts in each dimension: where the proxy saw it come in (demo.json), else a place to stand near
  // the middle of the dimension's columns (from below in the nether, whose roof is bedrock)
  for (const [dimension, own] of Object.entries(dimensions)) {
    const saw = info.spawns?.[dimension] ?? (dimension === 'overworld' ? info.spawn : undefined)
    own.spawn = saw ? settle(written, DIMENSIONS.indexOf(dimension), saw) : standingPlace(written, DIMENSIONS.indexOf(dimension), own.bounds, isAir)
    console.log(`${dimension}: ${own.columns} columns, chunks x ${own.bounds.minX}..${own.bounds.maxX} z ${own.bounds.minZ}..${own.bounds.maxZ}, spawn ${[own.spawn.x, own.spawn.y, own.spawn.z].map(n => n.toFixed(1)).join(' ')}`)
  }

  // every block in every version
  const versions = new Versions(version)
  const mapped = {}
  const report = []
  for (const v of pageVersions) {
    const blocks = {}
    const hows = {}
    palette.forEach(([n, states], i) => {
      const { target, how } = versions.map(v, n, states)
      hows[how] = (hows[how] ?? 0) + 1
      if (!target || stateKey(target[0], target[1]) !== stateKey(n, states)) blocks[i] = target
    })
    const known = new Set(dataFile(v, 'biomes').map(b => b.name))
    const biomeMap = {}
    biomes.forEach((n, i) => { if (!known.has(n)) biomeMap[i] = 'plains' })
    mapped[v] = { blocks, biomes: biomeMap }
    report.push(`${v.padEnd(9)} ${Object.entries(hows).map(([how, n]) => `${how} ${n}`).join(', ')}`)
  }
  console.log(report.join('\n'))

  const meta = { format: FORMAT, name, recorded: version, dimensions, palette, biomes, versions: mapped }
  fs.mkdirSync(out, { recursive: true })
  const bin = zlib.gzipSync(writeColumns(written), { level: 9 })
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(meta))
  fs.writeFileSync(path.join(out, name + '.bin'), bin)
  // the worlds the page offers
  const indexFile = path.join(out, 'index.json')
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')).filter(w => w.name !== name) : []
  index.push({ name, recorded: version, dimensions: Object.fromEntries(Object.entries(dimensions).map(([d, own]) => [d, own.columns])), bytes: bin.length })
  fs.writeFileSync(indexFile, JSON.stringify(index.sort((a, b) => a.name.localeCompare(b.name)), null, 2) + '\n')
  console.log(`wrote ${path.join(out, name)}.json (${(fs.statSync(path.join(out, name + '.json')).size / 1024).toFixed(0)} KB) and .bin (${(bin.length / 1024 / 1024).toFixed(1)} MB), ${written.length} columns`)
}

main().catch(err => {
  console.error(err.stack ?? err)
  process.exit(1)
})
