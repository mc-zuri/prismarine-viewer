// The world as the physics engine reads it (bedrock-demo packages/bedrock-client/src/movement/world-view.ts): a block of
// prismarine-block (its collision shapes are the version's) with the liquid a waterlogged block holds as `liquid`
// (prismarine-chunk's layer 1), a section asked for and not arrived as the solid placeholder the game fills it with,
// and a column not loaded as a floor under the player, so that a player ahead of its chunks stands where it is.

function worldView (client) {
  const { registry, Block } = client
  const floor = (registry.blocksByName.invisible_bedrock ?? registry.blocksByName.bedrock).defaultState
  // the vanilla client fills each requested section with this solid cube until it arrives
  const placeholder = (registry.blocksByName.client_request_placeholder_block ?? registry.blocksByName.bedrock).defaultState
  const air = registry.blocksByName.air.defaultState
  // one block a state: prismarine-block hashes the state on each construction from 1.19.80, and the engine reads
  // blocks many times a tick
  const blocks = new Map()
  const blockOf = stateId => {
    let block = blocks.get(stateId)
    if (!block) {
      block = Block.fromStateId(stateId, 0)
      blocks.set(stateId, block)
    }
    return block
  }

  return {
    blockOf,
    getBlock (pos) {
      const x = Math.floor(pos.x)
      const y = Math.floor(pos.y)
      const z = Math.floor(pos.z)
      const column = client.chunks.loadedColumn(x >> 4, z >> 4)
      if (!column) return y < Math.floor(client.player?.pos.y ?? -Infinity) ? blockOf(floor) : null
      if (y < column.minCY * 16 || y >= column.maxCY * 16) return null
      if (client.chunks.pending(x, y, z)) return blockOf(placeholder)
      const at = { x: x & 15, y, z: z & 15, l: 0 }
      const block = blockOf(column.getBlockStateId(at) ?? air)
      at.l = 1
      const liquid = column.getBlockStateId(at) ?? air
      if (liquid === air) return block
      const waterlogged = Object.create(block)
      waterlogged.liquid = blockOf(liquid)
      return waterlogged
    },
    loaded (pos) {
      return !!client.chunks.loadedColumn(Math.floor(pos.x) >> 4, Math.floor(pos.z) >> 4)
    }
  }
}

module.exports = { worldView }
