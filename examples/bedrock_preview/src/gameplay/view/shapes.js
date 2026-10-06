/* global THREE */
// The route's shapes (pathfinder/route.js), drawn as bedrock-demo's 3D view draws them
// (packages/bedrock-client-viewer/web/three: shapes.ts, grid.ts, and src/primitives.ts's groups): the viewer's own
// lines, points and box grids, and a box the viewer's grid cannot draw (not whole blocks long: a jump's take-off or
// landing, a box a little larger than its block) as its edges. A group of shapes (the ids under a prefix) is drawn at
// once: those of the group not in it any more are erased.

// Whether the viewer draws the shape: a line, points, or a box grid whole blocks long on each side (its grid has a line
// at each block along a side)
function viewerDraws (primitive) {
  if (primitive.type !== 'boxgrid') return true
  return ['x', 'y', 'z'].every(axis => {
    const side = primitive.end[axis] - primitive.start[axis]
    return side >= 1 && Number.isInteger(side)
  })
}

class Shapes {
  constructor (viewer) {
    this.viewer = viewer
    this.boxes = new Map()
    // each group's ids, and each shape as last drawn (by its JSON): a shape drawn the same is left as it is
    this.groups = new Map()
    this.drawn = new Map()
  }

  // Draws a shape, in place of the one of its id; one with only an id is erased
  update (primitive) {
    this.removeBox(primitive.id)
    if (primitive.type === undefined) {
      this.viewer.updatePrimitive({ id: primitive.id })
      return
    }
    if (viewerDraws(primitive)) return this.viewer.updatePrimitive(primitive)
    // the viewer's shape of the id, if it drew one
    this.viewer.updatePrimitive({ id: primitive.id })
    if (primitive.type !== 'boxgrid') return
    const { start, end } = primitive
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(end.x - start.x, end.y - start.y, end.z - start.z)), new THREE.LineBasicMaterial({ color: primitive.color }))
    box.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2)
    this.viewer.scene.add(box)
    this.boxes.set(primitive.id, box)
  }

  // The shapes of a group (ids under `name`:), in place of those it had
  set (name, primitives) {
    const before = this.groups.get(name) ?? new Set()
    const now = new Set()
    for (const primitive of primitives) {
      now.add(primitive.id)
      const json = JSON.stringify(primitive)
      if (this.drawn.get(primitive.id) === json) continue
      this.drawn.set(primitive.id, json)
      this.update(primitive)
    }
    for (const id of before) {
      if (now.has(id)) continue
      this.drawn.delete(id)
      this.update({ id })
    }
    this.groups.set(name, now)
  }

  // Forgets every shape: the viewer forgets its own with its world
  clear () {
    for (const id of [...this.boxes.keys()]) this.removeBox(id)
    this.groups.clear()
    this.drawn.clear()
  }

  removeBox (id) {
    const box = this.boxes.get(id)
    if (!box) return
    this.viewer.scene.remove(box)
    box.geometry.dispose()
    box.material.dispose()
    this.boxes.delete(id)
  }
}

module.exports = { Shapes, viewerDraws }
