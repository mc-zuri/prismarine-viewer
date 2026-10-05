// Bedrock entity geometry as three.js objects: a group per bone, nested as the bones are, each holding one mesh of
// its cubes per material layer.
//
// The conventions are Blockbench's, which reads and draws Bedrock models as the game does:
//  - model space is Bedrock's mirrored on x: a pivot or cube x becomes -x
//  - rotations are degrees in ZYX order, x and y negated (z kept) for the mirror
//  - a cube is a BoxGeometry; box UV lays its faces out from [u, v] by its (floored) size, mirrored when the cube
//    or its bone says so; per-face UV maps [u, v] + uv_size onto the face, up and down turned half round
// A bone's rotation is its rest pose (the exporter gives a 1.8 bone's bind_pose_rotation as it); animations add to it.
// A bone may also hold a poly_mesh: faces of its own (a persona skin's).
// Units are pixels: the caller scales the whole by 1/16.
const THREE = require('three')

const DEG = Math.PI / 180
const FACES = ['east', 'west', 'up', 'down', 'south', 'north'] // BoxGeometry's group order: +x -x +y -y +z -z

// Bedrock rotation (degrees) -> three Euler in the mirrored space
function euler (r) {
  return new THREE.Euler(-(r?.[0] ?? 0) * DEG, -(r?.[1] ?? 0) * DEG, (r?.[2] ?? 0) * DEG, 'ZYX')
}

const mirrorX = (v) => [-v[0], v[1], v[2]]

// [u0, v0, u1, v1] per face, Blockbench's box UV layout
function boxUv (uv, size, mirror) {
  const [w, h, d] = size.map(s => Math.floor(s + 1e-7))
  const list = {
    east: { from: [0, d], size: [d, h] },
    west: { from: [d + w, d], size: [d, h] },
    up: { from: [d + w, d], size: [-w, -d] },
    down: { from: [d + w * 2, 0], size: [-w, d] },
    south: { from: [d * 2 + w, d], size: [w, h] },
    north: { from: [d, d], size: [w, h] }
  }
  if (mirror) {
    for (const f of Object.values(list)) {
      f.from[0] += f.size[0]
      f.size[0] *= -1
    }
    const east = list.east
    list.east = list.west
    list.west = east
  }
  const out = {}
  for (const [face, f] of Object.entries(list)) {
    out[face] = { rect: [f.from[0] + uv[0], f.from[1] + uv[1], f.from[0] + f.size[0] + uv[0], f.from[1] + f.size[1] + uv[1]], rotation: 0, box: true }
  }
  return out
}

// a face's size on its cube: the UV size of a face that names none (Blockbench's auto UV)
const FACE_SIZE = {
  north: s => [s[0], s[1]],
  south: s => [s[0], s[1]],
  east: s => [s[2], s[1]],
  west: s => [s[2], s[1]],
  up: s => [s[0], s[2]],
  down: s => [s[0], s[2]]
}

// [u0, v0, u1, v1] per face of a per-face UV cube; faces it leaves out are not drawn
function faceUv (uv, cubeSize) {
  const out = {}
  for (const face of FACES) {
    const f = uv[face]
    if (!f || !f.uv) continue
    const size = f.uv_size ?? FACE_SIZE[face](cubeSize)
    let rect = [f.uv[0], f.uv[1], f.uv[0] + size[0], f.uv[1] + size[1]]
    if (face === 'up' || face === 'down') rect = [rect[2], rect[3], rect[0], rect[1]]
    out[face] = { rect, rotation: f.uv_rotation ?? 0 }
  }
  return out
}

// the four vertex UVs of a face (BoxGeometry vertex order: 0,1 / 1,1 / 0,0 / 1,0 of the face as seen from outside)
function vertexUvs ({ rect, rotation, box }, tw, th) {
  rect = rect.slice()
  if (box) {
    // Blockbench's margin against bleeding at box UV edges
    for (let i = 0; i < 2; i++) {
      const margin = rect[i] > rect[i + 2] ? -1 / 64 : 1 / 64
      rect[i] += margin
      rect[i + 2] -= margin
    }
  }
  let arr = [
    [rect[0] / tw, rect[1] / th],
    [rect[2] / tw, rect[1] / th],
    [rect[0] / tw, rect[3] / th],
    [rect[2] / tw, rect[3] / th]
  ]
  for (let rot = rotation; rot > 0; rot -= 90) arr = [arr[2], arr[0], arr[3], arr[1]]
  return arr
}

// one cube's geometry, relative to its bone's pivot (mirrored space); bind: the bone's 1.8 bind pose rotation
function cubeGeometry (cube, bonePivot, boneMirror, boneInflate, tw, th, bind) {
  const size = cube.size
  const inflate = cube.inflate ?? boneInflate ?? 0
  // mirrored: x spans [-(origin.x + size.x), -origin.x]
  const from = [-(cube.origin[0] + size[0]), cube.origin[1], cube.origin[2]]
  const to = [from[0] + size[0], from[1] + size[1], from[2] + size[2]]
  const box = new THREE.BoxGeometry(
    Math.max(size[0] + inflate * 2, 0.0001),
    Math.max(size[1] + inflate * 2, 0.0001),
    Math.max(size[2] + inflate * 2, 0.0001)
  )
  // box UV from an offset; a cube naming no UV takes box UV from [0, 0]
  const mirror = cube.mirror ?? boneMirror ?? false
  let uvs
  if (cube.uv === undefined) uvs = boxUv([0, 0], size, mirror)
  else if (Array.isArray(cube.uv)) uvs = boxUv(cube.uv, size, mirror)
  else uvs = faceUv(cube.uv, size)

  // per-face UVs, and the faces a per-face cube leaves out dropped
  const uvAttr = box.attributes.uv
  const keep = []
  FACES.forEach((face, i) => {
    const f = uvs[face]
    if (!f) return
    vertexUvs(f, tw, th).forEach((uv, j) => uvAttr.setXY(i * 4 + j, uv[0], uv[1]))
    keep.push(i)
  })
  const geometry = box
  if (keep.length < 6) {
    const index = box.index.array
    const kept = []
    for (const i of keep) kept.push(...index.slice(i * 6, i * 6 + 6))
    box.setIndex(kept)
  }

  // to the cube's place: centre, then its own rotation about its pivot (its centre when it names none), then the
  // bone's bind pose about the bone's pivot, then relative to the bone
  const centre = new THREE.Vector3((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2)
  const m = new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z)
  const turn = (rotation, pivot) => {
    m.premultiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
    m.premultiply(new THREE.Matrix4().makeRotationFromEuler(euler(rotation)))
    m.premultiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z))
  }
  if (cube.rotation && cube.rotation.some(Boolean)) turn(cube.rotation, cube.pivot ? new THREE.Vector3(...mirrorX(cube.pivot)) : centre)
  if (bind && bind.some(Boolean)) turn(bind, bonePivot)
  m.premultiply(new THREE.Matrix4().makeTranslation(-bonePivot.x, -bonePivot.y, -bonePivot.z))
  geometry.applyMatrix4(m)
  return geometry
}

// a poly_mesh (a persona skin's): its corners are model space, as cube origins are; each face is a triangle or a quad of
// [position, normal, uv] indexes (or, with polys 'tri_list' / 'quad_list', the lists read in order). The faces are
// wound by their normals, which say which side is out; uvs run from the bottom left (unlike a cube's), 0..1 when
// normalized, else in pixels.
function polyGeometry (mesh, bonePivot, tw, th) {
  const positions = []
  const normals = []
  const uvs = []
  const index = []
  let polys = mesh.polys
  if (typeof polys === 'string') {
    const n = polys === 'quad_list' ? 4 : 3
    polys = []
    for (let i = 0; i + n <= mesh.positions.length; i += n) polys.push([...Array(n).keys()].map(k => [i + k, i + k, i + k]))
  }
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (const poly of polys) {
    if (!Array.isArray(poly) || poly.length < 3) continue
    const first = positions.length / 3
    const facing = new THREE.Vector3()
    for (const [p, n, t] of poly) {
      const at = mesh.positions[p] ?? [0, 0, 0]
      positions.push(-at[0] - bonePivot.x, at[1] - bonePivot.y, at[2] - bonePivot.z)
      const normal = mesh.normals[n] ?? [0, 0, 0]
      normals.push(-normal[0], normal[1], normal[2])
      facing.x -= normal[0]
      facing.y += normal[1]
      facing.z += normal[2]
      const uv = mesh.uvs[t] ?? [0, 0]
      uvs.push(...(mesh.normalized_uvs ? [uv[0], 1 - uv[1]] : [uv[0] / tw, 1 - uv[1] / th]))
    }
    const corner = (i, v) => v.fromArray(positions, (first + i) * 3)
    for (let i = 1; i + 1 < poly.length; i++) {
      corner(0, a)
      corner(i, b)
      corner(i + 1, c)
      const out = b.sub(a).cross(c.sub(a)).dot(facing) >= 0
      index.push(first, first + (out ? i : i + 1), first + (out ? i + 1 : i))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(index)
  return geometry
}

function mergeGeometries (list) {
  if (list.length === 1) return list[0]
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  let offset = 0
  for (const g of list) {
    positions.push(...g.attributes.position.array)
    normals.push(...g.attributes.normal.array)
    uvs.push(...g.attributes.uv.array)
    for (const i of g.index.array) indices.push(i + offset)
    offset += g.attributes.position.count
    g.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  merged.setIndex(indices)
  return merged
}

// geometry (exported, normalized) -> { root, bones: Map(lower-case name -> { group, name, pivot, rest, geometry }) }
// Each bone's cube geometry is built once; meshes are added per layer by addMeshes.
function buildSkeleton (geo) {
  const tw = geo.texture_width || 64
  const th = geo.texture_height || 64
  const root = new THREE.Group()
  const bones = new Map()
  for (const b of geo.bones) {
    const group = new THREE.Group()
    group.name = b.name
    const pivot = new THREE.Vector3(...mirrorX(b.pivot ?? [0, 0, 0]))
    const rest = euler(b.rotation)
    group.rotation.copy(rest)
    const parts = b.neverRender ? [] : (b.cubes ?? []).map(c => cubeGeometry(c, pivot, b.mirror, b.inflate, tw, th, b.bind))
    if (b.poly_mesh && !b.neverRender) parts.push(polyGeometry(b.poly_mesh, pivot, tw, th))
    const geometry = parts.length ? mergeGeometries(parts) : null
    bones.set(b.name.toLowerCase(), {
      group,
      name: b.name,
      pivot,
      rest,
      restPosition: null,
      geometry,
      parent: b.parent?.toLowerCase(),
      locators: b.locators,
      // what an animation's `this` starts from (Bedrock space): the rest rotation, and the pivot relative to the
      // parent's, a root bone's relative to the old model origin (0, 24, 0) ("-16 - this" holds a wolf's leg still)
      thisRotation: (b.rotation ?? [0, 0, 0]).slice(0, 3),
      thisPosition: null
    })
  }
  for (const bone of bones.values()) {
    const parent = bone.parent ? bones.get(bone.parent) : null
    const at = parent ? bone.pivot.clone().sub(parent.pivot) : bone.pivot.clone()
    bone.group.position.copy(at)
    bone.restPosition = at.clone()
    const origin = parent ? parent.pivot : new THREE.Vector3(0, 24, 0)
    bone.thisPosition = [-(bone.pivot.x - origin.x), bone.pivot.y - origin.y, bone.pivot.z - origin.z]
    ;(parent ? parent.group : root).add(bone.group)
  }
  return { root, bones, textureWidth: tw, textureHeight: th }
}

// a mesh per bone with cubes, under the bone's group, drawn with materialFor(boneName)
function addMeshes (skeleton, materialFor, renderOrder = 0) {
  const meshes = []
  for (const bone of skeleton.bones.values()) {
    if (!bone.geometry) continue
    const material = materialFor(bone.name)
    if (!material) continue
    const mesh = new THREE.Mesh(bone.geometry, material)
    mesh.renderOrder = renderOrder
    mesh.frustumCulled = false
    bone.group.add(mesh)
    meshes.push(mesh)
  }
  return meshes
}

function disposeSkeleton (skeleton) {
  for (const bone of skeleton.bones.values()) bone.geometry?.dispose()
}

module.exports = { buildSkeleton, addMeshes, disposeSkeleton, euler, mirrorX, boxUv, faceUv, FACES, DEG }
