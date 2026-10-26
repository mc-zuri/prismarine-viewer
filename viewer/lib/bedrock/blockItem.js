// A block item the game draws as its block (a log, a slab, a chest; a torch or a flower it draws flat, as its icon): the
// model entity/prerender.js keeps of it (the entity assets' items[name].block), the boxes of its block's default state
// drawn as viewer/lib/models.js draws a block in the world, each face with its texture and the colour of a tinted one.
const THREE = require('three')
const { elemFaces } = require('../elemFaces')

const D = Math.PI / 180
const turn = { x: a => new THREE.Matrix4().makeRotationX(a), y: a => new THREE.Matrix4().makeRotationY(a), z: a => new THREE.Matrix4().makeRotationZ(a) }

// an element's turn about its origin, in model pixels
function elementMatrix (rotation) {
  if (!rotation?.angle) return new THREE.Matrix4()
  const [x, y, z] = rotation.origin ?? [8, 8, 8]
  return new THREE.Matrix4().makeTranslation(x, y, z)
    .multiply(turn[rotation.axis](rotation.angle * D))
    .multiply(new THREE.Matrix4().makeTranslation(-x, -y, -z))
}

// the faces of one texture as a geometry: positions by matrix (model pixels to the mesh's space), UVs of the texture's
// first frame (frame: its height over the texture's)
function facesGeometry (faces, frame) {
  const positions = []
  const normals = []
  const uvs = []
  const colors = []
  const indices = []
  const normalMatrix = new THREE.Matrix3()
  for (const { side, face, element, matrix } of faces) {
    const { dir, corners } = elemFaces[side]
    const [u0, v0, u1, v1] = face.uv.map(c => c / 16)
    const r = (face.rotation ?? 0) * D
    const cos = Math.cos(r)
    const sin = -Math.sin(r)
    const tint = new THREE.Color(face.tint ?? '#ffffff')
    const normal = new THREE.Vector3(...dir).applyMatrix3(normalMatrix.getNormalMatrix(matrix)).normalize()
    const base = positions.length / 3
    for (const corner of corners) {
      const p = new THREE.Vector3(...[0, 1, 2].map(i => corner[i] ? element.to[i] : element.from[i])).applyMatrix4(matrix)
      positions.push(p.x, p.y, p.z)
      normals.push(normal.x, normal.y, normal.z)
      // (the corner's place in the face's UV rectangle, turned by the face's rotation)
      const u = (corner[3] - 0.5) * cos - (corner[4] - 0.5) * sin + 0.5
      const v = (corner[3] - 0.5) * sin + (corner[4] - 0.5) * cos + 0.5
      uvs.push(u0 + u * (u1 - u0), (v0 + v * (v1 - v0)) * frame)
      colors.push(tint.r, tint.g, tint.b)
    }
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  return geometry
}

/**
 * A block item's model as meshes, a block `size` units wide centred on the origin; each texture's faces are added once
 * its texture has loaded. assets: the version's entity assets (their textures); parts: items[name].block.
 * -> THREE.Group, userData.dispose() frees what it made
 */
function blockItemMesh (assets, parts, size = 1) {
  const group = new THREE.Group()
  let disposed = false
  const owned = []
  group.userData.dispose = () => {
    disposed = true
    for (const mesh of owned) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
  // (each face's matrix: its element's turn, its variant's turns about the block's centre, then the block to size)
  const byTexture = new Map()
  for (const part of parts) {
    const variant = new THREE.Matrix4().makeScale(size / 16, size / 16, size / 16)
      .multiply(turn.y(-(part.y ?? 0) * D)).multiply(turn.x(-(part.x ?? 0) * D))
      .multiply(new THREE.Matrix4().makeTranslation(-8, -8, -8))
    for (const element of part.elements) {
      const matrix = variant.clone().multiply(elementMatrix(element.rotation))
      for (const [side, face] of Object.entries(element.faces)) {
        if (!elemFaces[side]) continue
        if (!byTexture.has(face.texture)) byTexture.set(face.texture, [])
        byTexture.get(face.texture).push({ side, face, element, matrix })
      }
    }
  }
  for (const [path, faces] of byTexture) {
    const map = assets.texture(path)
    if (!map) continue
    map.userData.ready.then(() => {
      if (disposed) return
      // (an animated texture is a strip of square frames: the first is drawn)
      const { width, height } = map.image
      const frame = height > width && height % width === 0 ? width / height : 1
      const material = new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
      const mesh = new THREE.Mesh(facesGeometry(faces, frame), material)
      owned.push(mesh)
      group.add(mesh)
    }, () => {})
  }
  return group
}

module.exports = { blockItemMesh }
