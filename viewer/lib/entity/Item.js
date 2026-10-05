const THREE = require('three')
const { loadTexture, loadPixels, loadJSON } = globalThis.isElectron ? require('../utils.electron.js') : require('../utils')
const { itemIcon, isComposed, composeIcon } = require('../bedrock/itemIcon')

// Ground display of the two item model parents: item/generated is the sprite at half scale extruded one
// pixel deep, block/block is the block at quarter scale.
const FLAT_SCALE = 0.5
const FLAT_DEPTH = 1 / 16
const BLOCK_SCALE = 0.25

const indexes = {}

function itemTextures (version) {
  if (!indexes[version]) {
    indexes[version] = new Promise(resolve => loadJSON(`textures/${version}/items_textures.json`, entries => {
      const byName = {}
      for (const entry of entries) byName[entry.name] = entry.texture
      resolve(byName)
    }))
  }
  return indexes[version]
}

// 'minecraft:block/white_wool' -> 'textures/26.1/blocks/white_wool.png'
function texturePath (version, texture) {
  return `textures/${version}/${texture.replace(/^minecraft:/, '').replace(/^block\//, 'blocks/')}.png`
}

// The sprite as the vanilla item model builder makes it: the picture on both faces and a rim of side
// quads wherever an opaque texel borders a transparent one, so the silhouette has thickness.
function spriteGeometry (pixels, size, depth) {
  // An animated texture is a vertical strip of square frames; only the first is rendered.
  const w = pixels.width
  const h = pixels.height >= w && pixels.height % w === 0 ? w : pixels.height
  const opaque = (x, y) => x >= 0 && y >= 0 && x < w && y < h && pixels.data[(y * pixels.width + x) * 4 + 3] > 0

  const positions = []
  const normals = []
  const uvs = []
  const px = x => (x / w - 0.5) * size
  const py = y => (0.5 - y / h) * size
  const pu = x => x / pixels.width
  const pv = y => 1 - y / pixels.height
  const quad = (corners, normal, uv) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(corners[i][0], corners[i][1], corners[i][2])
      normals.push(normal[0], normal[1], normal[2])
      uvs.push(uv[i][0], uv[i][1])
    }
  }

  const d = depth / 2
  const vb = pv(h); const vt = pv(0)
  quad([[-size / 2, -size / 2, d], [size / 2, -size / 2, d], [size / 2, size / 2, d], [-size / 2, size / 2, d]],
    [0, 0, 1], [[0, vb], [1, vb], [1, vt], [0, vt]])
  quad([[size / 2, -size / 2, -d], [-size / 2, -size / 2, -d], [-size / 2, size / 2, -d], [size / 2, size / 2, -d]],
    [0, 0, -1], [[1, vb], [0, vb], [0, vt], [1, vt]])

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue
      const u0 = pu(x); const u1 = pu(x + 1); const v0 = pv(y + 1); const v1 = pv(y)
      const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
      if (!opaque(x - 1, y)) quad([[px(x), py(y + 1), -d], [px(x), py(y + 1), d], [px(x), py(y), d], [px(x), py(y), -d]], [-1, 0, 0], uv)
      if (!opaque(x + 1, y)) quad([[px(x + 1), py(y + 1), d], [px(x + 1), py(y + 1), -d], [px(x + 1), py(y), -d], [px(x + 1), py(y), d]], [1, 0, 0], uv)
      if (!opaque(x, y - 1)) quad([[px(x), py(y), d], [px(x + 1), py(y), d], [px(x + 1), py(y), -d], [px(x), py(y), -d]], [0, 1, 0], uv)
      if (!opaque(x, y + 1)) quad([[px(x), py(y + 1), -d], [px(x + 1), py(y + 1), -d], [px(x + 1), py(y + 1), d], [px(x), py(y + 1), d]], [0, -1, 0], uv)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

// A Java item's icon: the texture of its entry in the version's items_textures.json
function javaIcon (version, texture) {
  if (!texture || !/^(minecraft:)?(items|block)\//.test(texture)) return null
  return { path: texturePath(version, texture), isBlock: /^(minecraft:)?block\//.test(texture) }
}

// A Bedrock item's icon: the texture its stack's aux value picks (a bed's colour, a potion's effect), else its own,
// with its overlay and colours (a leather helmet's dye: bedrock/itemIcon.js); textures are named as items/bed_red,
// blocks/wool_colored_red
function bedrockIcon (assets, itemName, aux) {
  const icon = itemIcon(assets.items, itemName, aux)
  const path = icon && /^(items|blocks)\//.test(icon.texture) ? assets.textureUrl(icon.texture) : null
  if (!path) return null
  const composed = isComposed(icon) ? { overlay: icon.overlay ? assets.textureUrl(icon.overlay) : null, tint: icon.tint } : null
  return { path, isBlock: icon.texture.startsWith('blocks/'), composed }
}

// a texture of RGBA pixels, rows from the top as an image's are drawn
function pixelsTexture ({ width, height, data }) {
  const rows = new Uint8Array(data.length)
  for (let y = 0; y < height; y++) rows.set(data.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4)
  const map = new THREE.DataTexture(rows, width, height, THREE.RGBAFormat)
  map.needsUpdate = true
  return map
}

/**
 * A dropped item of `itemName`. The mesh stays empty until the version's texture index and the texture
 * have loaded; an item the index has no usable texture for gets `fallback()` instead. Disposing the group
 * frees what it created and drops any load still in flight.
 * options, of a Bedrock version: { textures: its entity assets (bedrock/entity/assets.js), which have its items'
 * icons, aux: the stack's aux value }
 */
function getItemMesh (itemName, version, fallback, options = {}) {
  const group = new THREE.Object3D()
  const pivot = new THREE.Object3D()
  group.add(pivot)
  group.item = { pivot, size: 0, age: 0, bobOffset: Math.random() * Math.PI * 2 }

  let disposed = false
  const owned = []
  group.dispose = () => {
    disposed = true
    // The map is shared through the texture cache, so only the geometry and material are ours.
    for (const mesh of owned) {
      mesh.geometry.dispose()
      mesh.material.userData.ownMap?.dispose()
      mesh.material.dispose()
    }
  }
  const attach = (parent, mesh) => {
    owned.push(mesh)
    parent.add(mesh)
  }

  const draw = icon => {
    if (disposed) return
    if (!icon) {
      attach(group, fallback())
      return
    }
    const { path, isBlock, composed } = icon
    const size = isBlock ? BLOCK_SCALE : FLAT_SCALE
    const show = (pixels, map) => {
      if (disposed) return
      map.magFilter = THREE.NearestFilter
      map.minFilter = THREE.NearestFilter
      const geometry = isBlock ? new THREE.BoxGeometry(size, size, size) : spriteGeometry(pixels, size, size * FLAT_DEPTH)
      const material = new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.1 })
      // (a texture of its own, made of its pixels, is the mesh's to free)
      if (composed) material.userData = { ownMap: map }
      attach(pivot, new THREE.Mesh(geometry, material))
      group.item.size = size
    }
    if (!composed) {
      loadPixels(path, pixels => loadTexture(path, map => show(pixels, map)))
      return
    }
    // its texture and overlay, coloured, made into one picture
    loadPixels(path, base => {
      const withOverlay = overlay => {
        const pixels = composeIcon(base, overlay, composed.tint)
        show(pixels, pixelsTexture(pixels))
      }
      if (composed.overlay) loadPixels(composed.overlay, withOverlay)
      else withOverlay(null)
    })
  }
  if (options.textures) Promise.resolve().then(() => draw(bedrockIcon(options.textures, itemName, options.aux)))
  else itemTextures(version).then(byName => draw(javaIcon(version, byName[itemName])))

  return group
}

// Vanilla ItemEntityRenderer: bob sin(age / 10 + bobOffset) * 0.1 + 0.1, spin age / 20 + bobOffset radians.
function animateItem (mesh, ticks) {
  const item = mesh.item
  item.age += ticks
  item.pivot.position.y = item.size / 2 + 0.1 + Math.sin(item.age / 10 + item.bobOffset) * 0.1
  item.pivot.rotation.y = item.age / 20 + item.bobOffset
}

module.exports = { getItemMesh, animateItem, spriteGeometry }
