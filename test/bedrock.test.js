/**
 * @jest-environment node
 */
/* eslint-env jest */

// Bedrock worlds through the worker's World and the mesher: columns built here with prismarine-chunk, drawn with
// blocksStates made from small Java-format assets (as minecraft-assets has a Bedrock version's)
const { Vec3 } = require('vec3')
const { World } = require('../viewer/lib/world')
const { getSectionGeometry } = require('../viewer/lib/models')
const { prepareBlocksStates } = require('../viewer/lib/modelsBuilder')
const { stairsCorner } = require('../viewer/lib/bedrockStates')
const { getVersion, nearestBedrockVersion, viewerVersion, viewerWorldOptions, bedrockSupportedVersions } = require('../viewer/lib/version')

// a column of a version, in one id space, with helpers to place blocks
function setup (version, { hashes = false } = {}) {
  const registry = require('prismarine-registry')('bedrock_' + version)
  if (hashes) registry.handleStartGame({ block_network_ids_are_hashes: true, itemstates: [] })
  const Chunk = require('prismarine-chunk')(registry)
  const column = new Chunk({ x: 0, z: 0 })
  // a registry start_game did not remap keeps blockStates indexes as state ids
  const state = (name, props = {}) => {
    const i = registry.blockStates.findIndex(s => s.name === name &&
      Object.entries(props).every(([k, v]) => String(s.states[k]?.value) === String(v)))
    if (i === -1) throw new Error(`${version} has no state ${name} ${JSON.stringify(props)}`)
    return registry.blockStates[i].stateId ?? i
  }
  const set = (x, y, z, id, l = 0) => {
    const pos = new Vec3(x, y, z)
    pos.l = l
    column.setBlockStateId(pos, id)
  }
  const load = (options = { blockHashes: hashes }, render = {}) => {
    const world = new World('bedrock_' + version, options)
    world.setRender(render)
    world.addColumn(0, 0, column.toJson())
    return world
  }
  return { registry, column, state, set, load }
}

// Java-format assets for a few blocks, and their blocksStates as prerender.js makes them
const FACES = ['down', 'up', 'north', 'south', 'west', 'east']
const box = (from, to, tint) => ({ from, to, faces: Object.fromEntries(FACES.map(f => [f, { texture: '#all', ...(tint ? { tintindex: 0 } : {}) }])) })
function blocksStatesOf (blocksStates, tints) {
  const atlas = { json: { textures: { missing_texture: { u: 0, v: 0, su: 0.5, sv: 0.5 }, stone: { u: 0.5, v: 0, su: 0.5, sv: 0.5 }, water: { u: 0, v: 0.5, su: 0.5, sv: 0.5 } } } }
  const blocksModels = {
    cube_all: { elements: [box([0, 0, 0], [16, 16, 16])] },
    stone: { parent: 'block/cube_all', textures: { all: 'blocks/stone' } },
    tinted: { elements: [box([0, 0, 0], [16, 16, 16], true)], textures: { all: 'blocks/stone' } },
    post: { elements: [box([6, 0, 6], [10, 16, 10])], textures: { all: 'blocks/stone' } },
    arm_north: { elements: [box([7, 12, 0], [9, 15, 6])], textures: { all: 'blocks/stone' } },
    water: { textures: { particle: 'blocks/water', flow: 'blocks/water' } }
  }
  const states = prepareBlocksStates({ blocksStates, blocksModels, tints }, atlas)
  return JSON.parse(JSON.stringify(states))
}

// the extent of the vertices drawn within one block, in sixteenths (section-local positions are centred)
function extent (geometry, x, y, z) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const p = geometry.positions
  for (let i = 0; i < p.length; i += 3) {
    const v = [p[i] + 8 - x, p[i + 1] + 8 - (y & 15), p[i + 2] + 8 - z]
    if (v.some(c => c < -0.001 || c > 1.001)) continue
    v.forEach((c, j) => { min[j] = Math.min(min[j], c); max[j] = Math.max(max[j], c) })
  }
  return { min: min.map(c => Math.round(c * 16)), max: max.map(c => Math.round(c * 16)) }
}

// whether the fence at x, y, z has its north arm: vertices on the block's north edge, in its middle (the block north
// of it has a face there too, but across the whole edge)
function northArm (geometry, x, y, z) {
  const p = geometry.positions
  for (let i = 0; i < p.length; i += 3) {
    const v = [p[i] + 8 - x, p[i + 1] + 8 - (y & 15), p[i + 2] + 8 - z]
    if (Math.abs(v[2]) < 0.001 && v[0] > 0.4 && v[0] < 0.6 && v[1] > 0 && v[1] < 1) return true
  }
  return false
}

describe('bedrock versions', () => {
  test('resolve to bedrock assets only', () => {
    expect(getVersion('bedrock_1.26.51')).toBe('bedrock_1.26.51')
    expect(getVersion('bedrock_1.16.201')).toBe('bedrock_1.16.201')
    // a newer patch: the newest of its major
    expect(getVersion('bedrock_1.26.52')).toBe('bedrock_1.26.51')
    expect(getVersion('bedrock_1.21.131')).toBe('bedrock_1.21.130')
    expect(getVersion('bedrock_1.15.0')).toBeNull()
    expect(getVersion('1.26.51')).toBeNull()
  })

  test('without assets of their own, take those of the nearest built version of their major', () => {
    const built = ['bedrock_1.16.220', 'bedrock_1.21.130', 'bedrock_1.21.20', 'bedrock_1.26.51']
    expect(nearestBedrockVersion('bedrock_1.26.51', built)).toBe('bedrock_1.26.51')
    expect(nearestBedrockVersion('bedrock_1.21.60', built)).toBe('bedrock_1.21.20')
    expect(nearestBedrockVersion('bedrock_1.21.2', built)).toBe('bedrock_1.21.20')
    expect(nearestBedrockVersion('bedrock_1.16.201', built)).toBe('bedrock_1.16.220')
    expect(nearestBedrockVersion('bedrock_1.17.0', built)).toBeNull()
  })

  test('are those minecraft-data has the block states of', () => {
    const dataPaths = require('minecraft-data/minecraft-data/data/dataPaths.json').bedrock
    const withStates = Object.keys(dataPaths).filter(v => dataPaths[v].blockStates).map(v => 'bedrock_' + v)
    expect([...bedrockSupportedVersions].sort()).toEqual(withStates.sort())
  })

  test('a bedrock bot is shown as its prefixed version, in the id space of its registry', () => {
    const registry = require('prismarine-registry')('bedrock_1.26.51')
    const bot = { edition: 'bedrock', version: '1.26.51', registry, _client: { startGameData: { block_network_ids_are_hashes: true } } }
    expect(viewerVersion(bot)).toBe('bedrock_1.26.51')
    // the columns carry the registry's ids: indexes until it is remapped
    expect(viewerWorldOptions(bot)).toEqual({ blockHashes: false })
    registry.handleStartGame({ block_network_ids_are_hashes: true, itemstates: [] })
    expect(viewerWorldOptions(bot)).toEqual({ blockHashes: true })
    expect(viewerVersion({ version: '1.21.4', registry: { type: 'pc' } })).toBe('1.21.4')
  })
})

describe.each([
  ['1.16.220', false],
  ['1.21.130', false],
  ['1.26.51', false],
  ['1.26.51', true]
])('bedrock %s world (hashes: %s)', (version, hashes) => {
  test('blocks read back with their names, states and liquid layer', () => {
    const { state, set, load } = setup(version, { hashes })
    set(1, 64, 1, state('stone'))
    set(2, 64, 1, state('seagrass'))
    set(2, 64, 1, state('water', { liquid_depth: 0 }), 1)
    set(3, 64, 1, state('water', { liquid_depth: 3 }))
    for (const world of [load(), load({})]) { // told the id space, and finding it out
      const stone = world.getBlock(new Vec3(1, 64, 1))
      expect(stone.name).toBe('stone')
      const seagrass = world.getBlock(new Vec3(2, 64, 1))
      expect(seagrass.name).toBe('seagrass')
      expect(seagrass.liquidLayer?.name).toBe('water')
      const water = world.getBlock(new Vec3(3, 64, 1))
      expect(water.liquid).toBe('water')
      expect(water.metadata).toBe(3)
      expect(world.getBlock(new Vec3(4, 64, 1)).name).toBe('air')
      expect(world.getBlock(new Vec3(1, 64, 1)).biome).toBeDefined()
    }
  })

  test('block updates reach either layer', () => {
    const { state, set, load } = setup(version, { hashes })
    set(1, 64, 1, state('stone'))
    const world = load()
    world.setBlockStateId(new Vec3(1, 64, 1), state('seagrass'))
    world.setBlockStateId(new Vec3(1, 64, 1), state('water', { liquid_depth: 0 }), 1)
    const block = world.getBlock(new Vec3(1, 64, 1))
    expect(block.name).toBe('seagrass')
    expect(block.liquidLayer?.name).toBe('water')
  })

  test('block entities come with the column, and with updates', () => {
    const { column, state, set, load } = setup(version, { hashes })
    set(1, 64, 1, state('stone'))
    column.setBlockEntity(new Vec3(1, 64, 1), { type: 'compound', name: '', value: { color: { type: 'byte', value: 3 } } })
    const world = load()
    expect(world.getBlockEntity(new Vec3(1, 64, 1)).value.color.value).toBe(3)
    world.setBlockEntity(new Vec3(1, 64, 1), { type: 'compound', name: '', value: { color: { type: 'byte', value: 5 } } })
    expect(world.getBlockEntity(new Vec3(1, 64, 1)).value.color.value).toBe(5)
  })
})

describe('bedrock meshing', () => {
  test('a block with no Java name draws with its own blockstate', () => {
    const { state, set, load } = setup('1.26.51')
    set(1, 64, 1, state('stone'))
    const world = load()
    const blocksStates = blocksStatesOf({ stone: { variants: { '': { model: 'block/stone' } } } })
    const geometry = getSectionGeometry(0, 64, 0, world, blocksStates)
    expect(extent(geometry, 1, 64, 1)).toEqual({ min: [0, 0, 0], max: [16, 16, 16] })
  })

  test('fences take the arms their neighbours give them when their states do not say', () => {
    const { registry, state, set, load } = setup('1.21.130')
    const fence = registry.blocksByName.oak_fence ? 'oak_fence' : 'fence'
    set(1, 64, 1, state(fence))
    set(1, 64, 0, state('stone'))
    const world = load(undefined, { [fence]: { connect: 'fence' }, stone: { cube: true } })
    const blocksStates = blocksStatesOf({
      [fence]: { multipart: [{ apply: { model: 'block/post' } }, { when: { 'minecraft:connection_north': '1' }, apply: { model: 'block/arm_north' } }] },
      stone: { variants: { '': { model: 'block/stone' } } }
    })
    expect(northArm(getSectionGeometry(0, 64, 0, world, blocksStates), 1, 64, 1)).toBe(true)

    // alone: the post only
    world.setBlockStateId(new Vec3(1, 64, 0), state('air'))
    expect(northArm(getSectionGeometry(0, 64, 0, world, blocksStates), 1, 64, 1)).toBe(false)
    expect(extent(getSectionGeometry(0, 64, 0, world, blocksStates), 1, 64, 1).min[2]).toBe(6)

    // a whole block it sees through (a spawner) is joined, leaves are not
    for (const [name, joined] of [['mob_spawner', true], ['oak_leaves', false]]) {
      if (!registry.blocksByName[name]) continue
      world.setBlockStateId(new Vec3(1, 64, 0), state(name))
      world.setRender({ [fence]: { connect: 'fence' }, [name]: { cube: true, layer: 'cutout' } })
      expect(northArm(getSectionGeometry(0, 64, 0, world, blocksStates), 1, 64, 1)).toBe(joined)
    }
  })

  test('tinted faces take the colour of the block\'s tint method in its biome', () => {
    const { state, set, load } = setup('1.26.51')
    set(1, 64, 1, state('stone'))
    const tints = { grass: { data: [], default: 0x80ff00 }, foliage: { data: [], default: 0x0000ff } }
    const blocksStates = blocksStatesOf({ stone: { variants: { '': { model: 'block/tinted' } } } }, tints)
    const colour = render => Array.from(getSectionGeometry(0, 64, 0, load(undefined, { stone: render }), blocksStates).colors.slice(0, 3)).map(c => Math.round(c * 255))
    expect(colour({ tint: 'foliage' })).toEqual([0, 0, 255])
    expect(colour({ tint: '#208030' })).toEqual([0x20, 0x80, 0x30])
    // a method by one of the block's states (old leaves by their type)
    expect(colour({ tint: { property: 'nope', values: { birch: 'grass' }, default: 'foliage' } })).toEqual([0, 0, 255])
    expect(colour({ tint: { property: 'nope', values: {} } })).toEqual([255, 255, 255])
    // a block the assets give no tint method is not tinted, whatever its name
    expect(colour({})).toEqual([255, 255, 255])
  })

  test('old leaves take the tint method of their type', () => {
    const { state, set, load } = setup('1.16.220')
    set(1, 64, 1, state('leaves', { old_leaf_type: 'birch' }))
    set(3, 64, 1, state('leaves', { old_leaf_type: 'oak' }))
    const tints = { foliage: { data: [], default: 0x0000ff }, birch: { data: [], default: 0x00ff00 } }
    const blocksStates = blocksStatesOf({ leaves: { variants: { '': { model: 'block/tinted' } } } }, tints)
    const world = load(undefined, { leaves: { tint: { property: 'old_leaf_type', values: { birch: 'birch' }, default: 'foliage' } } })
    const geometry = getSectionGeometry(0, 64, 0, world, blocksStates)
    // the colour of the first vertex drawn within each block
    const colourAt = x => {
      for (let i = 0; i < geometry.positions.length; i += 3) {
        if (geometry.positions[i] + 8 >= x && geometry.positions[i] + 8 <= x + 1 && Math.abs(geometry.positions[i + 2] + 8 - 1.5) <= 0.5) {
          return Array.from(geometry.colors.slice(i, i + 3)).map(c => Math.round(c * 255))
        }
      }
    }
    expect(colourAt(1)).toEqual([0, 255, 0])
    expect(colourAt(3)).toEqual([0, 0, 255])
  })

  test('the water of a block\'s liquid layer is drawn with it', () => {
    const { state, set, load } = setup('1.26.51')
    set(1, 64, 1, state('stone'))
    const blocksStates = blocksStatesOf({ stone: { variants: { '': { model: 'block/post' } } }, water: { variants: { '': { model: 'block/water' } } } })
    const render = { water: { liquid: 'water' } }
    const dry = getSectionGeometry(0, 64, 0, load(undefined, render), blocksStates).positions.length
    set(1, 64, 1, state('water', { liquid_depth: 0 }), 1)
    const wet = getSectionGeometry(0, 64, 0, load(undefined, render), blocksStates).positions.length
    // the six faces of the water around the post
    expect(wet - dry).toBe(6 * 4 * 3)
  })
})

describe('stairs corners', () => {
  // weirdo_direction: 0 east, 1 west, 2 south, 3 north
  const stairs = (weirdo, upside = 0) => ({ name: 'oak_stairs', getProperties: () => ({ weirdo_direction: String(weirdo), upside_down_bit: String(upside) }) })
  const around = blocks => (dx, dz) => blocks[`${dx},${dz}`]

  test('straight alone', () => {
    expect(stairsCorner(stairs(0).getProperties(), around({}))).toBe('none')
  })

  test('outer and inner corners, as Java\'s rule turns them', () => {
    // facing east, with stairs facing north in front (east of it): an outer corner
    expect(stairsCorner(stairs(0).getProperties(), around({ '1,0': stairs(3) }))).toMatch(/^outer_/)
    // facing east, with stairs facing north behind it: an inner corner
    expect(stairsCorner(stairs(0).getProperties(), around({ '-1,0': stairs(3) }))).toMatch(/^inner_/)
    // the other half does not turn it
    expect(stairsCorner(stairs(0).getProperties(), around({ '1,0': stairs(3, 1) }))).toBe('none')
  })
})

describe('blocks drawn by their block entity', () => {
  const { connectedProperties } = require('../viewer/lib/bedrockStates')
  // a world of one block entity at 0, 0, 0
  const worldWithEntity = value => ({
    getBlockEntity: pos => pos.x === 0 && pos.y === 0 && pos.z === 0 ? { type: 'compound', name: '', value } : undefined,
    getBlock: () => ({ name: 'air' })
  })
  const at = new Vec3(0, 0, 0)
  const block = (connect, props = {}, defaults) => ({ name: connect, connect, defaults, getProperties: () => props })

  test('a banner takes its Base colour, else its default', () => {
    expect(connectedProperties(worldWithEntity({ Base: { type: 'int', value: 4 } }), at, block('banner'))).toEqual({ 'bedrock:color': '4' })
    expect(connectedProperties(worldWithEntity({}), at, block('banner', {}, { 'bedrock:color': '15' }))).toEqual({ 'bedrock:color': '15' })
  })

  test('a head on the floor takes its Rotation in 22.5° steps, a skull block its kind', () => {
    const props = connectedProperties(worldWithEntity({ Rotation: { type: 'float', value: -45 }, SkullType: { type: 'byte', value: 4 } }), at, block('skull'))
    expect(props).toEqual({ 'bedrock:rotation': '14', 'bedrock:skull_type': '4' })
    expect(connectedProperties(worldWithEntity({}), at, block('skull'))).toEqual({ 'bedrock:rotation': '0', 'bedrock:skull_type': '0' })
  })

  test('a chest is the left half of a double chest when its other half is on its right, seen from its front', () => {
    const pair = (x, z) => worldWithEntity({ pairx: { type: 'int', value: x }, pairz: { type: 'int', value: z } })
    const south = { 'minecraft:cardinal_direction': 'south' }
    // facing south: someone in front of it looks north, east (+x) is on their right
    expect(connectedProperties(pair(1, 0), at, block('chest', south))).toEqual({ 'bedrock:chest': 'left' })
    expect(connectedProperties(pair(-1, 0), at, block('chest', south))).toEqual({ 'bedrock:chest': 'right' })
    // facing east (facing_direction 5): someone in front of it looks west, north (-z) is on their right
    expect(connectedProperties(pair(0, -1), at, block('chest', { facing_direction: '5' }))).toEqual({ 'bedrock:chest': 'left' })
    // a pair in front or behind, or none: single
    expect(connectedProperties(pair(0, 1), at, block('chest', south))).toEqual({ 'bedrock:chest': 'single' })
    expect(connectedProperties(worldWithEntity({}), at, block('chest', south))).toEqual({ 'bedrock:chest': 'single' })
  })

  test('a bed without a colour of its own or of its other half takes the default', () => {
    expect(connectedProperties(worldWithEntity({}), at, block('bed', {}, { 'bedrock:color': '3' }))).toEqual({ 'bedrock:color': '3' })
    expect(connectedProperties(worldWithEntity({ color: { type: 'byte', value: 14 } }), at, block('bed', {}, { 'bedrock:color': '3' }))).toEqual({ 'bedrock:color': '14' })
  })
})

describe('blocks drawn by their neighbours', () => {
  const { connectedProperties } = require('../viewer/lib/bedrockStates')
  const at = new Vec3(0, 0, 0)
  // a world of these blocks ({ 'x,y,z': name or { name, props } }), the rest air; stone is a whole block
  const worldOf = blocks => ({
    getBlockEntity: () => undefined,
    getBlock: pos => {
      const spec = blocks[`${pos.x},${pos.y},${pos.z}`] ?? 'air'
      const { name, props = {} } = typeof spec === 'string' ? { name: spec } : spec
      return { name, isCube: name === 'stone' || name === 'end_stone', getProperties: () => props }
    }
  })
  const of = (connect, name = connect) => ({ name, connect, getProperties: () => ({}) })
  const wire = of('redstone', 'redstone_wire')
  const sides = (n, e, s, w) => ({ 'bedrock:redstone_north': n, 'bedrock:redstone_east': e, 'bedrock:redstone_south': s, 'bedrock:redstone_west': w })

  test('redstone wire alone is a full cross, and with one neighbour a line through', () => {
    expect(connectedProperties(worldOf({}), at, wire)).toEqual(sides('side', 'side', 'side', 'side'))
    expect(connectedProperties(worldOf({ '0,0,-1': 'redstone_wire' }), at, wire)).toEqual(sides('side', 'none', 'side', 'none'))
    // a corner stays a corner
    expect(connectedProperties(worldOf({ '0,0,-1': 'redstone_wire', '1,0,0': 'lever' }), at, wire)).toEqual(sides('side', 'side', 'none', 'none'))
  })

  test('redstone wire climbs to wire on the block beside it, and drops to wire below where nothing stops it', () => {
    const up = worldOf({ '1,0,0': 'stone', '1,1,0': 'redstone_wire' })
    expect(connectedProperties(up, at, wire)).toEqual(sides('none', 'up', 'none', 'side'))
    // not under a whole block
    expect(connectedProperties(worldOf({ '1,0,0': 'stone', '1,1,0': 'redstone_wire', '0,1,0': 'stone' }), at, wire)).toEqual(sides('side', 'side', 'side', 'side'))
    expect(connectedProperties(worldOf({ '-1,-1,0': 'redstone_wire' }), at, wire)).toEqual(sides('none', 'side', 'none', 'side'))
    expect(connectedProperties(worldOf({ '-1,0,0': 'stone', '-1,-1,0': 'redstone_wire' }), at, wire)).toEqual(sides('side', 'side', 'side', 'side'))
  })

  test('redstone wire runs to a repeater only along its line', () => {
    const repeater = direction => ({ name: 'unpowered_repeater', props: { 'minecraft:cardinal_direction': direction } })
    expect(connectedProperties(worldOf({ '1,0,0': repeater('east') }), at, wire)).toEqual(sides('none', 'side', 'none', 'side'))
    expect(connectedProperties(worldOf({ '1,0,0': repeater('north') }), at, wire)).toEqual(sides('side', 'side', 'side', 'side'))
  })

  test('chorus joins chorus on every side, and end stone below', () => {
    const props = connectedProperties(worldOf({ '0,1,0': 'chorus_flower', '0,-1,0': 'end_stone', '1,0,0': 'chorus_plant', '-1,0,0': 'stone' }), at, of('chorus', 'chorus_plant'))
    expect(props).toEqual({ 'bedrock:chorus_north': '0', 'bedrock:chorus_east': '1', 'bedrock:chorus_south': '0', 'bedrock:chorus_west': '0', 'bedrock:chorus_up': '1', 'bedrock:chorus_down': '1' })
  })

  test('tripwire joins the string beside it and the hooks it hangs from', () => {
    const hook = direction => ({ name: 'tripwire_hook', props: { direction } })
    // a hook to the west facing east (direction 3) holds it; one to the east facing east does not
    const props = connectedProperties(worldOf({ '-1,0,0': hook(3), '1,0,0': hook(3), '0,0,1': 'trip_wire' }), at, of('tripwire', 'trip_wire'))
    expect(props).toEqual({ 'minecraft:connection_north': '0', 'minecraft:connection_east': '0', 'minecraft:connection_south': '1', 'minecraft:connection_west': '1' })
  })

  test('grass is snowy under snow, and vines and kelp end where nothing of them follows the way they grow', () => {
    expect(connectedProperties(worldOf({ '0,1,0': 'snow_layer' }), at, of('snowy', 'grass_block'))).toEqual({ 'bedrock:snowy': '1' })
    expect(connectedProperties(worldOf({ '0,1,0': 'tall_grass' }), at, of('snowy', 'grass_block'))).toEqual({ 'bedrock:snowy': '0' })
    expect(connectedProperties(worldOf({ '0,1,0': 'kelp' }), at, of('tip', 'kelp'))).toEqual({ 'bedrock:tip': '0' })
    expect(connectedProperties(worldOf({ '0,-1,0': 'kelp' }), at, of('tip', 'kelp'))).toEqual({ 'bedrock:tip': '1' })
    expect(connectedProperties(worldOf({ '0,-1,0': 'weeping_vines' }), at, of('tip', 'weeping_vines'))).toEqual({ 'bedrock:tip': '0' })
  })
})
