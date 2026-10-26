/* eslint-env jest */
// The mesher's World (viewer/lib/world.js) of a Bedrock version: columns whose state ids are block network hashes, as
// a server's start_game says they are (block_network_ids_are_hashes), read with setVersion's blockHashes option; and
// columns of runtime indexes as before, with no options.
const { Vec3 } = require('vec3')
const prismarineRegistry = require('prismarine-registry')
const prismarineChunk = require('prismarine-chunk')
const { World } = require('../viewer/lib/world')

const version = 'bedrock_1.26.51'

// A column at 0, 0 of a registry with hashed ids or not: stone, and stairs facing south upside down, as JSON
function columnJson (hashed) {
  const registry = prismarineRegistry(version)
  registry.handleStartGame({ block_network_ids_are_hashes: hashed })
  const Chunk = prismarineChunk(registry)
  const column = new Chunk({ x: 0, z: 0 })
  const stairs = registry.blockStates.find(s => s.name === 'oak_stairs' && s.states.weirdo_direction.value === 2 && s.states.upside_down_bit.value === 1)
  column.setBlockStateId(new Vec3(1, 64, 2), registry.blocksByName.stone.defaultState)
  column.setBlockStateId(new Vec3(3, 65, 4), stairs.stateId)
  return { json: column.toJson(), stone: registry.blocksByName.stone.defaultState }
}

describe('bedrock World', () => {
  test('reads hashed state ids with blockHashes', () => {
    const { json, stone } = columnJson(true)
    // (a hash, not the index the version's block states have it at)
    expect(stone).not.toBe(columnJson(false).stone)
    const world = new World(version, { blockHashes: true })
    world.addColumn(0, 0, json)
    expect(world.getBlock(new Vec3(1, 64, 2)).name).toBe('stone')
    const stairs = world.getBlock(new Vec3(3, 65, 4))
    expect(stairs.name).toBe('oak_stairs')
    expect(stairs.getProperties()).toMatchObject({ weirdo_direction: 2, upside_down_bit: 1 })
    expect(world.getBlock(new Vec3(5, 64, 5)).name).toBe('air')
  })

  test('reads runtime indexes with no options, as before', () => {
    const { json } = columnJson(false)
    const world = new World(version)
    world.addColumn(0, 0, json)
    expect(world.getBlock(new Vec3(1, 64, 2)).name).toBe('stone')
    expect(world.getBlock(new Vec3(3, 65, 4)).name).toBe('oak_stairs')
  })
})
