/* global THREE */

const entities = require('./entities.json')
const { loadTexture } = globalThis.isElectron ? require('../utils.electron.js') : require('../utils')
let createCanvas
try { ({ createCanvas } = require('canvas')) } catch {}

const elemFaces = {
  up: {
    dir: [0, 1, 0],
    u0: [0, 0, 1],
    v0: [0, 0, 0],
    u1: [1, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0],
      [0, 1, 0, 0, 1],
      [1, 1, 0, 1, 1]
    ]
  },
  down: {
    dir: [0, -1, 0],
    u0: [1, 0, 1],
    v0: [0, 0, 0],
    u1: [2, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [1, 0, 1, 1, 0],
      [0, 0, 1, 0, 0],
      [1, 0, 0, 1, 1],
      [0, 0, 0, 0, 1]
    ]
  },
  east: {
    dir: [1, 0, 0],
    u0: [1, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [1, 1, 1, 1, 0],
      [1, 0, 1, 1, 1],
      [1, 1, 0, 0, 0],
      [1, 0, 0, 0, 1]
    ]
  },
  west: {
    dir: [-1, 0, 0],
    u0: [0, 0, 0],
    v0: [0, 0, 1],
    u1: [0, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [0, 1, 0, 1, 0],
      [0, 0, 0, 1, 1],
      [0, 1, 1, 0, 0],
      [0, 0, 1, 0, 1]
    ]
  },
  north: {
    dir: [0, 0, -1],
    u0: [0, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [1, 0, 0, 1, 1],
      [0, 0, 0, 0, 1],
      [1, 1, 0, 1, 0],
      [0, 1, 0, 0, 0]
    ]
  },
  south: {
    dir: [0, 0, 1],
    u0: [1, 0, 2],
    v0: [0, 0, 1],
    u1: [2, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [0, 0, 1, 1, 1],
      [1, 0, 1, 0, 1],
      [0, 1, 1, 1, 0],
      [1, 1, 1, 0, 0]
    ]
  }
}

function dot (a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

// the size of a face of a cube, [u, v]: its uv_size where per-face uv leaves it out
const faceSize = {
  north: s => [s[0], s[1]],
  south: s => [s[0], s[1]],
  east: s => [s[2], s[1]],
  west: s => [s[2], s[1]],
  up: s => [s[0], s[2]],
  down: s => [s[0], s[2]]
}

// A cube's uv is a box's ([u, v]: its faces laid out around it on the sheet) or one per face ({ north: { uv, uv_size } },
// a face it leaves out not drawn). A mirrored box's east and west faces trade places and every face's u runs the
// other way. A cube's rotation turns it about its pivot (about the model's origin when it has none).
function addCube (attr, boneId, bone, cube, texWidth = 64, texHeight = 64) {
  const cubeRotation = new THREE.Euler(0, 0, 0)
  if (cube.rotation) {
    cubeRotation.x = -cube.rotation[0] * Math.PI / 180
    cubeRotation.y = -cube.rotation[1] * Math.PI / 180
    cubeRotation.z = -cube.rotation[2] * Math.PI / 180
  }
  const cubePivot = cube.pivot ? new THREE.Vector3(...cube.pivot) : null
  for (const [faceName, { dir, corners, u0, v0, u1, v1 }] of Object.entries(elemFaces)) {
    const perFace = Array.isArray(cube.uv) ? null : cube.uv?.[faceName]
    if (!Array.isArray(cube.uv) && !perFace) continue
    const mirrored = cube.mirror && !perFace
    const box = mirrored && faceName === 'east' ? elemFaces.west : mirrored && faceName === 'west' ? elemFaces.east : { u0, v0, u1, v1 }
    const ndx = Math.floor(attr.positions.length / 3)

    for (const pos of corners) {
      let u, v
      if (perFace) {
        const [fw, fh] = perFace.uv_size ?? faceSize[faceName](cube.size)
        u = (perFace.uv[0] + (pos[3] ? fw : 0)) / texWidth
        v = (perFace.uv[1] + (pos[4] ? fh : 0)) / texHeight
      } else {
        const uSide = mirrored ? 1 - pos[3] : pos[3]
        u = (cube.uv[0] + dot(uSide ? box.u1 : box.u0, cube.size)) / texWidth
        v = (cube.uv[1] + dot(pos[4] ? box.v1 : box.v0, cube.size)) / texHeight
      }

      const inflate = cube.inflate ? cube.inflate : 0
      let vecPos = new THREE.Vector3(
        cube.origin[0] + pos[0] * cube.size[0] + (pos[0] ? inflate : -inflate),
        cube.origin[1] + pos[1] * cube.size[1] + (pos[1] ? inflate : -inflate),
        cube.origin[2] + pos[2] * cube.size[2] + (pos[2] ? inflate : -inflate)
      )

      vecPos = cubePivot ? vecPos.sub(cubePivot).applyEuler(cubeRotation).add(cubePivot) : vecPos.applyEuler(cubeRotation)
      vecPos = vecPos.sub(bone.position)
      vecPos = vecPos.applyEuler(bone.rotation)
      vecPos = vecPos.add(bone.position)

      attr.positions.push(vecPos.x, vecPos.y, vecPos.z)
      attr.normals.push(...dir)
      attr.uvs.push(u, v)
      attr.skinIndices.push(boneId, 0, 0, 0)
      attr.skinWeights.push(1, 0, 0, 0)
    }

    attr.indices.push(
      ndx, ndx + 1, ndx + 2,
      ndx + 2, ndx + 1, ndx + 3
    )
  }
}

function applyTexture (material, texture) {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.flipY = false
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  material.map = texture
  material.needsUpdate = true
}

// [x, y, dx, dy, w, h]: the w*h block at (x, y) is copied to (x + dx, y + dy), mirrored horizontally
const legacySkinCopies = [
  [4, 16, 16, 32, 4, 4], [8, 16, 16, 32, 4, 4], [0, 20, 24, 32, 4, 12], [4, 20, 16, 32, 4, 12], [8, 20, 8, 32, 4, 12], [12, 20, 16, 32, 4, 12],
  [44, 16, -8, 32, 4, 4], [48, 16, -8, 32, 4, 4], [40, 20, 0, 32, 4, 12], [44, 20, -8, 32, 4, 12], [48, 20, -16, 32, 4, 12], [52, 20, -8, 32, 4, 12]
]

// RGBA rows of a loaded texture. A DataTexture carries them; an image is drawn once to read them.
function texturePixels (image) {
  if (image.data) return image.data
  const ctx = createCanvas(image.width, image.height).getContext('2d')
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height).data
}

// Same steps as vanilla's HttpTexture.processLegacySkin. Skins predating 1.8 are 64x32 and
// the player geometry samples a 64x64 sheet: the left limbs become mirrored copies of the
// right ones, and an overlay block with no transparency at all was never used as a hat, so
// its hat rows are dropped. Every skin then gets its base layers forced opaque (head, body
// row, lower limbs), which is what makes the second layer the only see-through one. Capes are
// 64x32 by design and never pass through here.
function prepareSkin (texture) {
  const image = texture.image
  if (image.width !== 64 || (image.height !== 32 && image.height !== 64)) return texture
  const src = texturePixels(image)
  const out = new Uint8Array(64 * 64 * 4)
  out.set(src)
  const at = (x, y) => (y * 64 + x) * 4
  if (image.height === 32) {
    for (const [x, y, dx, dy, w, h] of legacySkinCopies) {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          out.set(src.subarray(at(x + i, y + j), at(x + i, y + j) + 4), at(x + dx + w - 1 - i, y + dy + j))
        }
      }
    }
    let opaque = true
    for (let y = 0; y < 32 && opaque; y++) for (let x = 32; x < 64; x++) if (out[at(x, y) + 3] < 128) { opaque = false; break }
    if (opaque) for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) out[at(x, y) + 3] = 0
  }
  for (const [x0, y0, x1, y1] of [[0, 0, 32, 16], [0, 16, 64, 32], [16, 48, 48, 64]]) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[at(x, y) + 3] = 255
  }
  const prepared = new THREE.DataTexture(out, 64, 64, THREE.RGBAFormat)
  prepared.needsUpdate = true
  return prepared
}

// a bone at its rest pose: at its (absolute) pivot, turned by its rotation
function restBone (jsonBone) {
  const bone = new THREE.Bone()
  bone.name = jsonBone.name
  if (jsonBone.pivot) {
    bone.position.x = jsonBone.pivot[0]
    bone.position.y = jsonBone.pivot[1]
    bone.position.z = jsonBone.pivot[2]
  }
  if (jsonBone.bind_pose_rotation) {
    bone.rotation.x = -jsonBone.bind_pose_rotation[0] * Math.PI / 180
    bone.rotation.y = -jsonBone.bind_pose_rotation[1] * Math.PI / 180
    bone.rotation.z = -jsonBone.bind_pose_rotation[2] * Math.PI / 180
  } else if (jsonBone.rotation) {
    bone.rotation.x = -jsonBone.rotation[0] * Math.PI / 180
    bone.rotation.y = -jsonBone.rotation[1] * Math.PI / 180
    bone.rotation.z = -jsonBone.rotation[2] * Math.PI / 180
  }
  return bone
}

// a skin given as its pixels ({ width, height, data: RGBA, base64 or bytes }, as Bedrock sends a player's), or a URL
function loadSkin (skin, cb) {
  if (!skin || typeof skin !== 'object') return loadTexture(skin, cb)
  const bytes = typeof skin.data === 'string' ? Uint8Array.from(atob(skin.data), c => c.charCodeAt(0)) : new Uint8Array(skin.data)
  const texture = new THREE.DataTexture(bytes, skin.width, skin.height, THREE.RGBAFormat)
  texture.needsUpdate = true
  cb(texture)
}

// A model's mesh, on bones of its own, or (shared: another mesh of the entity) on that mesh's skeleton, each cube on
// the bone of its bone's name: a layer over the entity, armor it wears, which move with its limbs.
function getMesh (texture, jsonModel, override, shared = null) {
  const bones = {}

  const geoData = {
    positions: [],
    normals: [],
    uvs: [],
    indices: [],
    skinIndices: [],
    skinWeights: []
  }
  const sharedIndex = shared && new Map(shared.skeleton.bones.map((bone, i) => [bone.name.toLowerCase(), i]))
  let i = 0
  for (const jsonBone of jsonModel.bones) {
    const bone = restBone(jsonBone)
    bones[jsonBone.name] = bone

    if (jsonBone.cubes) {
      const boneId = shared ? sharedIndex.get(jsonBone.name.toLowerCase()) ?? 0 : i
      for (const cube of jsonBone.cubes) {
        addCube(geoData, boneId, bone, cube, jsonModel.texturewidth, jsonModel.textureheight)
      }
    }
    i++
  }

  // Parent names are not cased like the bones they name (piglin parents leftItem to "leftArm"
  // while the bone is "leftarm"), and a model can name a bone it does not define at all (witch's
  // head): that bone stays at the model root rather than failing the whole entity.
  const bonesByName = new Map(jsonModel.bones.map(jsonBone => [jsonBone.name.toLowerCase(), jsonBone]))
  const rootBones = []
  for (const jsonBone of jsonModel.bones) {
    const parent = jsonBone.parent ? bonesByName.get(jsonBone.parent.toLowerCase()) : undefined
    if (parent) {
      const bone = bones[jsonBone.name]
      // pivots are absolute in the json, bone positions are relative to the parent
      if (parent.pivot) bone.position.sub(new THREE.Vector3(...parent.pivot))
      bones[parent.name].add(bone)
    } else rootBones.push(bones[jsonBone.name])
  }

  const skeleton = shared ? shared.skeleton : new THREE.Skeleton(Object.values(bones))

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(geoData.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(geoData.normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(geoData.uvs, 2))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(geoData.skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(geoData.skinWeights, 4))
  geometry.setIndex(geoData.indices)

  const material = new THREE.MeshLambertMaterial({ transparent: true, skinning: true, alphaTest: 0.1 })
  const mesh = new THREE.SkinnedMesh(geometry, material)
  if (shared) {
    // (where it is drawn is where the shared bones are)
    mesh.bind(skeleton, shared.bindMatrix)
    mesh.frustumCulled = false
  } else {
    mesh.add(...rootBones)
    mesh.bind(skeleton)
  }
  // Model space is x-mirrored relative to the world (Bedrock geometry, same as Java's model
  // space, which vanilla draws under a (-1, -1, 1) scale): the left arm sits at +x. Flip it
  // so the player's left limbs end up on their left; the face UVs below are laid out for this.
  mesh.scale.set(-1 / 16, 1 / 16, 1 / 16)

  // Textures load the first time the mesh is drawn, so an entity the camera
  // never sees (a player across the server) costs no fetch.
  mesh.onBeforeRender = () => {
    mesh.onBeforeRender = () => {}
    if (texture) {
      loadTexture(texture, texture => {
        applyTexture(material, texture)
        if (override) loadSkin(override, texture => applyTexture(material, prepareSkin(texture)))
      })
    } else {
      loadSkin(override, texture => applyTexture(material, texture))
    }
  }

  return mesh
}

// A version's texture path ('textures/entity/zombie/zombie' -> 'textures/<version>/entity/zombie/zombie.png')
const texturePath = (version, texture) => texture.replace('textures', 'textures/' + version) + '.png'

class Entity {
  // models: the entity models by name (the bundled entities.json; a Bedrock version's own, from its assets). Every
  // layer after the first is drawn on the first's bones, so that it moves with them.
  constructor (version, type, scene, textures = {}, models = entities) {
    const e = models[type]
    if (!e) throw new Error(`Unknown entity ${type}`)

    this.version = version
    this.mesh = new THREE.Object3D()
    this.skinned = null
    for (const [name, jsonModel] of Object.entries(e.geometry)) {
      const texture = e.textures[name]
      if (!texture && !textures[name]) continue
      const mesh = getMesh(texture && texturePath(version, texture), jsonModel, textures[name], this.skinned)
      this.skinned ??= mesh
      this.mesh.add(mesh)
    }
  }

  // a bone of the entity by name, whatever its case
  bone (name) {
    return this.skinned?.skeleton.bones.find(bone => bone.name.toLowerCase() === name.toLowerCase()) ?? null
  }

  // what it wears (an attachable: { geometry, texture }), on its bones
  wear (attachable) {
    if (!this.skinned) return null
    const mesh = getMesh(texturePath(this.version, attachable.texture), attachable.geometry, undefined, this.skinned)
    this.mesh.add(mesh)
    return mesh
  }
}

module.exports = Entity
