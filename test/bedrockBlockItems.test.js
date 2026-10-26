/**
 * @jest-environment node
 */
/* eslint-env jest */
// Bedrock block items: one the game draws as its block is its block's model (bedrock/blockItem.js), any other its icon
// drawn flat, a torch's block texture too.
const THREE = require('three')

jest.mock('../viewer/lib/utils', () => ({
  loadJSON: (url, onLoad) => onLoad([]),
  loadPixels: (path, onLoad) => onLoad({ width: 2, height: 2, data: new Uint8Array(16).fill(255) }),
  loadTexture: (path, onLoad) => onLoad(new (require('three').Texture)())
}))

const { getItemMesh } = require('../viewer/lib/entity/Item')
const { blockItemMesh } = require('../viewer/lib/bedrock/blockItem')

const flush = () => new Promise(resolve => setImmediate(resolve))

// entity assets whose textures are 16 pixels square, a fire's a strip of 32 frames
function assets (items = {}) {
  const textures = new Map()
  return {
    items,
    textureUrl: p => 'textures/' + p,
    texture (p) {
      if (!textures.has(p)) {
        const t = new THREE.Texture()
        t.image = { width: 16, height: p.includes('fire') ? 512 : 16 }
        t.userData = { ready: Promise.resolve(t) }
        textures.set(p, p.includes('missing') ? null : t)
      }
      return textures.get(p)
    }
  }
}

const log = [{
  elements: [{
    from: [0, 0, 0],
    to: [16, 16, 16],
    faces: {
      up: { texture: 'blocks/log_oak_top', uv: [0, 0, 16, 16] },
      north: { texture: 'blocks/log_oak', uv: [0, 0, 16, 16] },
      south: { texture: 'blocks/log_oak', uv: [0, 0, 16, 16], tint: '#77ab2f' }
    }
  }]
}]

describe('a block item\'s model', () => {
  test('a mesh of each texture\'s faces once it has loaded, a block of the size asked for centred on the origin', async () => {
    const group = blockItemMesh(assets(), log, 0.25)
    expect(group.children).toHaveLength(0)
    await flush()
    expect(group.children).toHaveLength(2)
    const [top, sides] = group.children
    expect(top.geometry.index.count).toBe(6)
    expect(sides.geometry.index.count).toBe(12)
    const box = new THREE.Box3().setFromObject(group)
    expect(box.min.toArray()).toEqual([-0.125, -0.125, -0.125])
    expect(box.max.toArray()).toEqual([0.125, 0.125, 0.125])
    // (a tinted face in its colour, the others white)
    const colors = [...sides.geometry.getAttribute('color').array]
    expect(colors.slice(0, 3)).toEqual([1, 1, 1])
    expect(new THREE.Color(...colors.slice(12, 15)).getHexString()).toBe('77ab2f')
  })

  test('its variant\'s turns, an element\'s turn, and an animated texture\'s first frame', async () => {
    const parts = [{
      y: 90,
      elements: [{ from: [0, 0, 7], to: [16, 16, 9], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 }, faces: { north: { texture: 'blocks/fire_0', uv: [0, 0, 16, 16] } } }]
    }]
    const group = blockItemMesh(assets(), parts, 16)
    await flush()
    const [mesh] = group.children
    const v = [...mesh.geometry.getAttribute('uv').array].filter((_, i) => i % 2)
    expect(Math.max(...v)).toBeCloseTo(1 / 32)
    // (a plane across the block, turned 45 then 90 degrees: its normal no longer along an axis)
    const n = new THREE.Vector3().fromArray(mesh.geometry.getAttribute('normal').array)
    expect(Math.abs(n.x)).toBeCloseTo(Math.SQRT1_2)
    expect(Math.abs(n.z)).toBeCloseTo(Math.SQRT1_2)
  })

  test('a face whose texture the version lacks is left out', async () => {
    const group = blockItemMesh(assets(), [{ elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: 'blocks/missing', uv: [0, 0, 16, 16] } } }] }])
    await flush()
    expect(group.children).toHaveLength(0)
    group.userData.dispose()
  })
})

describe('a dropped Bedrock item', () => {
  const items = {
    oak_log: { texture: 'blocks/log_oak', block: log },
    torch: { texture: 'blocks/torch_on' },
    wool: { texture: 'blocks/wool_colored_white', variants: { 14: 'blocks/wool_colored_red' }, block: log }
  }

  test('a block item the game draws as its block is its model, at a quarter of a block', async () => {
    const mesh = getItemMesh('oak_log', 'bedrock_1.26.51', () => null, { textures: assets(items) })
    await flush()
    await flush()
    const [model] = mesh.item.pivot.children
    expect(model.isGroup).toBe(true)
    expect(model.children).toHaveLength(2)
    expect(mesh.item.size).toBe(0.25)
    mesh.dispose()
  })

  test('a torch is its icon drawn flat, not a box', async () => {
    const mesh = getItemMesh('torch', 'bedrock_1.26.51', () => null, { textures: assets(items) })
    await flush()
    const [sprite] = mesh.item.pivot.children
    expect(sprite.geometry.type).toBe('BufferGeometry')
    expect(mesh.item.size).toBe(0.5)
  })

  test('a stack whose aux value picks an icon of its own is that icon', async () => {
    const mesh = getItemMesh('wool', 'bedrock_0.14.3', () => null, { textures: assets(items), aux: 14 })
    await flush()
    const [sprite] = mesh.item.pivot.children
    expect(sprite.isMesh).toBe(true)
    expect(mesh.item.size).toBe(0.5)
  })
})
