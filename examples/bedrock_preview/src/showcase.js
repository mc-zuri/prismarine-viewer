// The showcase world of world.html, without the page: the blueprint of what stands where (biomes that tint their
// grass, leaves and water; a pond, a waterfall, lava; a house whose stairs roof turns its corners; fences, panes and a
// door; beds, banners, chests, heads, signs and lanterns with their block entities; redstone, tripwire, chorus, snow
// and vines shaped by their neighbours; trees, a farm and a pen), in the block states of a version.
//
// world.js draws it in the page; the gameplay page's server (gameplayServer.js) sends it, with plain ground around
// it, through showcaseWorld(): { spawn, column(cx, cz) }, the world source a server streams from.
const { Vec3 } = require('vec3')
const { stairsCorner } = require('../../../viewer/lib/bedrockStates')

// the ground: its top is the layer under G
const G = 64
// the world: chunks -2..1 each way
const MIN = -32
const MAX = 32

// ---- blocks ------------------------------------------------------------------------------------------------------

// The world as placed: 'x,y,z' -> { name, props, entity (its block entity's values), water (water in it) }
function blueprint () {
  const blocks = new Map()
  const key = (x, y, z) => `${x},${y},${z}`
  const set = (x, y, z, name, props = {}, extra = {}) => blocks.set(key(x, y, z), { name, props, ...extra })
  const get = (x, y, z) => blocks.get(key(x, y, z))
  const fill = (x0, y0, z0, x1, y1, z1, name, props) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, name, props)
  }
  const clear = (x, y, z) => blocks.delete(key(x, y, z))
  return { blocks, set, get, fill, clear }
}

// the biome of a place: four quarters
function biomeAt (x, z) {
  if (x < 0) return z < 0 ? 'plains' : 'swampland'
  return z < 0 ? 'cherry_grove' : 'desert'
}

function buildBlueprint () {
  const w = blueprint()
  const { set, fill } = w

  // the ground: stone, dirt, grass; sand in the desert
  for (let x = MIN; x < MAX; x++) {
    for (let z = MIN; z < MAX; z++) {
      const desert = biomeAt(x, z) === 'desert'
      for (let y = G - 8; y < G - 3; y++) set(x, y, z, 'stone')
      for (let y = G - 3; y < G - 1; y++) set(x, y, z, desert ? 'sand' : 'dirt')
      set(x, G - 1, z, desert ? 'sand' : 'grass')
    }
  }

  // the house: log corners, plank walls, glass panes, a door, and a roof of stairs in rings, whose corners turn
  const [hx0, hz0, hx1, hz1] = [-24, -26, -18, -20]
  fill(hx0, G - 1, hz0, hx1, G - 1, hz1, 'planks')
  for (let y = G; y < G + 3; y++) {
    for (let x = hx0; x <= hx1; x++) {
      for (let z = hz0; z <= hz1; z++) {
        const edgeX = x === hx0 || x === hx1
        const edgeZ = z === hz0 || z === hz1
        if (!edgeX && !edgeZ) continue
        set(x, y, z, edgeX && edgeZ ? 'log' : 'planks')
      }
    }
  }
  for (const [x, z] of [[hx0 + 2, hz1], [hx1 - 2, hz1], [hx0, hz0 + 3], [hx1, hz0 + 3], [hx0 + 3, hz0]]) set(x, G + 1, z, 'glass_pane')
  const door = { direction: 3, 'minecraft:cardinal_direction': 'south', door_hinge_bit: 0, open_bit: 0 }
  set(hx0 + 3, G, hz1, 'door', { ...door, upper_block_bit: 0 })
  set(hx0 + 3, G + 1, hz1, 'door', { ...door, upper_block_bit: 1 })
  // weirdo_direction: the side the stairs rise to: 0 east, 1 west, 2 south, 3 north
  for (let ring = 0; ring < 4; ring++) {
    const [x0, z0, x1, z1] = [hx0 - 1 + ring, hz0 - 1 + ring, hx1 + 1 - ring, hz1 + 1 - ring]
    const y = G + 3 + ring
    for (let x = x0; x <= x1; x++) {
      set(x, y, z0, 'stairs', { weirdo_direction: 2, upside_down_bit: 0 })
      set(x, y, z1, 'stairs', { weirdo_direction: 3, upside_down_bit: 0 })
    }
    for (let z = z0 + 1; z < z1; z++) {
      set(x0, y, z, 'stairs', { weirdo_direction: 0, upside_down_bit: 0 })
      set(x1, y, z, 'stairs', { weirdo_direction: 1, upside_down_bit: 0 })
    }
  }
  set(hx0 + 3, G + 7, hz0 + 3, 'planks')

  // the patio before it: beds, a double chest and a single one, banners, a sign, heads, a lantern, a torch
  fill(-27, G - 1, -18, -15, G - 1, -12, 'path')
  const beds = [[-26, 14], [-25, 11], [-24, 5], [-23, 15]]
  for (const [x, color] of beds) {
    // its foot to the south, its head to the north (direction 2)
    set(x, G, -13, 'bed', { direction: 2, head_piece_bit: 0 }, { entity: { color: { type: 'byte', value: color } } })
    set(x, G, -14, 'bed', { direction: 2, head_piece_bit: 1 }, { entity: { color: { type: 'byte', value: color } } })
  }
  const chest = { facing_direction: 3, 'minecraft:cardinal_direction': 'south' }
  set(-21, G, -17, 'chest', chest, { entity: { pairx: { type: 'int', value: -20 }, pairz: { type: 'int', value: -17 } } })
  set(-20, G, -17, 'chest', chest, { entity: { pairx: { type: 'int', value: -21 }, pairz: { type: 'int', value: -17 } } })
  set(-18, G, -17, 'chest', chest)
  // banners: their Base colours as Bedrock counts them
  for (const [x, base] of [[-21, 1], [-19, 4], [-17, 12]]) {
    set(x, G, -13, 'standing_banner', { ground_sign_direction: 0 }, { entity: { Base: { type: 'int', value: base } } })
  }
  set(hx0 + 1, G + 1, hz1 + 1, 'wall_banner', { facing_direction: 3 }, { entity: { Base: { type: 'int', value: 11 } } })
  set(-16, G, -15, 'standing_sign', { ground_sign_direction: 4 })
  set(hx1 - 1, G + 1, hz1 + 1, 'wall_sign', { facing_direction: 3 })
  // heads on the floor, each turned further
  const heads = [['skeleton_skull', 0], ['zombie_head', 2], ['creeper_head', 3], ['player_head', 4], ['piglin_head', 6]]
  heads.forEach(([name, type], i) => {
    set(-27 + i, G, -12, 'head', { facing_direction: 1, name }, { entity: { Rotation: { type: 'float', value: i * 45 }, SkullType: { type: 'byte', value: type } } })
  })
  set(-16, G, -17, 'fence')
  set(-16, G + 1, -17, 'lantern', { hanging: 0 })
  set(-15, G, -13, 'torch', { torch_facing_direction: 'top' })

  // the farm: wheat at every stage of its growth, carrots, water between
  for (let z = -26; z <= -20; z++) {
    for (let x = -31; x <= -28; x++) set(x, G - 1, z, x === -30 ? 'water' : 'farmland', { moisturized_amount: 7 })
    set(-31, G, z, 'wheat', { growth: z + 26 })
    set(-29, G, z, 'carrots', { growth: Math.min(7, z + 27) })
    set(-28, G, z, 'wheat', { growth: 7 })
  }

  // the pen: a ring of fence with a gate, grass and flowers in it
  for (let x = -14; x <= -4; x++) {
    set(x, G, -28, 'fence')
    if (x !== -9) set(x, G, -18, 'fence')
  }
  for (let z = -27; z <= -19; z++) {
    set(-14, G, z, 'fence')
    set(-4, G, z, 'fence')
  }
  set(-9, G, -18, 'fence_gate', { direction: 0, 'minecraft:cardinal_direction': 'south', open_bit: 0, in_wall_bit: 0 })
  for (const [x, z, plant] of [[-12, -26, 'tall'], [-7, -21, 'poppy'], [-6, -25, 'tall'], [-11, -20, 'dandelion'], [-10, -23, 'tall']]) set(x, G, z, plant)

  // trees: oak in the plains, cherry (or birch) by the waterfall, oak hung with vines in the swamp
  const tree = (x, z, kind, vines) => {
    for (let y = G; y < G + 5; y++) set(x, y, z, kind + '_log')
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let y = G + 3; y < G + 7; y++) {
          const r = y >= G + 5 ? 1 : 2
          if (Math.abs(dx) > r || Math.abs(dz) > r || (dx === 0 && dz === 0 && y < G + 5) || (Math.abs(dx) === r && Math.abs(dz) === r && y === G + 6)) continue
          set(x + dx, y, z + dz, kind + '_leaves')
          if (vines && Math.abs(dx) === 2 && y === G + 3) {
            for (let v = 1; v <= 2; v++) set(x + dx + Math.sign(dx), y - v + 1, z + dz, 'vine', { vine_direction_bits: dx > 0 ? 2 : 8 })
          }
        }
      }
    }
  }
  tree(-6, -8, 'oak')
  tree(-28, -6, 'oak')
  tree(22, -8, 'cherry')
  tree(28, -26, 'cherry')
  tree(-28, 24, 'oak', true)
  tree(-6, 26, 'oak', true)

  // the waterfall: a cliff, a source on it, water flowing to its edge, falling, and spreading below
  fill(6, G, -28, 14, G + 3, -16, 'stone')
  for (let z = -24; z <= -20; z++) {
    set(7, G + 4, z, 'water')
    for (let d = 1; d <= 7; d++) set(7 + d, G + 4, z, 'flowing_water', { liquid_depth: Math.ceil(d / 2) })
    for (let y = G; y <= G + 3; y++) set(15, y, z, 'flowing_water', { liquid_depth: 8 })
    for (let d = 1; d <= 7; d++) set(15 + d, G, z, 'flowing_water', { liquid_depth: d })
  }
  for (let z = -25; z <= -19; z += 6) for (let x = 6; x <= 14; x++) set(x, G + 4, z, 'stone')

  // the pond: two deep, clay under it, lily pads, seagrass and kelp in it, sugar cane by it
  for (let x = -24; x <= -10; x++) {
    for (let z = 6; z <= 18; z++) {
      const dx = (x + 17) / 7.5
      const dz = (z - 12) / 6.5
      if (dx * dx + dz * dz > 1) continue
      set(x, G - 3, z, 'clay')
      set(x, G - 2, z, 'water')
      set(x, G - 1, z, 'water')
    }
  }
  for (const [x, z] of [[-19, 10], [-14, 14], [-21, 15]]) set(x, G, z, 'waterlily')
  for (const [x, z] of [[-17, 12], [-15, 9]]) set(x, G - 2, z, 'seagrass', {}, { water: true })
  set(-20, G - 2, 13, 'kelp', { kelp_age: 4 }, { water: true })
  for (let y = G; y < G + 3; y++) set(-9, y, 11, 'reeds')

  // the desert: cacti, dead bushes, a pool of lava flowing out
  for (const [x, z] of [[6, 8], [24, 12], [14, 26]]) for (let y = G; y < G + 3; y++) set(x, y, z, 'cactus')
  for (const [x, z] of [[9, 20], [20, 5], [27, 22]]) set(x, G, z, 'deadbush')
  for (let x = 14; x <= 18; x++) for (let z = 14; z <= 18; z++) set(x, G - 1, z, 'lava')
  for (let d = 1; d <= 3; d++) set(18 + d, G - 1, 16, 'flowing_lava', { liquid_depth: d * 2 })

  // what the client shapes by its neighbours: redstone wire from a lever, over a block and down, through a repeater,
  // round a corner to a torch, and a lone wire; tripwire between two hooks; a chorus plant on end stone; grass under
  // snow; twisting vines growing up and weeping vines hanging down, each ending in its tip
  const wire = (x, z, signal, y = G) => set(x, y, z, 'redstone_wire', { redstone_signal: signal })
  set(-24, G, -5, 'lever', { lever_direction: 'up_east_west', open_bit: 1 })
  for (let x = -23; x <= -20; x++) wire(x, -5, 15 - (x + 23))
  set(-19, G, -5, 'stone')
  wire(-19, -5, 11, G + 1)
  wire(-18, -5, 10)
  set(-17, G, -5, 'unpowered_repeater', { 'minecraft:cardinal_direction': 'east', direction: 3, repeater_delay: 1 })
  for (const [x, z, signal] of [[-16, -5, 15], [-15, -5, 14], [-15, -6, 13], [-15, -7, 12]]) wire(x, z, signal)
  set(-15, G, -8, 'redstone_torch', { torch_facing_direction: 'top' })
  wire(-22, -2, 0)
  set(-24, G, -8, 'stone')
  set(-19, G, -8, 'stone')
  set(-23, G, -8, 'tripwire_hook', { 'minecraft:cardinal_direction': 'east', direction: 3, attached_bit: 1 })
  set(-20, G, -8, 'tripwire_hook', { 'minecraft:cardinal_direction': 'west', direction: 1, attached_bit: 1 })
  for (let x = -22; x <= -21; x++) set(x, G, -8, 'trip_wire', { attached_bit: 1 })
  set(-17, G - 1, -2, 'end_stone')
  for (let y = G; y <= G + 2; y++) set(-17, y, -2, 'chorus_plant')
  set(-17, G + 3, -2, 'chorus_flower')
  set(-16, G + 1, -2, 'chorus_plant')
  set(-16, G + 2, -2, 'chorus_flower')
  for (let x = -24; x <= -23; x++) for (let z = -3; z <= -1; z++) set(x, G, z, 'snow_layer', { height: 0 })
  // (and a block of grass raised beside it, so that its snowy sides show)
  set(-24, G, -4, 'grass')
  set(-24, G + 1, -4, 'snow_layer', { height: 0 })
  for (let y = G; y <= G + 2; y++) set(-20, y, -1, 'twisting_vines')
  set(-19, G + 3, -1, 'stone')
  for (let y = G + 1; y <= G + 2; y++) set(-19, y, -1, 'weeping_vines')

  return w
}

// ---- the blueprint in a version's blocks -------------------------------------------------------------------------

// The version's name and states of what the blueprint names: [name, props] of the first candidate it has
const NAMES = {
  grass: [['grass_block'], ['grass']],
  planks: [['oak_planks'], ['planks', { wood_type: 'oak' }]],
  oak_log: [['oak_log'], ['log', { old_log_type: 'oak' }]],
  log: [['oak_log'], ['log', { old_log_type: 'oak' }]],
  oak_leaves: [['oak_leaves'], ['leaves', { old_leaf_type: 'oak' }]],
  cherry_log: [['cherry_log'], ['birch_log'], ['log', { old_log_type: 'birch' }]],
  cherry_leaves: [['cherry_leaves'], ['birch_leaves'], ['leaves', { old_leaf_type: 'birch' }]],
  stairs: [['oak_stairs']],
  fence: [['oak_fence'], ['fence', { wood_type: 'oak' }]],
  fence_gate: [['fence_gate'], ['oak_fence_gate']],
  door: [['wooden_door'], ['oak_door']],
  path: [['grass_path'], ['dirt_path'], ['gravel']],
  head: [], // by name, else the skull block
  standing_sign: [['standing_sign'], ['oak_standing_sign']],
  wall_sign: [['wall_sign'], ['oak_wall_sign']],
  tall: [['short_grass'], ['tallgrass', { tall_grass_type: 'tall' }]],
  poppy: [['poppy'], ['red_flower', { flower_type: 'poppy' }]],
  dandelion: [['dandelion'], ['yellow_flower']],
  reeds: [['sugar_cane'], ['reeds']],
  deadbush: [['deadbush'], ['dead_bush']]
}

// The states of a version by name; a state's id is its runtime id: its index, or its hash once start_game has the
// registry hash them (prismarine-registry handleStartGame)
function statesOf (registry) {
  const byName = new Map()
  registry.blockStates.forEach((s, index) => {
    const id = s.stateId ?? index
    const props = {}
    for (const [k, v] of Object.entries(s.states ?? {})) props[k] = String(v.value)
    if (!byName.has(s.name)) byName.set(s.name, [])
    byName.get(s.name).push({ id, name: s.name, props })
  })
  // The state of a block that matches what props say of the states it has (others are another version's), and is
  // otherwise as near its default state as it can be
  const state = (name, props = {}) => {
    const list = byName.get(name)
    if (!list) return null
    const defaults = list.find(s => s.id === registry.blocksByName[name]?.defaultState)?.props ?? list[0].props
    const keys = Object.keys(props).filter(k => k in list[0].props)
    const matching = list.filter(s => keys.every(k => s.props[k] === String(props[k])))
    const likeDefault = s => Object.keys(s.props).filter(k => !keys.includes(k) && s.props[k] === defaults[k]).length
    return matching.sort((a, b) => likeDefault(b) - likeDefault(a))[0] ?? list[0]
  }
  // what the blueprint names, in the version
  const resolve = (name, props) => {
    if (name === 'head') {
      return state(props.name, props) ?? state('skull', props)
    }
    for (const [candidate, fixed = {}] of NAMES[name] ?? [[name]]) {
      const found = state(candidate, { ...props, ...fixed })
      if (found) return found
    }
    return null
  }
  return { state, resolve }
}

// Stairs and fences shape by their neighbours: since 1.26.50 their states say how, and the world must say it too
function shapeByNeighbours (w) {
  const fenceLike = new Set(['fence', 'fence_gate'])
  const solid = new Set(['planks', 'log', 'stone', 'glass_pane'])
  for (const [key, block] of w.blocks) {
    const [x, y, z] = key.split(',').map(Number)
    if (block.name === 'stairs') {
      const at = (dx, dz) => {
        const n = w.get(x + dx, y, z + dz)
        return n?.name === 'stairs' ? { name: 'oak_stairs', getProperties: () => ({ weirdo_direction: String(n.props.weirdo_direction), upside_down_bit: String(n.props.upside_down_bit) }) } : null
      }
      block.props['minecraft:corner'] = stairsCorner({ weirdo_direction: String(block.props.weirdo_direction), upside_down_bit: String(block.props.upside_down_bit) }, at)
    }
    if (block.name === 'fence') {
      for (const [side, dx, dz] of [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]]) {
        const n = w.get(x + dx, y, z + dz)
        block.props['minecraft:connection_' + side] = n && (fenceLike.has(n.name) || solid.has(n.name)) ? 1 : 0
      }
    }
    // (tripwire since 1.26.51)
    if (block.name === 'trip_wire') {
      for (const [side, dx, dz] of [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]]) {
        const n = w.get(x + dx, y, z + dz)
        block.props['minecraft:connection_' + side] = n?.name === 'trip_wire' || n?.name === 'tripwire_hook' ? 1 : 0
      }
    }
  }
}

// ---- the showcase as columns -------------------------------------------------------------------------------------

// The id the game keys a block entity by, for the blueprint's blocks that have one
const BLOCK_ENTITY_IDS = { bed: 'Bed', chest: 'Chest', standing_banner: 'Banner', wall_banner: 'Banner', head: 'Skull', standing_sign: 'Sign', wall_sign: 'Sign' }

// Where a player starts: its feet, in the plains between the house and the waterfall, facing the house (Bedrock
// degrees: yaw 0 faces south, 90 west, 180 north). North of it the x = 0 lane is clear to the world's edge.
const SPAWN = { x: 0.5, y: G, z: 0.5, yaw: 135, pitch: 0 }

const local = (x, y, z) => new Vec3(((x % 16) + 16) % 16, y, ((z % 16) + 16) % 16)

// A blueprint block's block entity: its values, with its id and where it is (what a column read from the network
// keys it by)
function blockEntity (block, x, y, z) {
  const int = value => ({ type: 'int', value })
  return { type: 'compound', name: '', value: { id: { type: 'string', value: BLOCK_ENTITY_IDS[block.name] ?? block.name }, x: int(x), y: int(y), z: int(z), ...block.entity } }
}

// The showcase in the block states of a registry's version: its columns ('cx,cz' -> prismarine-chunk column), how many
// blocks it has, the blueprint's names the version has no block for, and where a player starts
function buildShowcase (registry, Chunk) {
  const { resolve } = statesOf(registry)
  const w = buildBlueprint()
  shapeByNeighbours(w)
  const columns = new Map()
  const columnAt = (x, z) => {
    const k = `${Math.floor(x / 16)},${Math.floor(z / 16)}`
    if (!columns.has(k)) {
      const column = new Chunk({ x: Math.floor(x / 16), z: Math.floor(z / 16) })
      columns.set(k, column)
    }
    return columns.get(k)
  }
  const missing = new Set()
  const water = resolve('water', { liquid_depth: 0 })
  for (const [key, block] of w.blocks) {
    const [x, y, z] = key.split(',').map(Number)
    const s = resolve(block.name, block.props)
    if (!s) {
      missing.add(block.name)
      continue
    }
    const column = columnAt(x, z)
    column.setBlockStateId(local(x, y, z), s.id)
    if (block.water && water) {
      const pos = local(x, y, z)
      pos.l = 1
      column.setBlockStateId(pos, water.id)
    }
    if (block.entity) column.setBlockEntity(local(x, y, z), blockEntity(block, x, y, z))
  }
  // the biomes, each a quarter of the world
  for (let x = MIN; x < MAX; x++) {
    for (let z = MIN; z < MAX; z++) {
      const biome = registry.biomesByName[biomeAt(x, z)] ?? registry.biomesByName.birch_forest ?? registry.biomesByName.plains
      // (Bedrock keeps a biome for every block)
      for (let y = G - 8; y < G + 12; y++) columnAt(x, z).setBiomeId(local(x, y, z), biome.id)
    }
  }
  return { columns, blocks: w.blocks.size, missing, spawn: { ...SPAWN } }
}

// A column of plain ground, the showcase's layers (stone, dirt, grass) in the plains
function groundColumn (registry, Chunk, cx, cz, { resolve } = statesOf(registry)) {
  const column = new Chunk({ x: cx, z: cz })
  const layers = [[G - 8, G - 4, resolve('stone')], [G - 3, G - 2, resolve('dirt')], [G - 1, G - 1, resolve('grass')]]
  const plains = registry.biomesByName.plains
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (const [y0, y1, state] of layers) {
        for (let y = y0; y <= y1; y++) column.setBlockStateId(new Vec3(x, y, z), state.id)
      }
      for (let y = G - 8; y < G + 12; y++) column.setBiomeId(new Vec3(x, y, z), plains.id)
    }
  }
  return column
}

// The showcase as a world source, what the gameplay server streams from: where a player starts and the column at a
// chunk position. Outside the showcase's chunks the ground goes on; a column is made when first asked for and kept,
// so changes to it stay. Bedrock under all of it, so that a hole dug down ends.
function showcaseWorld (registry, Chunk) {
  const { columns, missing, spawn } = buildShowcase(registry, Chunk)
  const states = statesOf(registry)
  const bedrock = states.resolve('bedrock')
  const floor = column => {
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) column.setBlockStateId(new Vec3(x, G - 9, z), bedrock.id)
    }
    return column
  }
  for (const column of columns.values()) floor(column)
  return {
    name: 'showcase',
    spawn,
    missing,
    column (cx, cz) {
      const key = `${cx},${cz}`
      if (!columns.has(key)) columns.set(key, floor(groundColumn(registry, Chunk, cx, cz, states)))
      return columns.get(key)
    }
  }
}

module.exports = { G, MIN, MAX, SPAWN, biomeAt, buildBlueprint, statesOf, shapeByNeighbours, buildShowcase, groundColumn, showcaseWorld }
