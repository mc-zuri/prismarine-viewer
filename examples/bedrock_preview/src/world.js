/* global document, window, THREE */
// A world that shows what the viewer draws of a Bedrock version, built in the page for the version chosen: biomes
// that tint their grass, leaves and water differently; a pond, a waterfall and water flowing down from it, lava; a house
// whose stairs roof turns its corners; fences, panes and a door; beds, banners, chests, heads, signs and lanterns
// shaped and coloured by their block entities; redstone wire, tripwire, chorus, snowy grass and vines shaped by their
// neighbours; trees, a farm and a pen; and entities that live in it, drawn and
// animated by the viewer from the version's client entities: villagers and a golem walking, animals in the pen, a
// player sneaking in armour with a sword and a shield, one swimming, one gliding, fish, a parrot, mobs in the desert,
// things dropped on the ground; and over the desert the ender dragon, its fireballs trailing its breath and leaving a
// cloud of it where they land, and a skeleton's arrows (projectiles, with the version's particle effects).
//
// Its entities go through the viewer as a bot's would (viewer.updateEntity): spawned with what they are, then moved
// every tick.
const { Vec3 } = require('vec3')
const { preload } = require('../../../viewer/lib/mcData')
const { stairsCorner } = require('../../../viewer/lib/bedrockStates')
const { bedrockVersions, versionSelect, createViewer, viewFrom45, label } = require('./common')

// the ground: its top is the layer under G
const G = 64
// the world: chunks -2..1 each way
const MIN = -32
const MAX = 32

const element = id => document.getElementById(id)
const status = element('status')
const info = element('info')
const ui = { version: element('version'), tour: element('tour'), move: element('move'), turn: element('turn') }

const { viewer, controls: orbit } = createViewer(element('view'))
const labels = new THREE.Group()
viewer.scene.add(labels)

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

function statesOf (registry) {
  const byName = new Map()
  registry.blockStates.forEach((s, id) => {
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

// ---- entities ----------------------------------------------------------------------------------------------------

// the entities: what they are, and how they move
// path: points walked in a loop; wander: an area walked about in; circle: [x, y, z, radius]; at: where it stays; inWater: in the pond;
// equipment: what it holds and wears (the version's attachables); climate: its minecraft:climate_variant (cows, pigs and
// chickens since 1.21.70); backwards: its yaw points behind it, as a server tells of the dragon's (the client turns it
// round, as Java's does: recorded dragons fly 174–180° from their yaw)
const IRON = { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' }
const ACTORS = [
  { name: 'villager_v2', path: [[-26, -11], [-14, -11], [-14, -28], [-16, -29], [-27, -29], [-27, -14]], speed: 0.06 },
  { name: 'villager_v2', path: [[-12, -15], [-2, -15], [-2, -2], [-12, -2]], speed: 0.05 },
  { name: 'iron_golem', path: [[-2, -30], [-2, -13], [3, -13], [3, -30]], speed: 0.05 },
  { name: 'player', username: 'Steve (sneaks)', path: [[-12, -10], [4, -10], [4, 2], [-12, 2]], speed: 0.1, sneakEvery: 80, equipment: { mainhand: 'iron_sword', offhand: 'shield', ...IRON } },
  { name: 'player', username: 'Alex (swims)', skinModel: 'slim', path: [[-22, 9], [-12, 10], [-13, 15], [-21, 16]], speed: 0.08, y: G - 1.6, flags: { swimming: true }, airborne: true, inWater: true },
  { name: 'player', username: 'Glider', circle: [0, G + 22, 0, 24], speed: 0.6, flags: { gliding: true }, airborne: true, equipment: { chest: 'elytra' } },
  ...[['cow', 'temperate'], ['cow', 'warm'], ['cow', 'cold'], ['pig', 'warm'], ['pig', 'cold'], ['sheep'], ['sheep'], ['chicken', 'temperate'], ['chicken', 'cold']]
    .map(([name, climate]) => ({ name, climate, wander: [-13, -27, -5, -19], speed: 0.04 })),
  { name: 'cat', at: [-17, G, -15], flags: { sitting: true, tamed: true } },
  { name: 'wolf', at: [-25, G, -16], flags: { sitting: true, tamed: true } },
  ...[['zombie', { head: 'golden_helmet', chest: 'golden_chestplate' }], ['husk', { mainhand: 'iron_shovel' }], ['skeleton', { mainhand: 'bow', head: 'chainmail_helmet' }]]
    .map(([name, equipment]) => ({ name, equipment, wander: [4, 4, 30, 30], speed: 0.05 })),
  ...['cod', 'salmon', 'tropicalfish'].map(name => ({ name, wander: [-21, 8, -13, 16], speed: 0.04, y: G - 1.6, airborne: true, inWater: true })),
  { name: 'parrot', circle: [-6, G + 8, -8, 4], speed: 0.15, airborne: true },
  { name: 'bee', circle: [-8, G + 1.5, -22, 3], speed: 0.08, airborne: true },
  { name: 'ender_dragon', circle: [22, G + 14, 22, 9], speed: 0.35, airborne: true, backwards: true },
  { name: 'skeleton', at: [8, G, 27], equipment: { mainhand: 'bow' }, archer: true }
]
const ITEMS = [['diamond', 0, -15, -12], ['bed', 11, -14, -13], ['apple', 0, -15, -14], ['iron_sword', 0, 3, 10]]

// mineflayer's yaw of a direction: radians, 0 toward -z, turning anticlockwise seen from above
const yawOf = (dx, dz) => Math.atan2(-dx, -dz)

// an actor's entity data: its flags, and a player's box as the server tells it (lower sneaking, and as low as it is
// wide swimming or gliding), which its name stands over
function metadataOf (actor) {
  if (actor.name !== 'player') return { flags: { ...actor.flags } }
  const { sneaking, swimming, gliding } = actor.flags
  return { flags: { ...actor.flags }, boundingbox_width: 0.6, boundingbox_height: swimming || gliding ? 0.6 : sneaking ? 1.5 : 1.8 }
}

function spawnActors () {
  let id = 1
  const actors = ACTORS.map(spec => {
    const actor = { ...spec, id: id++, tick: 0, flags: { ...(spec.flags ?? {}) } }
    if (spec.path) actor.pos = new Vec3(spec.path[0][0] + 0.5, spec.y ?? G, spec.path[0][1] + 0.5)
    if (spec.wander) actor.pos = new Vec3(spec.wander[0] + Math.random() * (spec.wander[2] - spec.wander[0]), spec.y ?? G, spec.wander[1] + Math.random() * (spec.wander[3] - spec.wander[1]))
    if (spec.circle) actor.pos = new Vec3(spec.circle[0] + spec.circle[3], spec.circle[1], spec.circle[2])
    if (spec.at) actor.pos = new Vec3(spec.at[0] + 0.5, spec.at[1], spec.at[2] + 0.5)
    actor.yaw = 0
    actor.target = 1
    viewer.updateEntity({
      id: actor.id,
      name: spec.name,
      pos: actor.pos,
      yaw: actor.yaw,
      headYaw: actor.yaw,
      pitch: 0,
      width: 0.6,
      height: 1.8,
      username: spec.username,
      skinModel: spec.skinModel,
      onGround: !spec.airborne,
      // (fish swim in it, and flop out of it)
      inWater: !!spec.inWater,
      metadata: metadataOf(actor),
      equipment: spec.equipment,
      properties: spec.climate ? { 'minecraft:climate_variant': spec.climate } : undefined
    })
    return actor
  })
  for (const [name, aux, x, z] of ITEMS) {
    viewer.updateEntity({ id: id++, name: 'item', itemName: name, itemAux: aux, pos: new Vec3(x + 0.5, G, z + 0.5), width: 0.25, height: 0.25 })
  }
  return actors
}

// one tick of an actor: its next position, and what changed of it
function step (actor) {
  actor.tick++
  const update = { id: actor.id }
  let goal = null
  if (actor.path) {
    const [tx, tz] = actor.path[actor.target]
    goal = new Vec3(tx + 0.5, actor.pos.y, tz + 0.5)
    if (goal.distanceTo(actor.pos) < actor.speed * 2) actor.target = (actor.target + 1) % actor.path.length
  } else if (actor.wander) {
    if (!actor.goal || actor.goal.distanceTo(actor.pos) < 0.2) {
      const [x0, z0, x1, z1] = actor.wander
      actor.goal = new Vec3(x0 + 0.5 + Math.random() * (x1 - x0), actor.pos.y, z0 + 0.5 + Math.random() * (z1 - z0))
      actor.rest = Math.random() < 0.4 ? 20 + Math.floor(Math.random() * 60) : 0
    }
    if (actor.rest > 0) actor.rest--
    else goal = actor.goal
  } else if (actor.circle) {
    const [cx, cy, cz, r] = actor.circle
    const angle = Math.atan2(actor.pos.z - cz, actor.pos.x - cx) + actor.speed / r
    goal = new Vec3(cx + Math.cos(angle) * r, cy, cz + Math.sin(angle) * r)
  }
  if (actor.sneakEvery && actor.tick % actor.sneakEvery === 0) {
    actor.flags.sneaking = !actor.flags.sneaking
    update.metadata = metadataOf(actor)
  }
  if (goal) {
    const speed = actor.flags.sneaking ? actor.speed * 0.4 : actor.speed
    const dx = goal.x - actor.pos.x
    const dz = goal.z - actor.pos.z
    const length = Math.hypot(dx, dz)
    if (length > 1e-6) {
      const move = actor.circle ? 1 : Math.min(1, speed / length)
      actor.pos = new Vec3(actor.pos.x + dx * move, actor.pos.y, actor.pos.z + dz * move)
      actor.yaw = yawOf(dx, dz) + (actor.backwards ? Math.PI : 0)
      Object.assign(update, { pos: actor.pos, yaw: actor.yaw, headYaw: actor.yaw, onGround: !actor.airborne })
    }
  }
  return update
}

// The dragon's attack, and a skeleton's arrows: projectiles are entities as a server tells of them, their particles the
// version's effects, spawned as the game spawns them. Every so often the dragon sends a fireball at the ground, its
// breath trailing it (the game emits the trail a particle at a time); where it lands its breath lingers in a cloud for a
// while (the cloud spawns the effect again and again, for its radius). The skeleton shoots an arrow now and then, which
// flies in an arc, turned along its flight, and sticks where it lands.
const ATTACK = { target: new Vec3(24.5, G, 24.5), every: 240, flight: 50, cloud: 160, radius: 3 }
const ARROW = { every: 70, speed: 0.9, gravity: 0.05, stuck: 40, aim: new Vec3(22.5, G, 27.5) }
const projectiles = { next: 100000, fireball: null, cloud: 0, arrows: [] }

function shoot (tick) {
  const dragon = actors.find(a => a.name === 'ender_dragon')
  if (dragon && tick % ATTACK.every === 0 && !projectiles.fireball) {
    const from = dragon.pos.offset(0, 1, 0)
    projectiles.fireball = { id: projectiles.next++, from, t: 0 }
    viewer.updateEntity({ id: projectiles.fireball.id, name: 'dragon_fireball', pos: from, yaw: 0, pitch: 0, width: 1, height: 1 })
  }
  const fireball = projectiles.fireball
  if (fireball) {
    fireball.t++
    const k = Math.min(1, fireball.t / ATTACK.flight)
    const pos = fireball.from.plus(ATTACK.target.minus(fireball.from).scaled(k))
    viewer.updateEntity({ id: fireball.id, pos })
    for (let i = 0; i < 3; i++) viewer.spawnParticle('dragon_breath_trail', pos.offset(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5))
    if (k === 1) {
      viewer.updateEntity({ id: fireball.id, delete: true })
      projectiles.fireball = null
      projectiles.cloud = ATTACK.cloud
    }
  }
  if (projectiles.cloud > 0) {
    // (its radius shrinks as it lasts, as the game's does)
    const radius = ATTACK.radius * (0.5 + 0.5 * projectiles.cloud / ATTACK.cloud)
    if (projectiles.cloud % 5 === 0) viewer.spawnParticle('dragon_breath_lingering', ATTACK.target.offset(0, 0.1, 0), { variables: { cloud_radius: radius, cloud_lifetime: 1, particle_multiplier: 3 } })
    projectiles.cloud--
  }

  const archer = actors.find(a => a.archer)
  if (archer && tick % ARROW.every === 0) {
    // aimed so that it comes down at the mark: its time of flight from the distance, its rise from that time
    const from = archer.pos.offset(0, 1.5, 0)
    const flat = Math.hypot(ARROW.aim.x - from.x, ARROW.aim.z - from.z)
    const ticks = flat / ARROW.speed
    const velocity = new Vec3((ARROW.aim.x - from.x) / ticks, (ARROW.aim.y - from.y) / ticks + ARROW.gravity * ticks / 2, (ARROW.aim.z - from.z) / ticks)
    archer.yaw = yawOf(velocity.x, velocity.z)
    viewer.updateEntity({ id: archer.id, yaw: archer.yaw, headYaw: archer.yaw, event: 'arm_swing' })
    projectiles.arrows.push({ id: projectiles.next++, pos: from, velocity, stuck: 0, spawned: false })
  }
  for (const arrow of [...projectiles.arrows]) {
    if (arrow.stuck) {
      if (++arrow.stuck > ARROW.stuck) {
        viewer.updateEntity({ id: arrow.id, delete: true })
        projectiles.arrows.splice(projectiles.arrows.indexOf(arrow), 1)
      }
      continue
    }
    arrow.pos = arrow.pos.plus(arrow.velocity)
    arrow.velocity = arrow.velocity.offset(0, -ARROW.gravity, 0)
    if (arrow.pos.y <= ARROW.aim.y + 0.1) arrow.stuck = 1
    const yaw = yawOf(arrow.velocity.x, arrow.velocity.z)
    const pitch = Math.atan2(arrow.velocity.y, Math.hypot(arrow.velocity.x, arrow.velocity.z))
    viewer.updateEntity({ id: arrow.id, ...(arrow.spawned ? {} : { name: 'arrow', width: 0.5, height: 0.5 }), pos: arrow.pos, yaw, headYaw: yaw, pitch })
    arrow.spawned = true
  }
}

function stopShooting () {
  if (projectiles.fireball) viewer.updateEntity({ id: projectiles.fireball.id, delete: true })
  for (const arrow of projectiles.arrows) viewer.updateEntity({ id: arrow.id, delete: true })
  Object.assign(projectiles, { fireball: null, cloud: 0, arrows: [] })
}

// ---- the page ----------------------------------------------------------------------------------------------------

// where the tour looks, and what to see there: [name, target, distance, text, side (see viewFrom45), the username of
// a player the camera follows instead of looking at target]
const TOUR = [
  ['overview', [0, G, 0], 70, 'The four biomes, each tinting grass, leaves and water its own way: plains, cherry grove, swamp, desert.'],
  ['house', [-21, G + 3, -23], 18, 'A roof of stairs in rings: every corner turns inner or outer by its neighbours (states since 1.26.50, worked out by the viewer before). Plank walls, log corners, glass panes, a door.'],
  ['block entities', [-21, G, -15], 13, 'Shaped and coloured by their block entities: beds of four colours, banners by their Base colour, a double chest (its halves by their pair) beside a single one, heads turned 0°–180°, signs, a lantern and a torch.'],
  ['farm', [-29.5, G, -23], 13, 'Wheat at every stage of growth and carrots on farmland, moist from the water between them.', [-1, 1]],
  ['pen', [-9, G, -23], 16, 'A pen of fence with a gate, the fence joining what is next to it; cows, pigs and chickens of each climate (warm, temperate, cold: since 1.21.70) walking about, a bee flying.'],
  ['redstone', [-20, G, -5], 12, 'Shaped by their neighbours, as the client works it out: redstone wire from a lever, climbing over a block and down, through a repeater, round a corner to a torch, and a lone wire\'s cross; tripwire between two hooks; a chorus plant on end stone; grass snowy under snow; twisting and weeping vines ending in their tips.', [1, -1]],
  ['steve', [-4, G + 1, -4], 7, 'Steve walking his round, sneaking every few steps, in iron armour with a sword and a shield; the camera follows him.', [1, 1], 'Steve (sneaks)'],
  ['waterfall', [16, G + 2, -22], 18, 'A source on the cliff, water flowing to its edge, falling, then spreading below as its depth runs out; tinted as the cherry grove tints it.'],
  ['pond', [-17, G - 1, 12], 18, 'Swamp water, darker; lily pads, seagrass and kelp in the water of their liquid layer; Alex swimming, fish, oak trees hung with vines, sugar cane.'],
  ['desert', [17, G, 16], 22, 'Sand, cacti, dead bushes, a lava pool flowing out; a zombie in gold, a husk with a shovel and a skeleton with a bow wandering.'],
  ['dragon', [22, G + 6, 23], 24, 'The ender dragon circling over the desert, now and then sending a fireball at the ground: its breath trails it, and lingers where it lands in a cloud for a while. A skeleton shooting arrows, each flying in an arc and sticking where it lands.', [1, 1]],
  ['sky', [0, G + 20, 0], 9, 'A player gliding with an elytra: the body lies along its flight; the camera follows it.', [1, 1], 'Glider']
]

let actors = []
let ticker = null
let ticks = 0
// the actor the camera follows, if any
let following = null

async function build () {
  const version = ui.version.value
  status.textContent = `${version}: building...`
  clearInterval(ticker)
  await preload(version)
  const registry = require('prismarine-registry')(version)
  const Chunk = require('prismarine-chunk')(registry)
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
  const local = (x, y, z) => new Vec3(((x % 16) + 16) % 16, y, ((z % 16) + 16) % 16)
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
    if (block.entity) column.setBlockEntity(local(x, y, z), { type: 'compound', name: '', value: block.entity })
  }
  // the biomes, each a quarter of the world
  for (let x = MIN; x < MAX; x++) {
    for (let z = MIN; z < MAX; z++) {
      const biome = registry.biomesByName[biomeAt(x, z)] ?? registry.biomesByName.birch_forest ?? registry.biomesByName.plains
      // (Bedrock keeps a biome for every block)
      for (let y = G - 8; y < G + 12; y++) columnAt(x, z).setBiomeId(local(x, y, z), biome.id)
    }
  }

  if (!viewer.setVersion(version, { blockHashes: false })) {
    status.textContent = `${version} is not supported`
    return
  }
  for (const column of columns.values()) viewer.addColumn(column.x * 16, column.z * 16, column.toJson())

  for (const sprite of [...labels.children]) labels.remove(sprite)
  for (const [x, z, text] of [[-16, -16, 'plains'], [16, -16, registry.biomesByName.cherry_grove ? 'cherry grove' : 'birch forest (no cherry grove yet)'], [-16, 16, 'swamp'], [16, 16, 'desert']]) {
    const sprite = label(text, { height: 1.2 })
    sprite.position.set(x, G + 12, z)
    labels.add(sprite)
  }

  stopShooting()
  actors = spawnActors()
  ticker = setInterval(() => {
    if (!ui.move.checked) return
    for (const actor of actors) {
      const update = step(actor)
      if (Object.keys(update).length > 1) viewer.updateEntity(update)
    }
    shoot(++ticks)
    if (following) {
      // the camera moves with it, keeping its angle and distance (orbiting stays the user's)
      const offset = new THREE.Vector3(following.pos.x, following.pos.y + 1, following.pos.z).sub(orbit.target)
      orbit.target.add(offset)
      viewer.camera.position.add(offset)
      orbit.update()
    }
  }, 50)

  status.textContent = `${version}: ${w.blocks.size} blocks, ${actors.length} entities` + (missing.size ? `; the version has no ${[...missing].join(', ')}` : '')
  goTo(TOUR[0])
  await viewer.waitForChunksToRender()
}

function goTo ([name, [x, y, z], distance, text, side, follow]) {
  following = (follow && actors.find(actor => actor.username === follow)) || null
  const target = following ? following.pos.offset(0, 1, 0) : new Vec3(x, y, z)
  viewFrom45(viewer, orbit, target, distance, side)
  // the names of the biomes, from afar only
  labels.visible = name === 'overview'
  info.textContent = `${name}: ${text}`
}

let queue = Promise.resolve()
const run = fn => { queue = queue.then(fn).catch(err => { status.textContent = String(err?.stack ?? err) }) }

async function main () {
  versionSelect(ui.version, await bedrockVersions())
  for (const stop of TOUR) {
    const button = document.createElement('button')
    button.textContent = stop[0]
    button.addEventListener('click', () => goTo(stop))
    ui.tour.appendChild(button)
  }
  ui.version.addEventListener('change', () => {
    const url = new URL(window.location.href)
    url.searchParams.set('version', ui.version.value)
    window.history.replaceState(null, '', url)
    run(build)
  })
  ui.turn.addEventListener('change', () => { orbit.autoRotate = ui.turn.checked })
  run(build)
}

main()
