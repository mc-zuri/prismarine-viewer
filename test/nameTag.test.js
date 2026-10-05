/**
 * @jest-environment node
 */
/* eslint-env jest */
// The names over entities: drawn in the game's font (read here from minecraft-assets, as prerender.js copies it into
// public/textures/<version>/), their § codes, the pictures shared by every entity of a name.

const THREE = require('three')

jest.mock('../viewer/lib/utils', () => ({
  loadImage: (url, onLoad, onError) => {
    const mockPath = require('path')
    const file = mockPath.join(mockPath.dirname(require.resolve('minecraft-assets/package.json')), 'minecraft-assets/data', url.replace(/^textures\//, ''))
    require('canvas').loadImage(file).then(onLoad, onError)
  }
}))

const { createNameTag, parse, loadFont } = require('../viewer/lib/nameTag')

const meshesOf = tag => tag.children.filter(o => o.isMesh)
const widthOf = tag => {
  const text = meshesOf(tag)[2].geometry
  text.computeBoundingBox()
  return text.boundingBox.max.x - text.boundingBox.min.x
}

describe('name tags', () => {
  test('§ codes colour the text, bold it and reset it; Bedrock has colours of its own', () => {
    const [first, second] = parse('§aHi§r!\n§lYo', false)
    expect(first.map(c => [c.char, c.colour])).toEqual([['H', '#55ff55'], ['i', '#55ff55'], ['!', '#ffffff']])
    expect(second.every(c => c.bold)).toBe(true)
    expect(parse('§mX', true)[0][0].colour).toBe('#971607')
    expect(parse('§mX', false)[0][0].colour).toBe('#ffffff')
  })

  test('a name is as wide as its glyphs in the font, a pixel apart, with a pixel of box each side', async () => {
    expect(await loadFont()).not.toBe(null)
    const tag = createNameTag({ name: 'Steve', height: 1.8 })
    await loadFont()
    expect(meshesOf(tag)).toHaveLength(3)
    // S, e, v: 5 pixels wide, t: 3; each and a pixel; and the box's
    expect(widthOf(tag)).toBe(6 + 4 + 6 + 6 + 6 + 1)
    expect(tag.position.y).toBeCloseTo(2.3)
    tag.dispose()
    expect(meshesOf(tag)).toHaveLength(0)
  })

  test('entities of one name share its picture, until the last of them is gone', async () => {
    const a = createNameTag({ name: 'Alex' })
    const b = createNameTag({ name: 'Alex' })
    await loadFont()
    const texture = meshesOf(a)[1].material.map
    expect(meshesOf(b)[1].material.map).toBe(texture)
    const disposed = jest.fn()
    texture.addEventListener('dispose', disposed)
    a.dispose()
    expect(disposed).not.toHaveBeenCalled()
    b.dispose()
    expect(disposed).toHaveBeenCalled()
  })

  test('a sneaking entity\'s name is not seen through walls; a name can change, or go', async () => {
    const tag = createNameTag({ name: 'Steve' })
    await loadFont()
    const [box, faint, solid] = meshesOf(tag)
    expect(box.material.depthTest).toBe(false)
    tag.setSneaking(true)
    expect(box.material.depthTest).toBe(true)
    expect(faint.material.depthTest).toBe(true)
    expect(solid.visible).toBe(false)
    tag.setName('Steve the second')
    await loadFont()
    expect(widthOf(tag)).toBeGreaterThan(30)
    expect(meshesOf(tag)[2].visible).toBe(false)
    tag.setName('')
    await loadFont()
    expect(meshesOf(tag)).toHaveLength(0)

    // Bedrock's is not faint, only hidden by what is in front of it
    const bedrock = createNameTag({ name: 'Steve', bedrock: true })
    await loadFont()
    bedrock.setSneaking(true)
    const [back, , text] = meshesOf(bedrock)
    expect(back.material.depthTest).toBe(true)
    expect(text.visible).toBe(true)
    expect(text.material.depthTest).toBe(true)
  })

  test('it faces the camera, whichever way the entity turns', async () => {
    const entity = new THREE.Group()
    entity.rotation.y = 1.2
    const tag = createNameTag({ name: 'Steve' })
    entity.add(tag)
    await loadFont()
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(3, 4, 5)
    camera.lookAt(0, 2, 0)
    camera.updateMatrixWorld()
    entity.updateMatrixWorld()
    const mesh = meshesOf(tag)[2]
    mesh.onBeforeRender(null, null, camera)
    const turn = new THREE.Quaternion()
    mesh.matrixWorld.decompose(new THREE.Vector3(), turn, new THREE.Vector3())
    expect(turn.angleTo(camera.quaternion)).toBeLessThan(1e-6)
  })
})
