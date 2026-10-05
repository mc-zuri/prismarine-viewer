/* global document, window, THREE */
// A world that shows what the viewer draws of a Bedrock version, built in the page for the version chosen: biomes
// that tint their grass, leaves and water differently; a pond, a waterfall and water flowing down from it, lava; a house
// whose stairs roof turns its corners; fences, panes and a door; beds, banners, chests, heads, signs and lanterns
// shaped and coloured by their block entities; redstone wire, tripwire, chorus, snowy grass and vines shaped by their
// neighbours; trees, a farm and a pen; and entities that live in it, drawn and
// animated by the viewer from the version's client entities: villagers and a golem walking, animals in the pen, a
// player sneaking in armour with a sword and a shield, one swimming, one gliding, fish, a parrot, mobs in the desert,
// things dropped on the ground; and over the desert the ender dragon, its fireballs trailing its breath and leaving a
// cloud of it where they land, and a skeleton's arrows (projectiles, with the version's particle effects).
//
// Its entities go through the viewer as a bot's would (viewer.updateEntity): spawned with what they are, then moved
// every tick.
const { Vec3 } = require('vec3')
const { preload } = require('../../../viewer/lib/mcData')
const { bedrockVersions, versionSelect, createViewer, viewFrom45, label } = require('./common')
const { G, buildShowcase } = require('./showcase')

const element = id => document.getElementById(id)
const status = element('status')
const info = element('info')
const ui = { version: element('version'), tour: element('tour'), move: element('move'), turn: element('turn') }

const { viewer, controls: orbit } = createViewer(element('view'))
const labels = new THREE.Group()
viewer.scene.add(labels)

// ---- entities ----------------------------------------------------------------------------------------------------

// the entities: what they are, and how they move
// path: points walked in a loop; wander: an area walked about in; circle: [x, y, z, radius]; at: where it stays; inWater: in the pond;
// equipment: what it holds and wears (the version's attachables); climate: its minecraft:climate_variant (cows, pigs and
// chickens since 1.21.70); backwards: its yaw points behind it, as a server tells of the dragon's (the client turns it
// round, as Java's does: recorded dragons fly 174–180° from their yaw)
const IRON = { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' }
const ACTORS = [
  { name: 'villager_v2', path: [[-26, -11], [-14, -11], [-14, -28], [-16, -29], [-27, -29], [-27, -14]], speed: 0.06 },
  { name: 'villager_v2', path: [[-12, -15], [-2, -15], [-2, -2], [-12, -2]], speed: 0.05 },
  { name: 'iron_golem', path: [[-2, -30], [-2, -13], [3, -13], [3, -30]], speed: 0.05 },
  { name: 'player', username: 'Steve (sneaks)', path: [[-12, -10], [4, -10], [4, 2], [-12, 2]], speed: 0.1, sneakEvery: 80, equipment: { mainhand: 'iron_sword', offhand: 'shield', ...IRON } },
  { name: 'player', username: 'Alex (swims)', skinModel: 'slim', path: [[-22, 9], [-12, 10], [-13, 15], [-21, 16]], speed: 0.08, y: G - 1.6, flags: { swimming: true }, airborne: true, inWater: true },
  { name: 'player', username: 'Glider', circle: [0, G + 22, 0, 24], speed: 0.6, flags: { gliding: true }, airborne: true, equipment: { chest: 'elytra' } },
  ...[['cow', 'temperate'], ['cow', 'warm'], ['cow', 'cold'], ['pig', 'warm'], ['pig', 'cold'], ['sheep'], ['sheep'], ['chicken', 'temperate'], ['chicken', 'cold']]
    .map(([name, climate]) => ({ name, climate, wander: [-13, -27, -5, -19], speed: 0.04 })),
  { name: 'cat', at: [-17, G, -15], flags: { sitting: true, tamed: true } },
  { name: 'wolf', at: [-25, G, -16], flags: { sitting: true, tamed: true } },
  ...[['zombie', { head: 'golden_helmet', chest: 'golden_chestplate' }], ['husk', { mainhand: 'iron_shovel' }], ['skeleton', { mainhand: 'bow', head: 'chainmail_helmet' }]]
    .map(([name, equipment]) => ({ name, equipment, wander: [4, 4, 30, 30], speed: 0.05 })),
  ...['cod', 'salmon', 'tropicalfish'].map(name => ({ name, wander: [-21, 8, -13, 16], speed: 0.04, y: G - 1.6, airborne: true, inWater: true })),
  { name: 'parrot', circle: [-6, G + 8, -8, 4], speed: 0.15, airborne: true },
  { name: 'bee', circle: [-8, G + 1.5, -22, 3], speed: 0.08, airborne: true },
  { name: 'ender_dragon', circle: [22, G + 14, 22, 9], speed: 0.35, airborne: true, backwards: true },
  { name: 'skeleton', at: [8, G, 27], equipment: { mainhand: 'bow' }, archer: true }
]
const ITEMS = [['diamond', 0, -15, -12], ['bed', 11, -14, -13], ['apple', 0, -15, -14], ['iron_sword', 0, 3, 10]]

// mineflayer's yaw of a direction: radians, 0 toward -z, turning anticlockwise seen from above
const yawOf = (dx, dz) => Math.atan2(-dx, -dz)

// an actor's entity data: its flags, and a player's box as the server tells it (lower sneaking, and as low as it is
// wide swimming or gliding), which its name stands over
function metadataOf (actor) {
  if (actor.name !== 'player') return { flags: { ...actor.flags } }
  const { sneaking, swimming, gliding } = actor.flags
  return { flags: { ...actor.flags }, boundingbox_width: 0.6, boundingbox_height: swimming || gliding ? 0.6 : sneaking ? 1.5 : 1.8 }
}

function spawnActors () {
  let id = 1
  const actors = ACTORS.map(spec => {
    const actor = { ...spec, id: id++, tick: 0, flags: { ...(spec.flags ?? {}) } }
    if (spec.path) actor.pos = new Vec3(spec.path[0][0] + 0.5, spec.y ?? G, spec.path[0][1] + 0.5)
    if (spec.wander) actor.pos = new Vec3(spec.wander[0] + Math.random() * (spec.wander[2] - spec.wander[0]), spec.y ?? G, spec.wander[1] + Math.random() * (spec.wander[3] - spec.wander[1]))
    if (spec.circle) actor.pos = new Vec3(spec.circle[0] + spec.circle[3], spec.circle[1], spec.circle[2])
    if (spec.at) actor.pos = new Vec3(spec.at[0] + 0.5, spec.at[1], spec.at[2] + 0.5)
    actor.yaw = 0
    actor.target = 1
    viewer.updateEntity({
      id: actor.id,
      name: spec.name,
      pos: actor.pos,
      yaw: actor.yaw,
      headYaw: actor.yaw,
      pitch: 0,
      width: 0.6,
      height: 1.8,
      username: spec.username,
      skinModel: spec.skinModel,
      onGround: !spec.airborne,
      // (fish swim in it, and flop out of it)
      inWater: !!spec.inWater,
      metadata: metadataOf(actor),
      equipment: spec.equipment,
      properties: spec.climate ? { 'minecraft:climate_variant': spec.climate } : undefined
    })
    return actor
  })
  for (const [name, aux, x, z] of ITEMS) {
    viewer.updateEntity({ id: id++, name: 'item', itemName: name, itemAux: aux, pos: new Vec3(x + 0.5, G, z + 0.5), width: 0.25, height: 0.25 })
  }
  return actors
}

// one tick of an actor: its next position, and what changed of it
function step (actor) {
  actor.tick++
  const update = { id: actor.id }
  let goal = null
  if (actor.path) {
    const [tx, tz] = actor.path[actor.target]
    goal = new Vec3(tx + 0.5, actor.pos.y, tz + 0.5)
    if (goal.distanceTo(actor.pos) < actor.speed * 2) actor.target = (actor.target + 1) % actor.path.length
  } else if (actor.wander) {
    if (!actor.goal || actor.goal.distanceTo(actor.pos) < 0.2) {
      const [x0, z0, x1, z1] = actor.wander
      actor.goal = new Vec3(x0 + 0.5 + Math.random() * (x1 - x0), actor.pos.y, z0 + 0.5 + Math.random() * (z1 - z0))
      actor.rest = Math.random() < 0.4 ? 20 + Math.floor(Math.random() * 60) : 0
    }
    if (actor.rest > 0) actor.rest--
    else goal = actor.goal
  } else if (actor.circle) {
    const [cx, cy, cz, r] = actor.circle
    const angle = Math.atan2(actor.pos.z - cz, actor.pos.x - cx) + actor.speed / r
    goal = new Vec3(cx + Math.cos(angle) * r, cy, cz + Math.sin(angle) * r)
  }
  if (actor.sneakEvery && actor.tick % actor.sneakEvery === 0) {
    actor.flags.sneaking = !actor.flags.sneaking
    update.metadata = metadataOf(actor)
  }
  if (goal) {
    const speed = actor.flags.sneaking ? actor.speed * 0.4 : actor.speed
    const dx = goal.x - actor.pos.x
    const dz = goal.z - actor.pos.z
    const length = Math.hypot(dx, dz)
    if (length > 1e-6) {
      const move = actor.circle ? 1 : Math.min(1, speed / length)
      actor.pos = new Vec3(actor.pos.x + dx * move, actor.pos.y, actor.pos.z + dz * move)
      actor.yaw = yawOf(dx, dz) + (actor.backwards ? Math.PI : 0)
      Object.assign(update, { pos: actor.pos, yaw: actor.yaw, headYaw: actor.yaw, onGround: !actor.airborne })
    }
  }
  return update
}

// The dragon's attack, and a skeleton's arrows: projectiles are entities as a server tells of them, their particles the
// version's effects, spawned as the game spawns them. Every so often the dragon sends a fireball at the ground, its
// breath trailing it (the game emits the trail a particle at a time); where it lands its breath lingers in a cloud for a
// while (the cloud spawns the effect again and again, for its radius). The skeleton shoots an arrow now and then, which
// flies in an arc, turned along its flight, and sticks where it lands.
const ATTACK = { target: new Vec3(24.5, G, 24.5), every: 240, flight: 50, cloud: 160, radius: 3 }
const ARROW = { every: 70, speed: 0.9, gravity: 0.05, stuck: 40, aim: new Vec3(22.5, G, 27.5) }
const projectiles = { next: 100000, fireball: null, cloud: 0, arrows: [] }

function shoot (tick) {
  const dragon = actors.find(a => a.name === 'ender_dragon')
  if (dragon && tick % ATTACK.every === 0 && !projectiles.fireball) {
    const from = dragon.pos.offset(0, 1, 0)
    projectiles.fireball = { id: projectiles.next++, from, t: 0 }
    viewer.updateEntity({ id: projectiles.fireball.id, name: 'dragon_fireball', pos: from, yaw: 0, pitch: 0, width: 1, height: 1 })
  }
  const fireball = projectiles.fireball
  if (fireball) {
    fireball.t++
    const k = Math.min(1, fireball.t / ATTACK.flight)
    const pos = fireball.from.plus(ATTACK.target.minus(fireball.from).scaled(k))
    viewer.updateEntity({ id: fireball.id, pos })
    for (let i = 0; i < 3; i++) viewer.spawnParticle('dragon_breath_trail', pos.offset(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5))
    if (k === 1) {
      viewer.updateEntity({ id: fireball.id, delete: true })
      projectiles.fireball = null
      projectiles.cloud = ATTACK.cloud
    }
  }
  if (projectiles.cloud > 0) {
    // (its radius shrinks as it lasts, as the game's does)
    const radius = ATTACK.radius * (0.5 + 0.5 * projectiles.cloud / ATTACK.cloud)
    if (projectiles.cloud % 5 === 0) viewer.spawnParticle('dragon_breath_lingering', ATTACK.target.offset(0, 0.1, 0), { variables: { cloud_radius: radius, cloud_lifetime: 1, particle_multiplier: 3 } })
    projectiles.cloud--
  }

  const archer = actors.find(a => a.archer)
  if (archer && tick % ARROW.every === 0) {
    // aimed so that it comes down at the mark: its time of flight from the distance, its rise from that time
    const from = archer.pos.offset(0, 1.5, 0)
    const flat = Math.hypot(ARROW.aim.x - from.x, ARROW.aim.z - from.z)
    const ticks = flat / ARROW.speed
    const velocity = new Vec3((ARROW.aim.x - from.x) / ticks, (ARROW.aim.y - from.y) / ticks + ARROW.gravity * ticks / 2, (ARROW.aim.z - from.z) / ticks)
    archer.yaw = yawOf(velocity.x, velocity.z)
    viewer.updateEntity({ id: archer.id, yaw: archer.yaw, headYaw: archer.yaw, event: 'arm_swing' })
    projectiles.arrows.push({ id: projectiles.next++, pos: from, velocity, stuck: 0, spawned: false })
  }
  for (const arrow of [...projectiles.arrows]) {
    if (arrow.stuck) {
      if (++arrow.stuck > ARROW.stuck) {
        viewer.updateEntity({ id: arrow.id, delete: true })
        projectiles.arrows.splice(projectiles.arrows.indexOf(arrow), 1)
      }
      continue
    }
    arrow.pos = arrow.pos.plus(arrow.velocity)
    arrow.velocity = arrow.velocity.offset(0, -ARROW.gravity, 0)
    if (arrow.pos.y <= ARROW.aim.y + 0.1) arrow.stuck = 1
    const yaw = yawOf(arrow.velocity.x, arrow.velocity.z)
    const pitch = Math.atan2(arrow.velocity.y, Math.hypot(arrow.velocity.x, arrow.velocity.z))
    viewer.updateEntity({ id: arrow.id, ...(arrow.spawned ? {} : { name: 'arrow', width: 0.5, height: 0.5 }), pos: arrow.pos, yaw, headYaw: yaw, pitch })
    arrow.spawned = true
  }
}

function stopShooting () {
  if (projectiles.fireball) viewer.updateEntity({ id: projectiles.fireball.id, delete: true })
  for (const arrow of projectiles.arrows) viewer.updateEntity({ id: arrow.id, delete: true })
  Object.assign(projectiles, { fireball: null, cloud: 0, arrows: [] })
}

// ---- the page ----------------------------------------------------------------------------------------------------

// where the tour looks, and what to see there: [name, target, distance, text, side (see viewFrom45), the username of
// a player the camera follows instead of looking at target]
const TOUR = [
  ['overview', [0, G, 0], 70, 'The four biomes, each tinting grass, leaves and water its own way: plains, cherry grove, swamp, desert.'],
  ['house', [-21, G + 3, -23], 18, 'A roof of stairs in rings: every corner turns inner or outer by its neighbours (states since 1.26.50, worked out by the viewer before). Plank walls, log corners, glass panes, a door.'],
  ['block entities', [-21, G, -15], 13, 'Shaped and coloured by their block entities: beds of four colours, banners by their Base colour, a double chest (its halves by their pair) beside a single one, heads turned 0°–180°, signs, a lantern and a torch.'],
  ['farm', [-29.5, G, -23], 13, 'Wheat at every stage of growth and carrots on farmland, moist from the water between them.', [-1, 1]],
  ['pen', [-9, G, -23], 16, 'A pen of fence with a gate, the fence joining what is next to it; cows, pigs and chickens of each climate (warm, temperate, cold: since 1.21.70) walking about, a bee flying.'],
  ['redstone', [-20, G, -5], 12, 'Shaped by their neighbours, as the client works it out: redstone wire from a lever, climbing over a block and down, through a repeater, round a corner to a torch, and a lone wire\'s cross; tripwire between two hooks; a chorus plant on end stone; grass snowy under snow; twisting and weeping vines ending in their tips.', [1, -1]],
  ['steve', [-4, G + 1, -4], 7, 'Steve walking his round, sneaking every few steps, in iron armour with a sword and a shield; the camera follows him.', [1, 1], 'Steve (sneaks)'],
  ['waterfall', [16, G + 2, -22], 18, 'A source on the cliff, water flowing to its edge, falling, then spreading below as its depth runs out; tinted as the cherry grove tints it.'],
  ['pond', [-17, G - 1, 12], 18, 'Swamp water, darker; lily pads, seagrass and kelp in the water of their liquid layer; Alex swimming, fish, oak trees hung with vines, sugar cane.'],
  ['desert', [17, G, 16], 22, 'Sand, cacti, dead bushes, a lava pool flowing out; a zombie in gold, a husk with a shovel and a skeleton with a bow wandering.'],
  ['dragon', [22, G + 6, 23], 24, 'The ender dragon circling over the desert, now and then sending a fireball at the ground: its breath trails it, and lingers where it lands in a cloud for a while. A skeleton shooting arrows, each flying in an arc and sticking where it lands.', [1, 1]],
  ['sky', [0, G + 20, 0], 9, 'A player gliding with an elytra: the body lies along its flight; the camera follows it.', [1, 1], 'Glider']
]

let actors = []
let ticker = null
let ticks = 0
// the actor the camera follows, if any
let following = null

async function build () {
  const version = ui.version.value
  status.textContent = `${version}: building...`
  clearInterval(ticker)
  await preload(version)
  const registry = require('prismarine-registry')(version)
  const Chunk = require('prismarine-chunk')(registry)
  const { columns, blocks, missing } = buildShowcase(registry, Chunk)

  if (!viewer.setVersion(version, { blockHashes: false })) {
    status.textContent = `${version} is not supported`
    return
  }
  for (const column of columns.values()) viewer.addColumn(column.x * 16, column.z * 16, column.toJson())

  for (const sprite of [...labels.children]) labels.remove(sprite)
  for (const [x, z, text] of [[-16, -16, 'plains'], [16, -16, registry.biomesByName.cherry_grove ? 'cherry grove' : 'birch forest (no cherry grove yet)'], [-16, 16, 'swamp'], [16, 16, 'desert']]) {
    const sprite = label(text, { height: 1.2 })
    sprite.position.set(x, G + 12, z)
    labels.add(sprite)
  }

  stopShooting()
  actors = spawnActors()
  ticker = setInterval(() => {
    if (!ui.move.checked) return
    for (const actor of actors) {
      const update = step(actor)
      if (Object.keys(update).length > 1) viewer.updateEntity(update)
    }
    shoot(++ticks)
    if (following) {
      // the camera moves with it, keeping its angle and distance (orbiting stays the user's)
      const offset = new THREE.Vector3(following.pos.x, following.pos.y + 1, following.pos.z).sub(orbit.target)
      orbit.target.add(offset)
      viewer.camera.position.add(offset)
      orbit.update()
    }
  }, 50)

  status.textContent = `${version}: ${blocks} blocks, ${actors.length} entities` + (missing.size ? `; the version has no ${[...missing].join(', ')}` : '')
  goTo(TOUR[0])
  await viewer.waitForChunksToRender()
}

function goTo ([name, [x, y, z], distance, text, side, follow]) {
  following = (follow && actors.find(actor => actor.username === follow)) || null
  const target = following ? following.pos.offset(0, 1, 0) : new Vec3(x, y, z)
  viewFrom45(viewer, orbit, target, distance, side)
  // the names of the biomes, from afar only
  labels.visible = name === 'overview'
  info.textContent = `${name}: ${text}`
}

let queue = Promise.resolve()
const run = fn => { queue = queue.then(fn).catch(err => { status.textContent = String(err?.stack ?? err) }) }

async function main () {
  versionSelect(ui.version, await bedrockVersions())
  for (const stop of TOUR) {
    const button = document.createElement('button')
    button.textContent = stop[0]
    button.addEventListener('click', () => goTo(stop))
    ui.tour.appendChild(button)
  }
  ui.version.addEventListener('change', () => {
    const url = new URL(window.location.href)
    url.searchParams.set('version', ui.version.value)
    window.history.replaceState(null, '', url)
    run(build)
  })
  ui.turn.addEventListener('change', () => { orbit.autoRotate = ui.turn.checked })
  run(build)
}

main()
