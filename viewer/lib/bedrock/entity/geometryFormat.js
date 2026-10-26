// Geometry files as packs and player skins write them, in the one form geometry.js draws. A file holds 1.12+
// definitions ({ "minecraft:geometry": [{ description: { identifier }, bones }] }) or 1.8 ones
// ({ "geometry.child:geometry.parent": { bones } }); a definition takes its parent's bones, each merged with its own
// bone of the same name: what the own bone says (its pivot, its inflate, its cubes...) over what it inherits, and none
// of the inherited cubes where it says "reset" (the armour geometries are the zombie's, inflated, each piece resetting
// the bones it does not cover). The export (the integration repo's export-bedrock-entities.mjs) and a skin read at
// run time both go through here.
//
// normalized: { texture_width, texture_height, visible_bounds_*?, bones: [{ name, parent?, pivot, rotation?, bind?,
//   mirror?, inflate?, neverRender?, locators?, binding? (an attachable's: Molang naming the wearer's bone it goes on),
//   cubes?: [{ origin, size, uv?, pivot?, rotation?, inflate?, mirror? }], poly_mesh?: { positions, normals, uvs, polys, normalized_uvs } }] }

const vec = (v, d = [0, 0, 0]) => Array.isArray(v) && v.length >= 3 ? v.slice(0, 3).map(Number) : d

function normalizeCube (c) {
  const cube = { origin: vec(c.origin), size: vec(c.size) }
  if (c.uv !== undefined) cube.uv = c.uv
  if (c.pivot) cube.pivot = vec(c.pivot)
  if (c.rotation) cube.rotation = vec(c.rotation)
  if (c.inflate !== undefined) cube.inflate = c.inflate
  if (c.mirror !== undefined) cube.mirror = c.mirror
  return cube
}

// a bone; legacy: 1.8, whose bind_pose_rotation turns the bone's own cubes only (b.inheritedBind: the bind pose a
// lower pack's 1.8 copy gave a bone that a 1.12+ copy names no rotation for)
function normalizeBone (b, legacy) {
  const bone = { name: b.name }
  if (b.parent) bone.parent = b.parent
  bone.pivot = vec(b.pivot)
  if (b.rotation && b.rotation.some(Number)) bone.rotation = vec(b.rotation)
  const bind = legacy ? b.bind_pose_rotation : b.inheritedBind
  if (bind && bind.some(Number)) bone.bind = vec(bind)
  if (b.mirror !== undefined) bone.mirror = b.mirror
  if (b.inflate !== undefined) bone.inflate = b.inflate
  if (b.neverRender) bone.neverRender = true
  if (b.locators) bone.locators = b.locators
  if (typeof b.binding === 'string') bone.binding = b.binding
  if (b.cubes?.length) bone.cubes = b.cubes.map(normalizeCube)
  const mesh = b.poly_mesh
  if (mesh?.positions?.length && mesh.polys) {
    bone.poly_mesh = { positions: mesh.positions, normals: mesh.normals ?? [], uvs: mesh.uvs ?? [], polys: mesh.polys, normalized_uvs: !!mesh.normalized_uvs }
  }
  return bone
}

// a bone a definition inherits, with what its own bone of that name says over it
function mergeBone (inherited, b, legacy) {
  const own = normalizeBone(b, legacy)
  const bone = { ...inherited, name: own.name }
  if (b.reset) {
    delete bone.cubes
    delete bone.poly_mesh
  }
  if (b.parent !== undefined) bone.parent = own.parent
  if (b.pivot !== undefined) bone.pivot = own.pivot
  if (b.rotation !== undefined) {
    if (own.rotation) bone.rotation = own.rotation
    else delete bone.rotation
  }
  if ((legacy ? b.bind_pose_rotation : b.inheritedBind) !== undefined) {
    if (own.bind) bone.bind = own.bind
    else delete bone.bind
  }
  for (const key of ['mirror', 'inflate', 'neverRender', 'locators', 'binding']) if (own[key] !== undefined) bone[key] = own[key]
  if (b.cubes !== undefined) {
    if (own.cubes) bone.cubes = own.cubes
    else delete bone.cubes
  }
  if (b.poly_mesh !== undefined && own.poly_mesh) bone.poly_mesh = own.poly_mesh
  return bone
}

// the definitions of a file: [{ id, parent?, data, legacy }]
function geometryEntries (file) {
  const entries = []
  if (!file || typeof file !== 'object') return entries
  for (const data of [file['minecraft:geometry']].flat().filter(Boolean)) {
    const id = data.description?.identifier
    if (id) entries.push({ id, data, legacy: false })
  }
  for (const [key, data] of Object.entries(file)) {
    if (!key.startsWith('geometry.') || !data || typeof data !== 'object') continue
    const [id, parent] = key.split(':')
    entries.push({ id, parent, data, legacy: true })
  }
  return entries
}

// a definition resolved: defs maps an id to an entry; a parent defs lacks is looked up with external(id), which gives
// a geometry already normalized (a skin's 1.8 model built on the pack's geometry.humanoid)
function resolveGeometry (id, defs, external = () => null, seen = new Set()) {
  const def = defs.get(id)
  if (!def) return external(id)
  if (seen.has(id)) throw new Error(`geometry ${id} inherits from itself`)
  seen.add(id)
  const d = def.data
  const raw = (d.bones ?? []).filter(b => b?.name)
  let bones = raw.map(b => normalizeBone(b, def.legacy))
  let base = {}
  if (def.parent) {
    const parent = resolveGeometry(def.parent, defs, external, seen)
    if (!parent) throw new Error(`geometry ${id}: no parent ${def.parent}`)
    base = parent
    const byName = new Map(raw.map(b => [b.name.toLowerCase(), b]))
    bones = parent.bones.map(b => byName.has(b.name.toLowerCase()) ? mergeBone(b, byName.get(b.name.toLowerCase()), def.legacy) : b)
    const inherited = new Set(parent.bones.map(b => b.name.toLowerCase()))
    bones.push(...raw.filter(b => !inherited.has(b.name.toLowerCase())).map(b => normalizeBone(b, def.legacy)))
  }
  const description = def.legacy ? d : (d.description ?? {})
  const pick = (a, b) => description[a] ?? description[b] ?? base[a]
  const geometry = {
    texture_width: pick('texture_width', 'texturewidth') ?? 64,
    texture_height: pick('texture_height', 'textureheight') ?? 64
  }
  for (const key of ['visible_bounds_width', 'visible_bounds_height', 'visible_bounds_offset']) {
    const v = description[key] ?? base[key]
    if (v !== undefined) geometry[key] = v
  }
  geometry.bones = bones
  return geometry
}

module.exports = { vec, normalizeCube, normalizeBone, geometryEntries, resolveGeometry }
