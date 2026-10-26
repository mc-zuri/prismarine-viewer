/* eslint-env jest */
// What a block takes from its position besides its state, as models.js works it out: a chest's other half and its lid
// (block_entity.pair, block_entity.lid), a Bedrock door half's states from the other half, a piston's arm
// (block_entity.Progress).
const { Vec3 } = require('vec3')
const { getSectionGeometry } = require('../viewer/lib/models')

// each variant drawn as a thin box at x = half its index (pixels), so that the geometry tells which one was picked
function indexedVariants (keys) {
  const texture = { u: 0, v: 0, su: 1, sv: 1 }
  const variants = {}
  keys.forEach((key, i) => {
    const faces = { up: { texture } }
    variants[key] = { model: { ao: false, textures: { particle: texture }, elements: [{ from: [i / 2, 0, 0], to: [i / 2 + 0.25, 1, 1], faces }] } }
  })
  return { variants }
}

// a world of the given blocks ({ 'x,y,z': { name, props } }), their block entities and lids, air elsewhere
function world (blocks, { entities = {}, lids = {}, preFlattening = false } = {}) {
  const at = pos => blocks[`${pos.x},${pos.y},${pos.z}`]
  return {
    preFlattening,
    getBlock (pos) {
      const b = at(pos)
      return { name: b?.name ?? 'air', position: new Vec3(pos.x, pos.y, pos.z), biome: { name: 'plains' }, isCube: false, transparent: true, type: 1, getProperties: () => ({ ...(b?.props ?? {}) }) }
    },
    getBlockEntity: pos => entities[`${pos.x},${pos.y},${pos.z}`] ?? null,
    getLid: pos => lids[`${pos.x},${pos.y},${pos.z}`] ?? 0
  }
}

// the index of the variant the block at (x, y, 0) of the section is drawn with
function picked (w, x, blocksStates, y = 0) {
  const geo = getSectionGeometry(0, 0, 0, w, blocksStates)
  const xs = []
  for (let i = 0; i < geo.positions.length; i += 3) {
    const [px, py, pz] = [geo.positions[i] + 8, geo.positions[i + 1] + 8, geo.positions[i + 2] + 8]
    if (Math.floor(px) === x && Math.floor(py) === y && Math.floor(pz) === 0) xs.push(px)
  }
  return Math.round((Math.min(...xs) - x) * 16 * 2)
}

const nbt = (pairx, pairz) => ({ type: 'compound', name: '', value: { pairx: { type: 'int', value: pairx }, pairz: { type: 'int', value: pairz } } })

describe('a chest\'s other half and lid', () => {
  const keys = []
  for (const pair of ['none', 'north', 'east', 'south', 'west']) for (const lid of [0, 5]) keys.push(`block_entity.pair=${pair},block_entity.lid=${lid}`)
  const states = { chest: indexedVariants(keys) }
  const index = (pair, lid) => keys.indexOf(`block_entity.pair=${pair},block_entity.lid=${lid}`)

  test('a single chest, shut and open', () => {
    const chest = { name: 'chest', props: { 'minecraft:cardinal_direction': 'north' } }
    expect(picked(world({ '1,0,0': chest }), 1, states)).toBe(index('none', 0))
    expect(picked(world({ '1,0,0': chest }, { lids: { '1,0,0': 5 } }), 1, states)).toBe(index('none', 5))
  })

  test('a Bedrock pair: the side its block entity names, the lid of whichever half opened', () => {
    const chest = { name: 'chest', props: { 'minecraft:cardinal_direction': 'north' } }
    const w = world({ '1,0,0': chest, '2,0,0': chest }, { entities: { '1,0,0': nbt(2, 0), '2,0,0': nbt(1, 0) }, lids: { '2,0,0': 5 } })
    expect(picked(w, 1, states)).toBe(index('east', 5))
    expect(picked(w, 2, states)).toBe(index('west', 5))
  })

  test('a Java pair: the side its type says (left: clockwise of its facing)', () => {
    const w = world({ '1,0,0': { name: 'chest', props: { facing: 'north', type: 'left' } }, '2,0,0': { name: 'chest', props: { facing: 'north', type: 'right' } } })
    expect(picked(w, 1, states)).toBe(index('east', 0))
    expect(picked(w, 2, states)).toBe(index('west', 0))
  })

  test('before the flattening a Java chest pairs with one of its kind beside it, across its facing', () => {
    const chest = { name: 'chest', props: { facing: 'north', type: 'single' } }
    const blocks = { '1,0,0': chest, '2,0,0': chest, '4,0,0': { name: 'ender_chest', props: { facing: 'north' } }, '5,0,0': { name: 'ender_chest', props: { facing: 'north' } } }
    expect(picked(world(blocks, { preFlattening: true }), 1, states)).toBe(index('east', 0))
    expect(picked(world(blocks), 1, states)).toBe(index('none', 0))
    expect(picked(world(blocks, { preFlattening: true }), 4, { ender_chest: indexedVariants(keys) })).toBe(index('none', 0))
  })
})

describe('a Bedrock door\'s halves', () => {
  const keys = []
  for (const upper of [0, 1]) for (const hinge of [0, 1]) for (const open of [0, 1]) for (const direction of [0, 1]) keys.push(`direction=${direction},door_hinge_bit=${hinge},open_bit=${open},upper_block_bit=${upper}`)
  const states = { wooden_door: indexedVariants(keys) }
  const index = props => keys.indexOf(`direction=${props.direction},door_hinge_bit=${props.door_hinge_bit},open_bit=${props.open_bit},upper_block_bit=${props.upper_block_bit}`)
  // as the game keeps a door: the lower half's direction and openness, the upper half's hinge
  const lower = { name: 'wooden_door', props: { direction: 1, door_hinge_bit: 0, open_bit: 1, upper_block_bit: 0 } }
  const upper = { name: 'wooden_door', props: { direction: 0, door_hinge_bit: 1, open_bit: 0, upper_block_bit: 1 } }

  test('the upper half takes the lower half\'s direction and openness, the lower half the upper half\'s hinge', () => {
    // (the door at x 1, its upper half above it: the section's y 0 and 1)
    const w = world({ '1,0,0': lower, '1,1,0': upper })
    expect(picked(w, 1, states)).toBe(index({ direction: 1, door_hinge_bit: 1, open_bit: 1, upper_block_bit: 0 }))
    expect(picked(w, 1, states, 1)).toBe(index({ direction: 1, door_hinge_bit: 1, open_bit: 1, upper_block_bit: 1 }))
  })

  test('a half on its own is drawn as its own states say', () => {
    expect(picked(world({ '1,0,0': lower }), 1, states)).toBe(index(lower.props))
  })
})

describe('a 0.14 - 1.0 door', () => {
  test('its hinge is the low bit of its upper half\'s data, which its states read as its direction', () => {
    const keys = []
    for (const upper of [0, 1]) for (const hinge of [0, 1]) for (const direction of [0, 1, 2, 3]) keys.push(`direction=${direction},door_hinge_bit=${hinge},open_bit=0,upper_block_bit=${upper}`)
    const states = { wooden_door: indexedVariants(keys) }
    const lower = { name: 'wooden_door', props: { direction: 2, door_hinge_bit: 0, open_bit: 0, upper_block_bit: 0 } }
    const upper = { name: 'wooden_door', props: { direction: 1, door_hinge_bit: 0, open_bit: 0, upper_block_bit: 1 } }
    const w = { ...world({ '1,0,0': lower, '1,1,0': upper }), legacyDoors: true }
    expect(picked(w, 1, states)).toBe(keys.indexOf('direction=2,door_hinge_bit=1,open_bit=0,upper_block_bit=0'))
    expect(picked(w, 1, states, 1)).toBe(keys.indexOf('direction=2,door_hinge_bit=1,open_bit=0,upper_block_bit=1'))
  })
})

describe('a Bedrock piston', () => {
  test('its arm is out as far as its PistonArm block entity\'s progress says, in by default', () => {
    const keys = ['0', '0.5', '1'].map(p => `facing_direction=1,block_entity.Progress=${p}`)
    const states = { piston: indexedVariants(keys) }
    const piston = { name: 'piston', props: { facing_direction: 1 } }
    const arm = progress => ({ type: 'compound', name: '', value: { id: { type: 'string', value: 'PistonArm' }, Progress: { type: 'float', value: progress }, State: { type: 'byte', value: 1 } } })
    expect(picked(world({ '1,0,0': piston }), 1, states)).toBe(0)
    expect(picked(world({ '1,0,0': piston }, { entities: { '1,0,0': arm(0.5) } }), 1, states)).toBe(1)
    expect(picked(world({ '1,0,0': piston }, { entities: { '1,0,0': arm(1) } }), 1, states)).toBe(2)
  })
})
