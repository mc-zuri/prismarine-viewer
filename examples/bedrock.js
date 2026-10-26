// A Bedrock world in the standalone viewer: a stone floor with a row of Bedrock blocks on it.
// node examples/bedrock.js [version], then open http://localhost:3000
const standaloneViewer = require('prismarine-viewer').standalone
const { Vec3 } = require('vec3')

const version = 'bedrock_' + (process.argv[2] ?? '1.21.0')

const World = require('prismarine-world')(version)
const Chunk = require('prismarine-chunk')(version)
const registry = require('minecraft-data')(version)

const state = name => registry.blocksByName[name].defaultState

const world = new World((chunkX, chunkZ) => {
  const chunk = new Chunk({ x: chunkX, z: chunkZ })
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) chunk.setBlockStateId(new Vec3(x, 0, z), state('stone'))
  }
  return chunk
})

const blocks = ['grass_block', 'oak_log', 'oak_leaves', 'oak_stairs', 'cobblestone_wall', 'torch', 'lantern', 'glass',
  'water', 'furnace', 'chest', 'short_grass', 'poppy', 'oak_fence', 'iron_bars', 'rail', 'redstone_wire', 'ladder']
  .filter(name => registry.blocksByName[name])

;(async () => {
  for (const [i, name] of blocks.entries()) await world.setBlockStateId(new Vec3(i * 2 - blocks.length, 1, 0), state(name))
  standaloneViewer({ version, world, center: new Vec3(0, 3, 0), port: 3000 })
})()
