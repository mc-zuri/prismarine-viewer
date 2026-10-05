// The ender dragon as the client assembles it. Its geometry (geometry.dragon) lists its parts with no hierarchy, as
// Java's EnderDragonModel places them, and the client puts it together itself:
//  - a wing's tip, a leg's lower leg and foot are placed from their part: their pivot and cubes are in the part's
//    terms, their y counted from 24
//  - the right side's parts (wing1, frontleg1, rearleg1 and theirs) are the left's mirrored about their own pivot (its
//    animations turn them the other way already)
//  - the neck and the tail are the neck part drawn 5 and 12 times: neck1-5, tail1-12, which its animations place and turn
//  - all of it hangs from root, which its setup animation turns round (the dragon flies backwards, as in Java) and tilts
//    with its flight
const PARENTS = [['wingtip', 'wing'], ['frontlegtip', 'frontleg'], ['frontfoot', 'frontlegtip'], ['rearlegtip', 'rearleg'], ['rearfoot', 'rearlegtip']]
const RIGHT = ['wing1', 'frontleg1', 'rearleg1']
const SEGMENTS = [1, 2, 3, 4, 5].map(i => 'neck' + i).concat(Array.from({ length: 12 }, (_, i) => 'tail' + (i + 1)))

const assembled = new WeakMap()

function copyBone (b) {
  return { ...b, pivot: [...b.pivot], cubes: (b.cubes ?? []).map(c => ({ ...c, origin: [...c.origin], size: [...c.size], ...(c.pivot ? { pivot: [...c.pivot] } : {}) })) }
}

function move (bone, [dx, dy, dz]) {
  const add = v => [v[0] + dx, v[1] + dy, v[2] + dz]
  bone.pivot = add(bone.pivot)
  for (const c of bone.cubes) {
    c.origin = add(c.origin)
    if (c.pivot) c.pivot = add(c.pivot)
  }
}

// mirrored in x about x0: its cubes' textures too (mirror)
function mirror (bone, x0) {
  bone.pivot[0] = 2 * x0 - bone.pivot[0]
  for (const c of bone.cubes) {
    c.origin[0] = 2 * x0 - (c.origin[0] + c.size[0])
    if (c.pivot) c.pivot[0] = 2 * x0 - c.pivot[0]
    c.mirror = !c.mirror
  }
}

/** geometry.dragon as the client draws it; any other geometry (one that has a hierarchy already) as it is */
function dragonGeometry (geo) {
  if (assembled.has(geo)) return assembled.get(geo)
  const names = new Set((geo.bones ?? []).map(b => b.name))
  if (!names.has('wing1') || !names.has('neck') || names.has('neck1') || (geo.bones ?? []).some(b => b.name === 'wingtip' && b.parent)) {
    assembled.set(geo, geo)
    return geo
  }
  const bones = geo.bones.map(copyBone)
  const byName = new Map(bones.map(b => [b.name, b]))
  for (const [child, parent] of [...PARENTS, ...PARENTS.map(([c, p]) => [c + '1', p + '1'])]) {
    const c = byName.get(child)
    const p = byName.get(parent)
    if (!c || !p) continue
    move(c, [p.pivot[0], p.pivot[1] - 24, p.pivot[2]])
    c.parent = parent
  }
  for (const name of RIGHT) {
    const top = byName.get(name)
    if (!top) continue
    const x0 = top.pivot[0]
    const walk = bone => {
      mirror(bone, x0)
      for (const child of bones) if (child.parent === bone.name) walk(child)
    }
    walk(top)
  }
  const neck = byName.get('neck')
  for (const name of SEGMENTS) bones.push({ name, pivot: [...neck.pivot], cubes: neck.cubes.map(c => ({ ...c, origin: [...c.origin], size: [...c.size] })) })
  neck.cubes = []
  // (before 1.17.10 its geometry has no root; the animations it takes from later versions turn one)
  if (!byName.has('root')) bones.unshift({ name: 'root', pivot: [0, 24, 0], cubes: [] })
  for (const b of bones) if (!b.parent && b.name !== 'root') b.parent = 'root'
  const out = { ...geo, bones }
  assembled.set(geo, out)
  return out
}

module.exports = { dragonGeometry }
