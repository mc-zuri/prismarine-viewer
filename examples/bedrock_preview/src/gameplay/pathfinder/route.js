// The route the pathfinder walks, as shapes for the viewer (its primitives: lines, points and box grids), their ids
// under route: (bedrock-demo packages/bedrock-client-viewer/src/route.ts). The way on the ground is a line a little
// over it, cyan when the route reaches the goal and amber when it goes only as near as the search found. Each move
// through the air (a jump up a block or a pillar's, a gap jumped, a drop) is a line of its own colour along the path the
// player flies, worked out tick by tick from Bedrock's jump and fall, with a small box where it leaves the ground and
// one where it lands. Each block to break, each place a block goes and each gate to open has a box around it, and so
// has the goal's block.

const ROUTE_COLORS = {
  walking: 0x69f7ff,
  partial: 0xffc14d,
  air: 0xff5cf0,
  takeOff: 0xffe14d,
  landing: 0x5cff8a,
  breaks: 0xff4d4d,
  places: 0x4da3ff,
  opens: 0xff9f40
}

// the lines over the ground, so they are not in it
const LIFT = 0.15
// half the size of the boxes where a jump leaves the ground and lands
const MARK = 0.12
// how much larger than its block the box around a block is
const AROUND = 0.02
const STEP_SIZE = 6
// Bedrock's jump: the speed up the player leaves the ground with; and each tick in the air, the fall's pull and the
// air's drag
const JUMP_SPEED = 0.42
const GRAVITY = 0.08
const DRAG = 0.98
const MOST_AIR_TICKS = 200
// where a move through the air leaves the ground, from the middle of the step before toward the step, and where it
// lands, short of the step's middle: a jump up from by the step, a gap jumped from its edge and onto the far one, a
// drop once the player's box is over the edge
const TAKE_OFF = { jump: 0.2, parkour: 0.6, drop: 0.8 }
const LAND_SHORT = { jump: 0.25, parkour: 0.3, drop: 0 }

// The heights over its start of a jump, or without the jump a fall, at each tick from the ground until it lands `rise`
// higher (lower when negative): it lands as it comes down to that height
function airHeights (rise, jump) {
  const heights = [0]
  let y = 0
  let speed = jump ? JUMP_SPEED : 0
  for (let tick = 0; tick < MOST_AIR_TICKS; tick++) {
    y += speed
    speed = (speed - GRAVITY) * DRAG
    if (y < 0 || speed < 0) {
      if (y <= rise) break
    }
    if (y !== heights[heights.length - 1]) heights.push(y)
  }
  heights.push(rise)
  return heights
}

// Where a move through the air from one step to the next leaves the ground and lands
function airEnds (from, to, move) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  const ux = distance ? (to.x - from.x) / distance : 0
  const uz = distance ? (to.z - from.z) / distance : 0
  const out = Math.min(TAKE_OFF[move], distance)
  const short = Math.min(LAND_SHORT[move], distance - out)
  return {
    takeOff: { x: from.x + ux * out, y: from.y, z: from.z + uz * out },
    landing: { x: to.x - ux * short, y: to.y, z: to.z - uz * short }
  }
}

// The path through the air from the take-off to the landing: the jump's (or fall's) heights, the ground covered evenly
function airPath (takeOff, landing, jump) {
  const heights = airHeights(landing.y - takeOff.y, jump)
  const last = heights.length - 1
  return heights.map((height, tick) => ({
    x: takeOff.x + ((landing.x - takeOff.x) * tick) / last,
    y: takeOff.y + height,
    z: takeOff.z + ((landing.z - takeOff.z) * tick) / last
  }))
}

const lift = ({ x, y, z }) => ({ x, y: y + LIFT, z })
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z

function blockBox (id, block, color) {
  return { type: 'boxgrid', id, start: { x: block.x - AROUND, y: block.y - AROUND, z: block.z - AROUND }, end: { x: block.x + 1 + AROUND, y: block.y + 1 + AROUND, z: block.z + 1 + AROUND }, color }
}

function mark (id, point, color) {
  const { x, y, z } = lift(point)
  return { type: 'boxgrid', id, start: { x: x - MARK, y: y - MARK, z: z - MARK }, end: { x: x + MARK, y: y + MARK, z: z + MARK }, color }
}

// The route's shapes, from the player's feet; none for no route
function routePrimitives (route, feet) {
  if (!route) return []
  const ground = ROUTE_COLORS[route.status]
  const shapes = []
  let run = [feet]
  const endRun = () => {
    const points = run.filter((point, i) => i === 0 || !same(point, run[i - 1]))
    if (points.length >= 2) shapes.push({ type: 'line', id: `route:ground:${shapes.length}`, points: points.map(lift), color: ground })
  }
  let previous = feet
  let jumps = 0
  for (const step of route.points) {
    if (step.move === 'walk') {
      run.push(step)
    } else {
      const { takeOff, landing } = airEnds(previous, step, step.move)
      run.push(takeOff)
      endRun()
      shapes.push({ type: 'line', id: `route:air:${jumps}`, points: airPath(takeOff, landing, step.move !== 'drop').map(lift), color: ROUTE_COLORS.air })
      shapes.push(mark(`route:takeoff:${jumps}`, takeOff, ROUTE_COLORS.takeOff))
      shapes.push(mark(`route:landing:${jumps}`, landing, ROUTE_COLORS.landing))
      jumps++
      run = [landing, step]
    }
    previous = step
  }
  endRun()
  if (route.points.length) shapes.push({ type: 'points', id: 'route:steps', points: route.points.map(lift), color: ground, size: STEP_SIZE })
  // by the block, so a box stays as the steps before it are walked
  for (const step of route.points) {
    for (const block of step.breaks) shapes.push(blockBox(`route:break:${block.x},${block.y},${block.z}`, block, ROUTE_COLORS.breaks))
    for (const block of step.places) shapes.push(blockBox(`route:place:${block.x},${block.y},${block.z}`, block, ROUTE_COLORS.places))
    for (const block of step.opens) shapes.push(blockBox(`route:open:${block.x},${block.y},${block.z}`, block, ROUTE_COLORS.opens))
  }
  shapes.push(blockBox('route:goal', route.goal, ground))
  return shapes
}

module.exports = { ROUTE_COLORS, routePrimitives, airHeights, airEnds, airPath }
