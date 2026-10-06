// The blocks as the pathfinder reads them (bedrock-demo packages/bedrock-client-pathfinder/src/blocks.ts). A search
// asks for thousands of blocks: what it reads of a block (its type, shapes and bounding box, how long it takes to break)
// is kept per state id, and the state id is read from the column, without a prismarine-block for each. A block the
// client does not have yet (no column, a section asked for and not arrived) is null, so the search does not plan
// through it; a section the server did not send (all air) is air. Bedrock has flowing water and lava as blocks of their
// own, which the pathfinder knows as water and lava. A state the player walks through (an open gate) is empty, though
// its kind of block is solid in the registry.
const { Vec3 } = require('vec3')

const FLOWING = { flowing_water: 'water', flowing_lava: 'lava' }

function blockReader (client) {
  const { registry, Block } = client
  const facts = new Map()
  const air = registry.blocksByName.air.defaultState

  function factsOf (stateId) {
    let known = facts.get(stateId)
    if (!known) {
      const block = Block.fromStateId(stateId, 0)
      const still = registry.blocksByName[FLOWING[block.name]]
      const shapes = block.shapes ?? []
      known = { type: still?.id ?? block.type, name: block.name, stateId, boundingBox: shapes.length ? block.boundingBox : 'empty', shapes, digTime: block.digTime.bind(block) }
      facts.set(stateId, known)
    }
    return known
  }

  return position => {
    const x = Math.floor(position.x)
    const y = Math.floor(position.y)
    const z = Math.floor(position.z)
    const column = client.chunks.loadedColumn(x >> 4, z >> 4)
    if (!column || y < column.minCY * 16 || y >= column.maxCY * 16 || client.chunks.pending(x, y, z)) return null
    const stateId = column.getBlockStateId({ x: x & 15, y, z: z & 15 }) ?? air
    // the pathfinder writes what it works out of a block onto it: a copy for each
    return { ...factsOf(stateId), position: new Vec3(x, y, z) }
  }
}

module.exports = { blockReader }
