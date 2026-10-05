const Chunks = require('prismarine-chunk')
const mcData = require('minecraft-data')
const { BedrockBlocks } = require('./bedrockWorld')

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
  // version: '1.21.4', or a Bedrock one with its edition prefix ('bedrock_1.26.51')
  // options.blockHashes (Bedrock): whether the columns' state ids are block network hashes
  constructor (version, options = {}) {
    this.columns = {}
    this.blockCache = {}
    if (typeof version === 'string' && version.startsWith('bedrock_')) {
      this.bedrock = new BedrockBlocks(version, options)
      this.Chunk = this.bedrock.Chunk
      this.biomeCache = this.bedrock.registry.biomes
    } else {
      this.Chunk = Chunks(version)
      this.biomeCache = mcData(version).biomes
    }
    // 0 before 1.18, -64 after — used by models.js to cull out-of-world faces
    this.minY = new this.Chunk().minY ?? 0
  }

  // what the assets say of how the game draws each block (Bedrock: blocks_render.json's blocks)
  setRender (blocks) {
    this.bedrock?.setRender(blocks)
  }

  addColumn (x, z, json) {
    if (this.bedrock) {
      if (typeof json !== 'string') json = JSON.stringify(json)
      // the ids of a Bedrock world are told by its first column, when the server did not say
      if (this.bedrock.hashed === null) this.bedrock.detectIds(JSON.parse(json))
    }
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

  // layer (Bedrock): 0 the block, 1 the liquid in it
  setBlockStateId (pos, stateId, layer = 0) {
    const key = columnKey(Math.floor(pos.x / 16) * 16, Math.floor(pos.z / 16) * 16)

    const column = this.columns[key]
    // null column means chunk not loaded
    if (!column) return false

    const loc = posInChunk(pos.floored())
    if (this.bedrock) loc.l = layer
    column.setBlockStateId(loc, stateId)

    return true
  }

  getBlock (pos) {
    const key = columnKey(Math.floor(pos.x / 16) * 16, Math.floor(pos.z / 16) * 16)

    const column = this.columns[key]
    // null column means chunk not loaded
    if (!column) return null

    const loc = pos.floored()
    const locInChunk = posInChunk(loc)
    if (this.bedrock) return this.getBedrockBlock(column, loc, locInChunk)
    const stateId = column.getBlockStateId(locInChunk)

    if (!this.blockCache[stateId]) {
      const b = column.getBlock(locInChunk)
      b.isCube = isCube(b.shapes)
      this.blockCache[stateId] = b
    }

    const block = this.blockCache[stateId]
    block.position = loc
    block.biome = this.biomeCache[column.getBiome(locInChunk)]
    if (block.biome === undefined) {
      block.biome = this.biomeCache[1]
    }
    return block
  }

  getBedrockBlock (column, loc, locInChunk) {
    locInChunk.l = 0
    const stateId = column.getBlockStateId(locInChunk) ?? this.bedrock.airStateId()
    // the liquid layer: the water of a waterlogged block, around seagrass and kelp
    locInChunk.l = 1
    const liquidId = column.getBlockStateId(locInChunk)
    const block = this.bedrock.view(stateId)
    block.position = loc
    block.biome = this.biomeCache[column.getBiomeId(locInChunk)] ?? this.biomeCache[1]
    const liquid = liquidId === undefined ? null : this.bedrock.view(liquidId)
    block.liquidLayer = liquid?.liquid ? liquid : null
    return block
  }

  // the block entity at pos (a bed's colour), as its column holds it
  getBlockEntity (pos) {
    const column = this.columns[columnKey(Math.floor(pos.x / 16) * 16, Math.floor(pos.z / 16) * 16)]
    if (!column?.getBlockEntity) return undefined
    const loc = posInChunk(pos.floored())
    return column.getBlockEntity({ x: loc.x, y: loc.y, z: loc.z })
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
}

module.exports = { World }
