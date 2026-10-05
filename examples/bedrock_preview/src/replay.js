/* global document, fetch, requestAnimationFrame, performance */
// Plays a recording of a Bedrock client's packets (a .proxy.bin of bedrock-observer or the proxy recorder, which the
// server reads: see recording.js) in the viewer: the world it was made in (the world.json beside it: a palette and
// boxes filled with it), and its entities as the server told the client of them, through viewer.updateEntity as a
// WorldView tells it of a bot's. Play, pause, restart, a speed, and an entity for the camera to follow.
const { Vec3 } = require('vec3')
const { preload } = require('../../../viewer/lib/mcData')
const { createViewer, viewFrom45 } = require('./common')

const element = id => document.getElementById(id)
const ui = { recording: element('recording'), play: element('play'), restart: element('restart'), speed: element('speed'), follow: element('follow'), time: element('time') }
const status = element('status')
const info = element('info')
const { viewer, controls: orbit } = createViewer(element('view'))

// a block of the version: the state of its name with the properties given, else its default
function stateOf (registry, name, props = {}) {
  const block = registry.blocksByName[name]
  if (!block) return null
  const states = []
  registry.blockStates.forEach((s, id) => { if (s.name === name) states.push({ id, props: s.states ?? {} }) })
  const wanted = Object.entries(props)
  const match = states.find(s => wanted.every(([k, v]) => String(s.props[k]?.value) === String(v)))
  return match?.id ?? block.defaultState
}

// the world.json of a recording as columns: { palette: [{ name, states }], fills: [[x0, y0, z0, x1, y1, z1, index]] }
function buildWorld (registry, world) {
  const Chunk = require('prismarine-chunk')(registry)
  const columns = new Map()
  const columnAt = (x, z) => {
    const key = `${x >> 4},${z >> 4}`
    if (!columns.has(key)) columns.set(key, new Chunk({ x: x >> 4, z: z >> 4 }))
    return columns.get(key)
  }
  const ids = (world?.palette ?? []).map(p => stateOf(registry, p.name, p.states))
  const plains = registry.biomesByName.plains?.id ?? 1
  for (const [x0, y0, z0, x1, y1, z1, index] of world?.fills ?? []) {
    const id = ids[index]
    if (id === null || id === undefined) continue
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const column = columnAt(x, z)
        for (let y = y0; y <= y1; y++) {
          const pos = new Vec3(x & 15, y, z & 15)
          column.setBlockStateId(pos, id)
          column.setBiomeId(pos, plains)
        }
      }
    }
  }
  return [...columns.values()]
}

let recording = null
// the replay: its clock (seconds of the recording), the next event, playing or not
const replay = { time: 0, next: 0, playing: true, last: 0, entities: new Map(), chosen: false }

function apply (event) {
  if (event.entity) {
    const entity = { ...event.entity }
    if (entity.pos) entity.pos = new Vec3(entity.pos.x, entity.pos.y, entity.pos.z)
    if (entity.delete) replay.entities.delete(entity.id)
    else replay.entities.set(entity.id, { ...replay.entities.get(entity.id), ...entity })
    viewer.updateEntity(entity)
    if (entity.name && ![...ui.follow.options].some(o => o.value === String(entity.id))) {
      ui.follow.add(new window.Option(`${entity.name} #${entity.id}`, String(entity.id)))
      // the first entity it shows is followed, until another is chosen
      if (!replay.chosen && !ui.follow.value && entity.pos) {
        ui.follow.value = String(entity.id)
        viewFrom45(viewer, orbit, entity.pos, 28)
      }
    }
  }
  if (event.particle) viewer.spawnParticle?.(event.particle.name, event.particle.position)
  if (event.log?.message) info.textContent = `${event.t.toFixed(1)}s ${event.log.message}`
}

function restart () {
  for (const id of replay.entities.keys()) viewer.updateEntity({ id, delete: true })
  replay.entities.clear()
  replay.time = 0
  replay.next = 0
  if (!replay.chosen) ui.follow.value = ''
  // the player's view as it started: from its eyes, the way it faced (the game's yaw: 0 toward +z, clockwise; pitch
  // up negative), a few blocks back
  const start = recording?.start
  if (start) {
    const [x, y, z] = start.position
    const yaw = start.yaw * Math.PI / 180
    const pitch = start.pitch * Math.PI / 180
    const look = new Vec3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    const eye = new Vec3(x, y + 1.62, z).minus(look.scaled(4))
    viewer.camera.position.set(eye.x, eye.y, eye.z)
    orbit.target.set(x + look.x * 12, y + 1.62 + look.y * 12, z + look.z * 12)
    orbit.update()
  }
}

function frame (now) {
  const dt = Math.min(0.25, (now - replay.last) / 1000)
  replay.last = now
  if (recording && replay.playing) {
    replay.time += dt * Number(ui.speed.value)
    const events = recording.events
    while (replay.next < events.length && events[replay.next].t <= replay.time) apply(events[replay.next++])
    if (replay.next >= events.length) replay.playing = false
  }
  // the camera goes with the entity it follows, keeping its angle and distance
  const followed = replay.entities.get(Number(ui.follow.value))
  if (followed?.pos) {
    const offset = new Vec3(followed.pos.x, followed.pos.y, followed.pos.z)
    const delta = { x: offset.x - orbit.target.x, y: offset.y - orbit.target.y, z: offset.z - orbit.target.z }
    orbit.target.set(offset.x, offset.y, offset.z)
    viewer.camera.position.set(viewer.camera.position.x + delta.x, viewer.camera.position.y + delta.y, viewer.camera.position.z + delta.z)
    orbit.update()
  }
  const end = recording?.events.at(-1)?.t ?? 0
  ui.time.textContent = recording ? `${replay.time.toFixed(1)} / ${end.toFixed(1)}s` : ''
  ui.play.textContent = replay.playing ? 'pause' : 'play'
  requestAnimationFrame(frame)
}

async function load (name) {
  status.textContent = `${name}: reading...`
  const res = await fetch('recording?name=' + encodeURIComponent(name))
  const data = await res.json()
  if (!res.ok) {
    status.textContent = `${name}: ${data.error}`
    return
  }
  await preload(data.version)
  const registry = require('prismarine-registry')(data.version)
  if (!viewer.setVersion(data.version, { blockHashes: false })) {
    status.textContent = `${data.version} is not supported`
    return
  }
  recording = data
  for (const column of buildWorld(registry, data.world)) viewer.addColumn(column.x * 16, column.z * 16, column.toJson())
  ui.follow.length = 1
  restart()
  replay.playing = true
  const kinds = new Set(data.events.filter(e => e.entity?.name).map(e => e.entity.name))
  status.textContent = `${data.version}: ${data.events.length} events, ${[...kinds].join(', ') || 'no entities'}${data.world ? '' : ' (no world.json: no blocks)'}`
}

async function main () {
  const names = await (await fetch('recordings')).json()
  if (!names.length) {
    status.textContent = 'no recordings: start the server with a directory of them (server.js <port> <directory>)'
    return
  }
  for (const name of names) ui.recording.add(new window.Option(name, name))
  const asked = new URLSearchParams(window.location.search).get('recording')
  if (asked && names.includes(asked)) ui.recording.value = asked
  ui.recording.addEventListener('change', () => {
    const url = new URL(window.location.href)
    url.searchParams.set('recording', ui.recording.value)
    window.history.replaceState(null, '', url)
    load(ui.recording.value)
  })
  ui.play.addEventListener('click', () => {
    if (!replay.playing && replay.next >= (recording?.events.length ?? 0)) restart()
    replay.playing = !replay.playing
  })
  ui.restart.addEventListener('click', () => { restart(); replay.playing = true })
  ui.follow.addEventListener('change', () => { replay.chosen = true })
  replay.last = performance.now()
  requestAnimationFrame(frame)
  await load(ui.recording.value)
}

main().catch(err => { status.textContent = String(err?.stack ?? err) })
