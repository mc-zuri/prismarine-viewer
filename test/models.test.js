/* eslint-env jest */
const { Vec3 } = require('vec3')
const { getSectionGeometry } = require('../viewer/lib/models')

// A minimal resolved cube model (textures already atlas-resolved to {u,v,su,sv}), no cullface so it needs no neighbours.
function cubeModel () {
  const texture = { u: 0, v: 0, su: 1, sv: 1 }
  const faces = {}
  for (const face of ['down', 'up', 'north', 'south', 'west', 'east']) faces[face] = { texture }
  return { ao: false, textures: { particle: texture }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces }] }
}

function fakeBlock (name, pos) {
  return {
    name,
    position: pos,
    biome: { name: 'plains' },
    isCube: true,
    transparent: false,
    type: 1,
    getProperties: () => ({})
  }
}

// A world with a single block of `name` at the section origin, air everywhere else.
function worldWith (name) {
  return {
    getBlock (pos) {
      const isOrigin = pos.x === 0 && pos.y === 0 && pos.z === 0
      return fakeBlock(isOrigin ? name : 'air', new Vec3(pos.x, pos.y, pos.z))
    }
  }
}

const blocksStates = {
  oak_stairs: { variants: { normal: { model: cubeModel() } } },
  air: { variants: { normal: { model: cubeModel() } } },
  cave_air: { variants: { normal: { model: cubeModel() } } },
  void_air: { variants: { normal: { model: cubeModel() } } }
}

describe('tints', () => {
  function tintedCube () {
    const model = cubeModel()
    for (const face of Object.values(model.elements[0].faces)) face.tintindex = 0
    return model
  }
  const tinted = { grass_block: { variants: { normal: { model: tintedCube() } } } }
  // 0x80ff00 in plains, 0xff0000 elsewhere
  const __tints = { grass: { data: [{ keys: ['plains'], color: 0x80ff00 }], default: 0xff0000 } }

  test('a tinted face takes the colour the blocksStates give its biome', () => {
    const geo = getSectionGeometry(0, 0, 0, worldWith('grass_block'), { ...tinted, __tints })
    expect(Array.from(geo.colors.slice(0, 3))).toEqual([0x80 / 255, 1, 0].map(Math.fround))
  })

  test('blocksStates without tints leave it white', () => {
    const geo = getSectionGeometry(0, 0, 0, worldWith('grass_block'), tinted)
    expect(Array.from(geo.colors.slice(0, 3))).toEqual([1, 1, 1])
  })
})

describe('getModelVariants air-name matching', () => {
  // Regression: `block.name.includes('air')` also matched "stairs" (st-air-s), hiding every *_stairs block.
  test('a *_stairs block is rendered (not skipped as air)', () => {
    const geo = getSectionGeometry(0, 0, 0, worldWith('oak_stairs'), blocksStates)
    expect(geo.positions.length).toBeGreaterThan(0)
  })

  test('the air blocks are still skipped', () => {
    for (const name of ['air', 'cave_air', 'void_air']) {
      expect(getSectionGeometry(0, 0, 0, worldWith(name), blocksStates).positions.length).toBe(0)
    }
  })
})

describe('turned variants', () => {
  test('look their neighbours up at whole block positions', () => {
    const asked = []
    const model = cubeModel()
    for (const [face, f] of Object.entries(model.elements[0].faces)) f.cullface = face
    const world = {
      getBlock (pos) {
        asked.push([pos.x, pos.y, pos.z])
        return worldWith('stone').getBlock(pos)
      }
    }
    const blocksStates = { stone: { variants: { normal: { model, x: 180, y: 90 } } } }
    getSectionGeometry(0, 0, 0, world, blocksStates)
    expect(asked.length).toBeGreaterThan(16 * 16 * 16)
    expect(asked.every(p => p.every(Number.isInteger))).toBe(true)
  })
})

describe('blocksStates with shared models', () => {
  const { prepareBlocksStates } = require('../viewer/lib/modelsBuilder')
  const atlas = { json: { textures: { missing_texture: { u: 0, v: 0, su: 0.5, sv: 0.5 }, planks: { u: 0.5, v: 0, su: 0.5, sv: 0.5 } } } }
  const box = (from, to) => ({ from, to, faces: Object.fromEntries(['down', 'up', 'north', 'south', 'west', 'east'].map(f => [f, { texture: '#all' }])) })
  function assets (variant) {
    return {
      blocksStates: { step: { variants: { '': variant } } },
      blocksModels: {
        cube_all: { elements: [box([0, 0, 0], [16, 16, 16])] },
        half: { elements: [box([0, 0, 0], [16, 8, 8])] },
        step: { parent: 'block/half', textures: { all: 'minecraft:block/planks' } }
      }
    }
  }
  // the quads a single block of the variant draws: their corners and the UVs at them
  function quads (blocksStates) {
    const geo = getSectionGeometry(0, 0, 0, worldWith('step'), blocksStates)
    const out = []
    for (let q = 0; q < geo.positions.length / 12; q++) {
      const corners = []
      for (let k = q * 4; k < q * 4 + 4; k++) {
        corners.push([...geo.positions.slice(k * 3, k * 3 + 3), ...geo.uvs.slice(k * 2, k * 2 + 2)].map(v => Math.round(v * 1e4) / 1e4).join(','))
      }
      out.push(corners.sort().join(' '))
    }
    return out.sort()
  }
  const positionsOf = list => list.map(q => q.split(' ').map(c => c.split(',').slice(0, 3).join(',')).sort().join(' ')).sort()

  test('the variant model is an index pair into tables', () => {
    const states = JSON.parse(JSON.stringify(prepareBlocksStates(assets({ model: 'block/step' }), atlas)))
    expect(states.step.variants[''].model).toEqual([expect.any(Number), expect.any(Number)])
    expect(states.__models.textureSets[states.step.variants[''].model[1]]).toEqual({ all: 'planks' })
    expect(quads(states).length).toBe(6)
  })

  test('uvlock turns the box as the variant does, and keeps its textures where they lie in the world', () => {
    const turned = JSON.parse(JSON.stringify(prepareBlocksStates(assets({ model: 'block/step', y: 90 }), atlas)))
    const locked = JSON.parse(JSON.stringify(prepareBlocksStates(assets({ model: 'block/step', y: 90, uvlock: true }), atlas)))
    expect(locked.step.variants[''].y).toBeUndefined()
    expect(positionsOf(quads(locked))).toEqual(positionsOf(quads(turned)))
    expect(quads(locked)).not.toEqual(quads(turned))

    // the turned box, unturned: the textures of a box where the locked one is
    const half = assets({ model: 'block/step' })
    half.blocksModels.half.elements = [box([8, 0, 0], [16, 8, 16])]
    expect(quads(locked)).toEqual(quads(JSON.parse(JSON.stringify(prepareBlocksStates(half, atlas)))))
  })
})
