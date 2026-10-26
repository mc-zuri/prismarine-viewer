/**
 * @jest-environment node
 */
/* eslint-env jest */
// The files prerender.js writes of each Bedrock version's entities and item icons, and how the page finds them:
// versions that come out the same share a file, named in entities/index.json, and every texture is one file of the
// store, whichever versions name it.
const fs = require('fs')
const os = require('os')
const path = require('path')

// the page's files are read from the folder a test built
let mockPublic = null
jest.mock('../viewer/lib/utils', () => ({
  loadJSON: (url, onLoad, onError) => {
    let data
    try {
      data = JSON.parse(require('fs').readFileSync(require('path').join(mockPublic, url), 'utf8'))
    } catch (err) {
      return onError(err)
    }
    onLoad(data)
  },
  loadImage: () => {}
}))

const { entityAssets, writeEntityAssets, pruneTextureStore, readIndex } = require('../viewer/lib/bedrock/entity/prerender')
const { loadEntityAssets } = require('../viewer/lib/bedrock/entity/assets')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-entities-'))

// the minecraft-assets of a version with a cow and a bed, whose textures hold the given text
function versionAssets ({ cow = 'cow', bed = 'bed', red = 'red bed' } = {}) {
  const dir = tmp()
  const file = (name, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  }
  file('entity/cow/cow_v2.png', cow)
  file('items/bed_white.png', bed)
  file('items/bed_red.png', red)
  file('items/leather_helmet.png', 'helmet')
  file('items/leather_helmet_overlay.png', 'helmet overlay')
  return {
    entities: {
      entities: { 'minecraft:cow': { identifier: 'minecraft:cow', textures: { default: 'textures/entity/cow/cow_v2' }, geometry: { default: 'geometry.cow' } } },
      geometry: { 'geometry.cow': { texture_width: 64, texture_height: 32, bones: [] } },
      render_controllers: {},
      animations: {},
      animation_controllers: {},
      materials: {}
    },
    itemsArray: [
      { name: 'bed', texture: 'items/bed_white', variants: { 14: 'items/bed_red' } },
      { name: 'camera', texture: null },
      { name: 'leather_helmet', model: 'leather_helmet', texture: 'items/leather_helmet', overlay: 'items/leather_helmet_overlay', tint: { base: '#a06540' } }
    ],
    pathOf: entry => path.join(dir, entry)
  }
}

describe('a version\'s entity assets', () => {
  test('its entities, its items\' icons by aux value, and each texture they name by its file in the store', () => {
    const { data, textures, missing } = entityAssets(versionAssets())
    expect(Object.keys(data.entities)).toEqual(['minecraft:cow'])
    // (an item with no icon is kept, to say so; a dyed one keeps its overlay and colour)
    expect(data.items).toEqual({
      bed: { texture: 'items/bed_white', variants: { 14: 'items/bed_red' } },
      camera: {},
      leather_helmet: { texture: 'items/leather_helmet', overlay: 'items/leather_helmet_overlay', tint: { base: '#a06540' } }
    })
    expect(Object.keys(data.textureFiles).sort()).toEqual(['items/bed_red', 'items/bed_white', 'items/leather_helmet', 'items/leather_helmet_overlay', 'textures/entity/cow/cow_v2'])
    for (const file of Object.values(data.textureFiles)) expect(file).toMatch(/^bedrock\/[0-9a-f]{16}\.png$/)
    expect(textures.size).toBe(5)
    // a player that cannot be drawn with its own skin is Steve or Alex, whose textures this version lacks
    expect(missing).toEqual(['textures/entity/alex', 'textures/entity/steve'])
  })

  test('a version without client entities still has its items\' icons', () => {
    const assets = { ...versionAssets(), entities: null }
    const { data } = entityAssets(assets)
    expect(data.entities).toEqual({})
    expect(data.items.bed.texture).toBe('items/bed_white')
  })

  test('its particle effects, and the textures they are drawn with (not the atlases the game builds)', () => {
    const assets = versionAssets()
    const dir = path.dirname(assets.pathOf('x'))
    fs.mkdirSync(path.join(dir, 'particle'))
    fs.writeFileSync(path.join(dir, 'particle', 'particles.png'), 'particles')
    fs.writeFileSync(path.join(dir, 'flame_atlas.png'), 'flames')
    const effect = (identifier, texture) => ({ format_version: '1.10.0', description: { identifier, basic_render_parameters: { material: 'particles_alpha', texture } }, components: {} })
    const particles = {
      'minecraft:heart_particle': effect('minecraft:heart_particle', 'textures/particle/particles'),
      'minecraft:mobflame_emitter': effect('minecraft:mobflame_emitter', 'textures/flame_atlas'),
      'minecraft:block_destruct': effect('minecraft:block_destruct', 'atlas.terrain')
    }
    // as minecraft-assets reads particles.json, and from the file of a minecraft-assets that does not
    fs.writeFileSync(path.join(dir, 'particles.json'), JSON.stringify({ format_version: 1, particles, files: {}, missing: [] }))
    for (const version of [{ ...assets, particles: { particles } }, assets]) {
      const { data } = entityAssets(version)
      expect(Object.keys(data.particles)).toEqual(Object.keys(particles))
      expect(data.particles['minecraft:heart_particle']).toEqual(particles['minecraft:heart_particle'])
      expect(data.textureFiles['textures/particle/particles']).toMatch(/^bedrock\//)
      expect(data.textureFiles['textures/flame_atlas']).toMatch(/^bedrock\//)
      expect(data.textureFiles['atlas.terrain']).toBeUndefined()
    }
    // a version of none
    expect(entityAssets({ ...assets, particles: null }).data.particles).toEqual({})
  })

  test('the block items the game draws as their block keep their block\'s model; a torch stays its icon', () => {
    const assets = versionAssets()
    const dir = path.dirname(assets.pathOf('x'))
    for (const name of ['log_oak', 'log_oak_top', 'leaves_oak', 'planks_oak', 'torch_on']) {
      fs.mkdirSync(path.join(dir, 'blocks'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'blocks', name + '.png'), name)
    }
    const cube = { from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#up', cullface: 'up' }, north: { texture: '#side', uv: [0, 0, 16, 16], rotation: 90 } } }
    fs.writeFileSync(path.join(dir, 'blocks_states.json'), JSON.stringify({
      oak_log: { variants: { 'pillar_axis=y': { model: 'minecraft:block/oak_log' }, 'pillar_axis=x': { model: 'minecraft:block/oak_log', x: 90, y: 90 } } },
      oak_leaves: { variants: { '': { model: 'minecraft:block/oak_leaves', y: 90 } } },
      oak_fence: { multipart: [{ apply: { model: 'minecraft:block/oak_fence' } }, { apply: { model: 'minecraft:block/oak_fence_side' }, when: { 'minecraft:connection_north': '1' } }] }
    }))
    fs.writeFileSync(path.join(dir, 'blocks_models.json'), JSON.stringify({
      geometry_1: { elements: [cube] },
      oak_log: { parent: 'minecraft:block/geometry_1', textures: { up: 'minecraft:block/log_oak_top', side: 'minecraft:block/log_oak' } },
      oak_leaves: { textures: { all: 'minecraft:block/leaves_oak' }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { south: { texture: '#all', tintindex: 0 } } }] },
      oak_fence: { textures: { wood: 'minecraft:block/planks_oak' }, elements: [{ from: [6, 0, 6], to: [10, 16, 10], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 }, faces: { east: { texture: '#wood' } } }] },
      oak_fence_side: { textures: { wood: 'minecraft:block/planks_oak' }, elements: [{ from: [7, 12, 0], to: [9, 15, 9], faces: { east: { texture: '#wood' } } }] }
    }))
    assets.itemsArray = [
      { name: 'oak_log', model: 'minecraft:block/oak_log', texture: 'blocks/log_oak' },
      { name: 'oak_leaves', model: 'minecraft:block/oak_leaves', texture: 'blocks/leaves_oak' },
      { name: 'oak_fence', model: 'minecraft:block/oak_fence', texture: 'blocks/planks_oak' },
      { name: 'torch', model: 'torch', texture: 'blocks/torch_on' }
    ]
    const { data } = entityAssets(assets)
    // (its default state, the first variant: its model through its parents, a face's UV its box's where it gives none)
    expect(data.items.oak_log.block).toEqual([{
      elements: [{
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: { up: { texture: 'blocks/log_oak_top', uv: [0, 0, 16, 16] }, north: { texture: 'blocks/log_oak', uv: [0, 0, 16, 16], rotation: 90 } }
      }]
    }])
    // (a tinted face in the plains' colour, the variant's turn kept)
    expect(data.items.oak_leaves.block).toEqual([{ y: 90, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { south: { texture: 'blocks/leaves_oak', uv: [0, 0, 16, 16], tint: '#77ab2f' } } }] }])
    // (of a multipart block, the parts that always apply: a fence's post, its element's turn kept)
    expect(data.items.oak_fence.block).toEqual([{ elements: [{ from: [6, 0, 6], to: [10, 16, 10], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 }, faces: { east: { texture: 'blocks/planks_oak', uv: [6, 0, 10, 16] } } }] }])
    expect(data.items.torch).toEqual({ texture: 'blocks/torch_on' })
    for (const p of ['blocks/log_oak', 'blocks/log_oak_top', 'blocks/leaves_oak', 'blocks/planks_oak', 'blocks/torch_on']) expect(data.textureFiles[p]).toMatch(/^bedrock\//)
  })
})

describe('the files', () => {
  test('versions that come out the same share a file; a texture is one file of the store for every version', () => {
    const publicPath = tmp()
    const a = entityAssets(versionAssets())
    const b = entityAssets(versionAssets())
    const c = entityAssets(versionAssets({ red: 'another red bed' }))
    expect(writeEntityAssets(publicPath, 'bedrock_1.19.20', a)).toBe('bedrock_1.19.20')
    expect(writeEntityAssets(publicPath, 'bedrock_1.19.21', b)).toBe('bedrock_1.19.20')
    expect(writeEntityAssets(publicPath, 'bedrock_1.19.30', c)).toBe('bedrock_1.19.30')
    expect(readIndex(publicPath)).toEqual({ 'bedrock_1.19.20': 'bedrock_1.19.20', 'bedrock_1.19.21': 'bedrock_1.19.20', 'bedrock_1.19.30': 'bedrock_1.19.30' })
    expect(fs.readdirSync(path.join(publicPath, 'entities')).sort()).toEqual(['bedrock_1.19.20.json', 'bedrock_1.19.30.json', 'index.json'])
    // cow, white bed, two red beds, a helmet and its overlay
    expect(fs.readdirSync(path.join(publicPath, 'textures', 'bedrock'))).toHaveLength(6)
    expect(pruneTextureStore(publicPath)).toBe(0)
  })

  test('a version built again otherwise leaves what its file held to the versions that shared it', () => {
    const publicPath = tmp()
    writeEntityAssets(publicPath, 'bedrock_1.19.60', entityAssets(versionAssets()))
    writeEntityAssets(publicPath, 'bedrock_1.19.62', entityAssets(versionAssets()))
    writeEntityAssets(publicPath, 'bedrock_1.19.63', entityAssets(versionAssets()))
    const before = fs.readFileSync(path.join(publicPath, 'entities', 'bedrock_1.19.60.json'), 'utf8')
    writeEntityAssets(publicPath, 'bedrock_1.19.60', entityAssets(versionAssets({ cow: 'a new cow' })))
    expect(readIndex(publicPath)).toEqual({ 'bedrock_1.19.60': 'bedrock_1.19.60', 'bedrock_1.19.62': 'bedrock_1.19.62', 'bedrock_1.19.63': 'bedrock_1.19.62' })
    expect(fs.readFileSync(path.join(publicPath, 'entities', 'bedrock_1.19.62.json'), 'utf8')).toBe(before)

    // and when they are built again the same as it, they share its file again
    writeEntityAssets(publicPath, 'bedrock_1.19.62', entityAssets(versionAssets({ cow: 'a new cow' })))
    writeEntityAssets(publicPath, 'bedrock_1.19.63', entityAssets(versionAssets({ cow: 'a new cow' })))
    expect(new Set(Object.values(readIndex(publicPath)))).toEqual(new Set(['bedrock_1.19.60']))
    expect(fs.readdirSync(path.join(publicPath, 'entities')).sort()).toEqual(['bedrock_1.19.60.json', 'index.json'])
    // the first cow's texture is no version's any more
    expect(pruneTextureStore(publicPath)).toBe(1)
  })

  test('the page finds a version\'s file through the index, the nearest of its major\'s for a version not built', async () => {
    mockPublic = tmp()
    writeEntityAssets(mockPublic, 'bedrock_1.20.10', entityAssets(versionAssets()))
    writeEntityAssets(mockPublic, 'bedrock_1.20.15', entityAssets(versionAssets()))
    const assets = await loadEntityAssets('bedrock_1.20.15')
    expect(assets.has('minecraft:cow')).toBe(true)
    expect(assets.has('minecraft:pig')).toBe(false)
    expect(assets.items.bed.variants[14]).toBe('items/bed_red')
    expect(assets.textureUrl('items/bed_red')).toMatch(/^textures\/bedrock\/[0-9a-f]{16}\.png$/)
    expect(assets.textureUrl('items/bed_blue')).toBe(null)
    expect((await loadEntityAssets('bedrock_1.20.30')).has('minecraft:cow')).toBe(true)
    expect(await loadEntityAssets('bedrock_1.19.80')).toBe(null)
  })
})
