// A world recorded from a Bedrock server (or any world on disk), made by worldImport.js into what the gameplay server
// can send in every version: its blocks named by name and states, each also as every version has it (the importer
// worked that out once: the same block, the block it was before Bedrock's flattening, or a stand-in where the version
// has none), its biomes by name, and each of its dimensions (overworld, nether, end) apart. The server builds a column
// from it when the column is first asked for.
//
//   <name>.json   { format, name, recorded, dimensions: { overworld|nether|end: { spawn, bounds, columns } },
//                   palette: [[name, states]], biomes: [name],
//                   versions: { version: { blocks: { index: [name, states] | null }, biomes: { index: name } } } }
//   <name>.bin    gzip of the columns, one after another (little endian):
//                   u8 dimension (0 overworld, 1 nether, 2 end), i32 x, i32 z, u8 biomes[256] (an index into biomes,
//                   by x * 16 + z), u8 sections, and each section:
//                   i8 y, u8 layers, and each layer: u16 palette size, u16 palette[size] (indices into palette),
//                   4096 entries (u8, or u16 where the palette has more than 256) in the game's order (x << 8 | z << 4 | y)
const { Vec3 } = require('vec3')

const FORMAT = 2
// the dimensions by number, as the game keys them
const DIMENSIONS = ['overworld', 'nether', 'end']
const stateKey = (name, states) => name + '|' + Object.keys(states ?? {}).sort().map(k => `${k}=${states[k].value}`).join(',')
const HEAD = 266

// ---- the columns, written and read --------------------------------------------------------------------------------

// columns: [{ dimension, x, z, biomes: Uint8Array(256), sections: [{ y, layers: [{ palette: [index], indices: Uint16Array(4096) }] }] }]
function writeColumns (columns) {
  const parts = []
  for (const column of columns) {
    const head = Buffer.alloc(HEAD)
    head.writeUInt8(column.dimension, 0)
    head.writeInt32LE(column.x, 1)
    head.writeInt32LE(column.z, 5)
    Buffer.from(column.biomes.buffer, column.biomes.byteOffset, 256).copy(head, 9)
    head.writeUInt8(column.sections.length, 265)
    parts.push(head)
    for (const section of column.sections) {
      parts.push(Buffer.from([section.y & 0xff, section.layers.length]))
      for (const layer of section.layers) {
        const wide = layer.palette.length > 256
        const buffer = Buffer.alloc(2 + layer.palette.length * 2 + 4096 * (wide ? 2 : 1))
        buffer.writeUInt16LE(layer.palette.length, 0)
        layer.palette.forEach((index, i) => buffer.writeUInt16LE(index, 2 + i * 2))
        const at = 2 + layer.palette.length * 2
        for (let i = 0; i < 4096; i++) {
          if (wide) buffer.writeUInt16LE(layer.indices[i], at + i * 2)
          else buffer[at + i] = layer.indices[i]
        }
        parts.push(buffer)
      }
    }
  }
  return Buffer.concat(parts)
}

// where each column starts: 'dimension:x,z' -> offset
function indexColumns (bin) {
  const index = new Map()
  let o = 0
  while (o < bin.length) {
    index.set(`${bin[o]}:${bin.readInt32LE(o + 1)},${bin.readInt32LE(o + 5)}`, o)
    const count = bin[o + 265]
    o += HEAD
    for (let s = 0; s < count; s++) {
      const layers = bin[o + 1]
      o += 2
      for (let l = 0; l < layers; l++) {
        const size = bin.readUInt16LE(o)
        o += 2 + size * 2 + 4096 * (size > 256 ? 2 : 1)
      }
    }
  }
  return index
}

// the column at an offset, read back as writeColumns took it
function readColumn (bin, o) {
  const column = { dimension: bin[o], x: bin.readInt32LE(o + 1), z: bin.readInt32LE(o + 5), biomes: bin.subarray(o + 9, o + 265), sections: [] }
  const count = bin[o + 265]
  o += HEAD
  for (let s = 0; s < count; s++) {
    const section = { y: bin.readInt8(o), layers: [] }
    const layers = bin[o + 1]
    o += 2
    for (let l = 0; l < layers; l++) {
      const size = bin.readUInt16LE(o)
      const palette = []
      for (let i = 0; i < size; i++) palette.push(bin.readUInt16LE(o + 2 + i * 2))
      o += 2 + size * 2
      const wide = size > 256
      const indices = new Uint16Array(4096)
      for (let i = 0; i < 4096; i++) indices[i] = wide ? bin.readUInt16LE(o + i * 2) : bin[o + i]
      o += 4096 * (wide ? 2 : 1)
      section.layers.push({ palette, indices })
    }
    column.sections.push(section)
  }
  return column
}

// ---- the world source -----------------------------------------------------------------------------------------------

// A dimension of the recorded world as a world source (showcase.js showcaseWorld's interface, and the dimension: 0
// overworld, 1 nether, 2 end), in the version of a registry (with its state ids: hashes once start_game had it hash
// them). meta: <name>.json; bin: <name>.bin unzipped (a Buffer); dimension: overworld, nether or end.
function recordedWorld (registry, Chunk, meta, bin, dimension = 'overworld') {
  if (meta.format !== FORMAT) throw new Error(`world ${meta.name}: format ${meta.format}, this reads ${FORMAT}: import it again (worldImport.js)`)
  const own = meta.dimensions[dimension]
  if (!own) throw new Error(`world ${meta.name} has no ${dimension}`)
  const dimensionId = DIMENSIONS.indexOf(dimension)
  const version = registry.version.minecraftVersion
  const mapping = meta.versions[version] ?? { blocks: {}, biomes: {} }
  // this version's states by name and states
  const states = new Map()
  registry.blockStates.forEach((state, index) => states.set(stateKey(state.name, state.states), state.stateId ?? index))
  const air = registry.blocksByName.air.defaultState
  const missing = new Set()
  // what each entry of the world's palette is in this version
  const stateIds = meta.palette.map(([name, entryStates], i) => {
    const target = i in mapping.blocks ? mapping.blocks[i] : [name, entryStates]
    if (!target) return air
    const id = states.get(stateKey(target[0], target[1])) ?? registry.blocksByName[target[0]]?.defaultState
    if (id === undefined) missing.add(target[0])
    return id ?? air
  })
  const plains = registry.biomesByName.plains?.id ?? 1
  const biomeIds = meta.biomes.map((name, i) => registry.biomesByName[mapping.biomes[i] ?? name]?.id ?? plains)

  const offsets = indexColumns(bin)
  const columns = new Map()
  const threeD = registry.version['>=']('1.18.0')

  function build (cx, cz) {
    const column = new Chunk({ x: cx, z: cz })
    const offset = offsets.get(`${dimensionId}:${cx},${cz}`)
    if (offset === undefined) return column
    const stored = readColumn(bin, offset)
    const pos = new Vec3(0, 0, 0)
    let low = Infinity
    let high = -Infinity
    for (const section of stored.sections) {
      // (a version before 1.18 has no blocks under y 0)
      if (section.y < column.minCY || section.y >= column.maxCY) continue
      low = Math.min(low, section.y * 16)
      high = Math.max(high, section.y * 16 + 16)
      section.layers.forEach((layer, l) => {
        const ids = layer.palette.map(index => stateIds[index])
        pos.l = l
        for (let i = 0; i < 4096; i++) {
          const id = ids[layer.indices[i]]
          if (id === air) continue
          pos.x = i >> 8
          pos.z = (i >> 4) & 15
          pos.y = section.y * 16 + (i & 15)
          column.setBlockStateId(pos, id)
        }
      })
    }
    // the biome of each x, z, through the column's height (one per x, z before 1.18)
    if (low < high) {
      const at = new Vec3(0, 0, 0)
      for (let i = 0; i < 256; i++) {
        at.x = i >> 4
        at.z = i & 15
        const id = biomeIds[stored.biomes[i]]
        if (!threeD) {
          at.y = 0
          column.setBiomeId(at, id)
          continue
        }
        for (at.y = low; at.y < high; at.y++) column.setBiomeId(at, id)
      }
    }
    return column
  }

  // where the blocks of a name stand in the dimension, as recorded (by the world's own names: a nether portal is
  // portal, an end portal end_portal)
  const found = new Map()
  function find (name) {
    if (found.has(name)) return found.get(name)
    const wanted = new Set(meta.palette.map(([n], i) => n === name ? i : -1).filter(i => i >= 0))
    const positions = []
    for (const [key, offset] of offsets) {
      if (!key.startsWith(`${dimensionId}:`)) continue
      const stored = readColumn(bin, offset)
      for (const section of stored.sections) {
        const layer = section.layers[0]
        if (!layer.palette.some(index => wanted.has(index))) continue
        for (let i = 0; i < 4096; i++) {
          if (wanted.has(layer.palette[layer.indices[i]])) positions.push({ x: stored.x * 16 + (i >> 8), y: section.y * 16 + (i & 15), z: stored.z * 16 + ((i >> 4) & 15) })
        }
      }
    }
    found.set(name, positions)
    return positions
  }

  return {
    name: dimension === 'overworld' ? meta.name : `${meta.name} (${dimension})`,
    dimension: dimensionId,
    spawn: { yaw: 0, pitch: 0, ...own.spawn },
    missing,
    find,
    column (cx, cz) {
      const key = `${cx},${cz}`
      if (!columns.has(key)) columns.set(key, build(cx, cz))
      return columns.get(key)
    }
  }
}

module.exports = { FORMAT, DIMENSIONS, stateKey, writeColumns, indexColumns, readColumn, recordedWorld }
