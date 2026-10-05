// Bedrock blocks whose shape the client works out from their neighbours or their block entity, rather than from
// their state. The assets (blocks_render.json of minecraft-assets, `connect`) name them, and key their shapes by the
// properties computed here, which the mesher adds to the block's own:
//   stairs       minecraft:corner: none | inner_left | inner_right | outer_left | outer_right
//   fence, pane  minecraft:connection_north|east|south|west: 0 | 1
//   bed          bedrock:color: 0 - 15, the colour its block entity holds
//   banner       bedrock:color: 0 - 15, its block entity's Base colour
//   skull        bedrock:rotation: 0 - 15, the turn of one on the floor (its block entity's Rotation, in 22.5° steps);
//                bedrock:skull_type: 0 - 6, the kind of the one block all heads were before they had their own
//   chest        bedrock:chest: single | left | right, the half of a double chest it is, by its block entity's pair
//   redstone     bedrock:redstone_north|east|south|west: none | side | up, where redstone wire runs (Java's rule; alone,
//                a full cross)
//   chorus       bedrock:chorus_north|east|south|west|up|down: 0 | 1, the chorus beside it (end stone below)
//   tripwire     minecraft:connection_north|east|south|west: 0 | 1, the string or hooks beside it
//   snowy        bedrock:snowy: 0 | 1, snow above it (grass, mycelium, podzol)
//   tip          bedrock:tip: 0 | 1, whether the vine or kelp ends here (nothing of it beyond, the way it grows)
// Since 1.26.50 the states of stairs and fences carry the first two themselves, and the assets name no `connect`
// (tripwire since 1.26.51).
// Where the block entity says nothing, the assets' defaults for the block (blocks_render.json `defaults`) apply.

const DIRECTIONS = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }

// Stairs: weirdo_direction -> the direction they face (their high side), [dx, dz]
const STAIR_FACING = { 0: [1, 0], 1: [-1, 0], 2: [0, 1], 3: [0, -1] } // east, west, south, north

function stairOf (block) {
  const props = block?.getProperties?.()
  if (!props || !block.name.endsWith('_stairs') || !(props.weirdo_direction in STAIR_FACING)) return null
  return { facing: STAIR_FACING[props.weirdo_direction], half: props.upside_down_bit }
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1]
const counterClockwise = ([x, z]) => [z, -x] // seen from above: north -> west -> south -> east

// The corner stairs make with their neighbours, by the game's rule (Java's StairBlock has the same). getBlock(dx, dz)
// is the block beside them.
function stairsCorner (props, getBlock) {
  const self = stairOf({ name: '_stairs', getProperties: () => props })
  if (!self) return 'none'
  const [dx, dz] = self.facing
  // a side may turn the corner unless stairs there already continue these
  const canTake = ([x, z]) => {
    const n = stairOf(getBlock(x, z))
    return !n || !same(n.facing, self.facing) || n.half !== self.half
  }
  const front = stairOf(getBlock(dx, dz))
  if (front && front.half === self.half && front.facing[0] !== dx && front.facing[1] !== dz &&
      canTake([-front.facing[0], -front.facing[1]])) {
    return same(front.facing, counterClockwise(self.facing)) ? 'outer_left' : 'outer_right'
  }
  const back = stairOf(getBlock(-dx, -dz))
  if (back && back.half === self.half && back.facing[0] !== dx && back.facing[1] !== dz && canTake(back.facing)) {
    return same(back.facing, counterClockwise(self.facing)) ? 'inner_left' : 'inner_right'
  }
  return 'none'
}

// whether a fence or pane joins the block beside it: one of its kind, or a whole block (see-through ones too: glass, a
// spawner), but leaves
function joins (block, neighbor) {
  if (!neighbor) return false
  if (neighbor.connect === block.connect) return true
  if (neighbor.isCube && !neighbor.name.endsWith('leaves')) return true
  if (block.connect === 'fence') return neighbor.name.endsWith('fence_gate')
  return neighbor.name.endsWith('_wall')
}

// Beds: their colour, in the dye colours' order; red when nothing says
const DEFAULT_BED_COLOR = 14

// a block entity's colour: prismarine-nbt's typed compound, or plain
function bedColor (entity) {
  const color = entity?.value?.color?.value ?? entity?.color
  return Number.isInteger(color) && color >= 0 && color < 16 ? color : undefined
}

// a bed's colour: its block entity's, else its other half's; undefined when neither says
function bedColorAt (world, pos) {
  const own = bedColor(world.getBlockEntity?.(pos))
  if (own !== undefined) return own
  for (const [dx, dz] of Object.values(DIRECTIONS)) {
    const at = pos.offset(dx, 0, dz)
    if (world.getBlock(at)?.connect !== 'bed') continue
    const other = bedColor(world.getBlockEntity?.(at))
    if (other !== undefined) return other
  }
  return undefined
}

// a value of a block entity: prismarine-nbt's typed compound, or plain
function entityValue (entity, key) {
  const value = entity?.value?.[key]?.value ?? entity?.[key]
  return typeof value === 'bigint' ? Number(value) : value
}

// Banners: the colour of their cloth
function bannerColor (world, pos) {
  const base = Number(entityValue(world.getBlockEntity?.(pos), 'Base'))
  return Number.isInteger(base) && base >= 0 && base < 16 ? String(base) : undefined
}

// Heads: the turn of one on the floor, and the kind of a skull block
function skullProperties (world, pos) {
  const entity = world.getBlockEntity?.(pos)
  const props = {}
  const rotation = Number(entityValue(entity, 'Rotation'))
  if (Number.isFinite(rotation)) props['bedrock:rotation'] = String(((Math.round(rotation / 22.5) % 16) + 16) % 16)
  const type = Number(entityValue(entity, 'SkullType'))
  if (Number.isInteger(type) && type >= 0) props['bedrock:skull_type'] = String(type)
  return props
}

// the way a block's front faces, [dx, dz]: minecraft:cardinal_direction, else facing_direction (2 north, 3 south,
// 4 west, 5 east)
function facingOf (props) {
  const cardinal = props['minecraft:cardinal_direction']
  if (cardinal in DIRECTIONS) return DIRECTIONS[cardinal]
  return { 2: DIRECTIONS.north, 3: DIRECTIONS.south, 4: DIRECTIONS.west, 5: DIRECTIONS.east }[props.facing_direction]
}

// Chests: the half of a double chest one is, as seen standing in front of it: the left one has its other half on its
// right. The block entity names the other half's position (pairx, pairz).
function chestHalf (world, pos, props) {
  const entity = world.getBlockEntity?.(pos)
  const pairX = Number(entityValue(entity, 'pairx'))
  const pairZ = Number(entityValue(entity, 'pairz'))
  const facing = facingOf(props)
  if (!Number.isFinite(pairX) || !Number.isFinite(pairZ) || !facing) return undefined
  const dx = pairX - Math.floor(pos.x)
  const dz = pairZ - Math.floor(pos.z)
  if (Math.abs(dx) + Math.abs(dz) !== 1) return undefined
  // its right, to someone in front of it facing it
  const [fx, fz] = facing
  const toRight = dx * fz + dz * -fx
  if (toRight === 0) return undefined
  return toRight > 0 ? 'left' : 'right'
}

// the properties block's shape takes at pos, from what is around it
// Redstone wire: the blocks it reaches beside it besides wire, as Java's RedStoneWireBlock has them (signal sources);
// a repeater only along its line, an observer only from behind or in front
const POWER = /^(redstone_torch|unlit_redstone_torch|redstone_block|lever|.*_button|.*pressure_plate|daylight_detector(_inverted)?|target|tripwire_hook|trapped_chest|(powered|unpowered)_comparator|detector_rail|lectern|lightning_rod|(calibrated_)?sculk_sensor)$/
const LINE = /^(powered|unpowered)_repeater$|^observer$/
// direction, as older states have it: 0 south, 1 west, 2 north, 3 east
const LEGACY_DIRECTIONS = { 0: DIRECTIONS.south, 1: DIRECTIONS.west, 2: DIRECTIONS.north, 3: DIRECTIONS.east }

const isWire = block => block?.name === 'redstone_wire'
const isCube = block => !!block?.isCube

// whether wire beside a block, [dx, dz] from the wire, runs to it
function reachesPower (block, [dx, dz]) {
  if (!block) return false
  if (POWER.test(block.name)) return true
  if (!LINE.test(block.name)) return false
  const props = block.getProperties?.() ?? {}
  const facing = facingOf(props) ?? LEGACY_DIRECTIONS[props.direction]
  return !!facing && Math.abs(facing[0]) === Math.abs(dx) && Math.abs(facing[1]) === Math.abs(dz)
}

// where redstone wire runs from pos, by Java's rule: up the side of the block beside it to wire on top, along to wire
// or a power component beside it, or down to wire below where the block beside lets it. With nothing along one axis,
// it runs along the other both ways: alone it is a full cross, and with one neighbour a line through.
function redstoneSides (world, pos) {
  const openAbove = !isCube(world.getBlock(pos.offset(0, 1, 0)))
  const sides = {}
  for (const [name, [dx, dz]] of Object.entries(DIRECTIONS)) {
    const beside = world.getBlock(pos.offset(dx, 0, dz))
    if (openAbove && isCube(beside) && isWire(world.getBlock(pos.offset(dx, 1, dz)))) sides[name] = 'up'
    else if (isWire(beside) || reachesPower(beside, [dx, dz]) || (!isCube(beside) && isWire(world.getBlock(pos.offset(dx, -1, dz))))) sides[name] = 'side'
    else sides[name] = 'none'
  }
  const runs = name => sides[name] !== 'none'
  const noNorthSouth = !runs('north') && !runs('south')
  const noEastWest = !runs('east') && !runs('west')
  const fill = names => { for (const name of names) if (!runs(name)) sides[name] = 'side' }
  if (noNorthSouth) fill(['east', 'west'])
  if (noEastWest) fill(['north', 'south'])
  return Object.fromEntries(Object.entries(sides).map(([name, side]) => ['bedrock:redstone_' + name, side]))
}

const CHORUS = new Set(['chorus_plant', 'chorus_flower'])
const AROUND = { ...Object.fromEntries(Object.entries(DIRECTIONS).map(([n, [dx, dz]]) => [n, [dx, 0, dz]])), up: [0, 1, 0], down: [0, -1, 0] }

// tripwire: the string beside it, or a hook beside it that it hangs from (a hook faces the way its string runs)
function tripwireJoins (block, [dx, dz]) {
  if (block?.name === 'trip_wire') return true
  if (block?.name !== 'tripwire_hook') return false
  const props = block.getProperties?.() ?? {}
  const facing = facingOf(props) ?? LEGACY_DIRECTIONS[props.direction]
  return !facing || (facing[0] === -dx && facing[1] === -dz)
}

const SNOW = new Set(['snow_layer', 'snow', 'powder_snow'])
// the way a vine or kelp grows, [dy]
const GROWTH = { twisting_vines: 1, kelp: 1, weeping_vines: -1 }

function connectedProperties (world, pos, block) {
  const props = block.getProperties()
  const defaults = block.defaults ?? {}
  if (block.connect === 'redstone') return redstoneSides(world, pos)
  if (block.connect === 'chorus') {
    return Object.fromEntries(Object.entries(AROUND).map(([name, [dx, dy, dz]]) => {
      const other = world.getBlock(pos.offset(dx, dy, dz))?.name
      return ['bedrock:chorus_' + name, CHORUS.has(other) || (name === 'down' && other === 'end_stone') ? '1' : '0']
    }))
  }
  if (block.connect === 'tripwire') {
    return Object.fromEntries(Object.entries(DIRECTIONS).map(([name, [dx, dz]]) =>
      ['minecraft:connection_' + name, tripwireJoins(world.getBlock(pos.offset(dx, 0, dz)), [dx, dz]) ? '1' : '0']))
  }
  if (block.connect === 'snowy') return { 'bedrock:snowy': SNOW.has(world.getBlock(pos.offset(0, 1, 0))?.name) ? '1' : '0' }
  if (block.connect === 'tip') {
    const next = world.getBlock(pos.offset(0, GROWTH[block.name] ?? 1, 0))
    return { 'bedrock:tip': next?.name === block.name ? '0' : '1' }
  }
  if (block.connect === 'stairs') {
    return { 'minecraft:corner': stairsCorner(props, (dx, dz) => world.getBlock(pos.offset(dx, 0, dz))) }
  }
  if (block.connect === 'bed') return { 'bedrock:color': String(bedColorAt(world, pos) ?? defaults['bedrock:color'] ?? DEFAULT_BED_COLOR) }
  if (block.connect === 'banner') return { ...defaults, 'bedrock:color': bannerColor(world, pos) ?? defaults['bedrock:color'] ?? '15' }
  if (block.connect === 'skull') return { 'bedrock:rotation': '0', 'bedrock:skull_type': '0', ...defaults, ...skullProperties(world, pos) }
  if (block.connect === 'chest') return { ...defaults, 'bedrock:chest': chestHalf(world, pos, props) ?? defaults['bedrock:chest'] ?? 'single' }
  const connections = {}
  for (const [name, [dx, dz]] of Object.entries(DIRECTIONS)) {
    connections['minecraft:connection_' + name] = joins(block, world.getBlock(pos.offset(dx, 0, dz))) ? '1' : '0'
  }
  return connections
}

module.exports = { connectedProperties, stairsCorner, bedColor, chestHalf, DEFAULT_BED_COLOR }
