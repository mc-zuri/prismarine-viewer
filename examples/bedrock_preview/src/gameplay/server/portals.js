// Where a portal takes a player, as the game takes it: a nether portal between the overworld and the nether (the
// nether is 8 times smaller: x and z divided by 8 on the way there, multiplied on the way back), to the portal there
// nearest that place (within 128 blocks in the overworld, 16 in the nether), else to ground there, else to the
// dimension's spawn; an end portal from the overworld to the end's platform (the end's spawn), and from the end back
// to the overworld's spawn. Only where the world has the dimension it leads to.

// how many ticks a player stands in a nether portal before it takes it: survival (4 seconds), creative
const PORTAL_TICKS = { survival: 80, creative: 10 }
// the blocks a player stands on and in, for a place to stand where no portal is
const NOT_GROUND = new Set(['air', 'water', 'flowing_water', 'lava', 'flowing_lava', 'portal', 'fire'])

// the dimension and feet a portal of `kind` (portal, end_portal) at `feet` in `from` leads to; null where it leads to
// a dimension the world does not have
function portalDestination (server, from, feet, kind) {
  const spawnOf = dimension => {
    const { x, y, z } = server.worlds.get(dimension).spawn
    return { x, y, z }
  }
  if (kind === 'end_portal') {
    const to = from === 2 ? 0 : 2
    return server.worlds.has(to) ? { dimension: to, feet: spawnOf(to) } : null
  }
  if (from === 2) return null
  const to = from === 1 ? 0 : 1
  if (!server.worlds.has(to)) return null
  const scale = to === 1 ? 1 / 8 : 8
  const target = { x: feet.x * scale, y: feet.y, z: feet.z * scale }
  const portal = nearestPortal(server.worlds.get(to), target, to === 1 ? 16 : 128)
  if (portal) return { dimension: to, feet: portal }
  return { dimension: to, feet: placeToStand(server, to, target) ?? spawnOf(to) }
}

// the feet in a portal (on its lowest block) nearest a place, within a horizontal distance
function nearestPortal (world, target, radius) {
  const blocks = world.find?.('portal') ?? []
  let best = null
  let distance = Infinity
  for (const at of blocks) {
    const d = Math.hypot(at.x + 0.5 - target.x, at.z + 0.5 - target.z)
    if (d > radius) continue
    // (the lowest block of its column of the portal: where a player stands in it)
    const lowest = !blocks.some(other => other.x === at.x && other.z === at.z && other.y === at.y - 1)
    if (lowest && (d < distance || (d === distance && at.y < best.y))) {
      best = at
      distance = d
    }
  }
  return best && { x: best.x + 0.5, y: best.y, z: best.z + 0.5 }
}

// feet on a solid block with two blocks of air over it, at a place: from below in the nether (its roof is bedrock),
// from above elsewhere; null where the world has nothing there
function placeToStand (server, dimension, target) {
  const x = Math.floor(target.x)
  const z = Math.floor(target.z)
  const name = y => server.blockName({ x, y, z }, dimension)
  const low = server.minYOf(dimension)
  const high = dimension === 1 ? 127 : 320
  const heights = []
  for (let y = low + 1; y < high - 2; y++) heights.push(y)
  if (dimension !== 1) heights.reverse()
  const y = heights.find(y => !NOT_GROUND.has(name(y - 1)) && name(y) === 'air' && name(y + 1) === 'air')
  return y === undefined ? null : { x: x + 0.5, y, z: z + 0.5 }
}

module.exports = { PORTAL_TICKS, portalDestination, nearestPortal, placeToStand }
