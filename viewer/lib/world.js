const Chunks = require('prismarine-chunk')
const mcData = require('minecraft-data')

function columnKey (x, z) {
  return `${x},${z}`
}

function posInChunk (pos) {
  pos = pos.floored()
  pos.x &= 15
  pos.z &= 15
  return pos
}

function isCube (shapes) {
  if (!shapes || shapes.length !== 1) return false
  const shape = shapes[0]
  return shape[0] === 0 && shape[1] === 0 && shape[2] === 0 && shape[3] === 1 && shape[4] === 1 && shape[5] === 1
}

class World {
  constructor (version) {
    this.Chunk = Chunks(version)
    this.columns = {}
    this.blockCache = {}
    // how far each chest's lid is open, by position (models.js: block_entity.lid)
    this.lids = new Map()
    // a Java version before 1.13, whose chests pair by their neighbours; a Bedrock version before 1.2 (0.14 - 1.0),
    // whose doors keep their hinge in their upper half's data (models.js)
    const bedrock = String(version).startsWith('bedrock_')
    this.bedrock = bedrock
    this.preFlattening = !bedrock && !mcData(version).supportFeature('theFlattening')
    this.legacyDoors = bedrock && !mcData(version).blockStates
    this.biomeCache = mcData(version).biomes
    // 0 before 1.18, -64 after — used by models.js to cull out-of-world faces
    this.minY = new this.Chunk({}).minY ?? 0
  }

  addColumn (x, z, json) {
    const chunk = this.Chunk.fromJson(json)
    this.columns[columnKey(x, z)] = chunk
    return chunk
  }

  removeColumn (x, z) {
    delete this.columns[columnKey(x, z)]
  }

  getColumn (x, z) {
    return this.columns[columnKey(x, z)]
  }

  // layer: Bedrock's second block layer (1: the water a block stands in), or the block's own (0)
  setBlockStateId (pos, stateId, layer = 0) {
    const key = columnKey(Math.floor(pos.x / 16) * 16, Math.floor(pos.z / 16) * 16)

    const column = this.columns[key]
    // null column means chunk not loaded
    if (!column) return false

    const loc = posInChunk(pos.floored())
    if (layer) loc.l = layer
    column.setBlockStateId(loc, stateId)

    return true
  }

  // tag: the block entity's NBT, or none to remove it
  setBlockEntity (pos, tag) {
    const column = this.columns[columnKey(Math.floor(pos.x / 16) * 16, Math.floor(pos.z / 16) * 16)]
    if (!column?.setBlockEntity) return false
    const loc = posInChunk(pos.floored())
    if (tag) column.setBlockEntity({ x: loc.x, y: loc.y, z: loc.z }, tag)
    else column.removeBlockEntity?.({ x: loc.x, y: loc.y, z: loc.z })
    return true
  }

  getBlock (pos, layer = 0) {
    const key = columnKey(Math.floor(pos.x / 16) * 16, Math.floor(pos.z / 16) * 16)

    const column = this.columns[key]
    // null column means chunk not loaded
    if (!column) return null

    const loc = pos.floored()
    const locInChunk = posInChunk(loc)
    // layer 1: Bedrock keeps the water a block stands in (seagrass, a waterlogged stair) in a second layer of its sub
    // chunk; a column of one layer gives its block
    if (layer) locInChunk.l = layer
    const stateId = column.getBlockStateId(locInChunk)

    if (!this.blockCache[stateId]) {
      const b = column.getBlock(locInChunk)
      b.isCube = isCube(b.shapes)
      this.blockCache[stateId] = b
    }

    const block = this.blockCache[stateId]
    block.position = loc
    // a Bedrock column gives the biome itself, a Java one its id
    const biome = column.getBiome(locInChunk)
    block.biome = this.biomeCache[typeof biome === 'object' ? biome.id : biome]
    if (block.biome === undefined) {
      block.biome = this.biomeCache[1]
    }
    return block
  }

  // the block entity at a position, as its NBT (a Bedrock column keeps them), or null
  getBlockEntity (pos) {
    const column = this.columns[columnKey(Math.floor(pos.x / 16) * 16, Math.floor(pos.z / 16) * 16)]
    return column?.getBlockEntity?.(posInChunk(pos)) ?? null
  }

  // how far the lid of the chest at a position is open: a step from 0 (shut) on
  setLid (pos, step) {
    const key = `${pos.x},${pos.y},${pos.z}`
    if (step) this.lids.set(key, step)
    else this.lids.delete(key)
  }

  getLid (pos) {
    return this.lids.get(`${pos.x},${pos.y},${pos.z}`) ?? 0
  }
}

module.exports = { World }
