/* global document, window, THREE, Worker, MessageChannel, localStorage, fetch, performance */
// Bedrock gameplay in the page alone: a Bedrock server in a Web Worker (gameplayServer.js) sends the showcase world, and
// a client on the page (gameplay/client) plays it, the two exchanging the game's own packets, written and read by
// bedrock-protocol, over a MessagePort; the player moves with prismarine-physics' Bedrock engine, and the viewer draws
// the world the client is sent.
//
// Three views, as bedrock-demo's 3D view has them (gameplay/view): first person, third person (the camera behind the
// player, as close as the blocks leave room for, the player's model drawn), and the walk view (a camera the right mouse
// button turns around the player; a click on the world walks the player there with mineflayer-pathfinder, which the
// pathfinder menu says what it may do on the way, and its route is drawn). In first and third person a click on the
// world locks the mouse, which then turns the player; Escape lets it go; V (F5 while locked) switches between them.
//
// The version, the blob cache and hashed block ids are chosen in the bar (and the address: ?version=bedrock_1.26.51
// &cache=1&hashes=1&view=walk); a change joins again. The page keeps the blobs the client was sent from one join to
// the next, so that a join again with the cache on finds the world's blobs (the stats count the hits).
globalThis.Buffer = globalThis.Buffer ?? require('buffer').Buffer
const { Vec3 } = require('vec3')
const { preload } = require('../../../viewer/lib/mcData')
const { loadEntityAssets } = require('../../../viewer/lib/bedrock/entity/assets')
const { loadCrtAsync } = require('prismarine-physics-bedrock/lib/bedrock/index.ts')
const { bedrockVersions, versionSelect, createViewer } = require('./common')
const { bare, hasProtocol, supportsHashes } = require('./gameplay/data')
const { createClient } = require('./gameplay/client/client')
const { BlobStore } = require('./gameplay/client/blobs')
const { bedrockYaw, bedrockPitch, lookOf } = require('./gameplay/client/movement')
const { createHud } = require('./gameplay/hud')
const { attachPathfinder, DEFAULT_OPTIONS, pathfinderOptions } = require('./gameplay/pathfinder')
const { routePrimitives, ROUTE_COLORS } = require('./gameplay/pathfinder/route')
const { CameraRig, cameraBlocks, cameraDistance, forward, wrapDegrees } = require('./gameplay/view/camera')
const { PointerLock } = require('./gameplay/view/pointerLock')
const { PlayerModel } = require('./gameplay/view/player')
const { EntityModels, entityHit } = require('./gameplay/view/entities')
const { Shapes } = require('./gameplay/view/shapes')
const { pick, walkInput } = require('./gameplay/view/walk')

// how far the client sees (chunks), and reaches
const VIEW_DISTANCE = 6
const REACH = 6
// columns given to the viewer a frame (a column arrives again with each of its sections)
const COLUMNS_A_FRAME = 4
// a held mouse button repeats its use this often (ms)
const REPEAT = 250
// the sky of each dimension: the overworld's (the viewer's own), the nether's haze, the end's dark
const SKIES = ['lightblue', '#3a1414', '#17101f']
// the camera's near plane, inside the corners of the rays that keep blocks out of its way
const NEAR = 0.05
// a camera closer to the eyes than this is in the player's head: the model is not drawn
const MODEL_DISTANCE = 0.6
// the look's pitch, short of straight up or down
const MAX_PITCH = 89.9
const MODES = ['first', 'third', 'walk']
const HINTS = {
  first: 'Click the world to look around · V: third person',
  third: 'Click the world to look around · V: first person',
  walk: 'Left click: walk there · right drag: turn · Ctrl+wheel: closer or further · Esc: stop'
}
const NOTICE_MS = 3000
// why a walk ended, where it did not arrive
const WALKS = {
  'no path': 'No way there',
  stuck: 'Stuck on the way',
  'dig failed': 'A block on the way would not break',
  'place failed': 'A block on the way would not go in',
  'no blocks': 'No blocks left to build the way with',
  failed: 'The pathfinder failed: see the console',
  teleported: 'Teleported: the walk ended'
}

const element = id => document.getElementById(id)
const ui = {
  version: element('version'),
  world: element('world'),
  cache: element('cache'),
  hashes: element('hashes'),
  join: element('join'),
  leave: element('leave'),
  sensitivity: element('sensitivity'),
  status: element('status'),
  view: element('view'),
  crosshair: element('crosshair'),
  hint: element('hint'),
  modes: [...document.querySelectorAll('#modes [data-mode]')],
  options: [...document.querySelectorAll('#pathfinder input[data-option]')],
  maxDrop: element('max-drop')
}
const hud = createHud({ hotbar: element('hotbar'), log: element('log'), say: element('say'), stats: element('stats'), debug: element('debug'), info: element('info') })
const params = new URLSearchParams(window.location.search)
const verify = params.get('verify') === '1'
const stored = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
const store = (key, value) => {
  try { localStorage.setItem(key, value) } catch {}
}

// the session playing, if any (each join counts one more); the blobs of every join (the game keeps them on disk)
const blobStore = new BlobStore()
let session = null
let sessions = 0
// whether the physics' exact sine routines loaded
let exactTrig = false
// what the pathfinder may do: the menu's, kept from one join (and visit) to the next
let walkOptions = pathfinderOptions(JSON.parse(stored('gameplay.pathfinder', 'null')), DEFAULT_OPTIONS)
// the movement keys the player holds
const held = new Set()

const { viewer, renderer } = createViewer(ui.view, frame, { orbit: false })
viewer.camera.near = NEAR
viewer.camera.updateProjectionMatrix()
// the outline of the block aimed at
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x101010 }))
outline.visible = false
viewer.scene.add(outline)
const playerModel = new PlayerModel(viewer)
const entityModels = new EntityModels(viewer)
const shapes = new Shapes(viewer)

const status = text => { ui.status.textContent = text }
// the panels go under the bar, however many lines it takes
new window.ResizeObserver(() => document.documentElement.style.setProperty('--bar', `${element('bar').offsetHeight}px`)).observe(element('bar'))

// ---- the look, the camera and the mouse ------------------------------------------------------------------------

// the player's look in Bedrock's degrees (yaw 0 faces +z, pitch positive looks down), as the camera turns it
const look = {
  get yaw () {
    const client = session?.client
    return client ? wrapDegrees(bedrockYaw(client.look.yaw)) : 0
  },
  get pitch () {
    const client = session?.client
    return client ? bedrockPitch(client.look.pitch) : 0
  },
  set (yaw, pitch) {
    const client = session?.client
    if (!client) return
    const turned = lookOf(wrapDegrees(yaw), Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)))
    client.setLook(turned.yaw, turned.pitch)
  }
}
const walking = () => !!session?.pathfinder?.walking
const rig = new CameraRig(look, () => held.has('forward') || held.has('back') || held.has('left') || held.has('right'))
let mode = MODES.includes(params.get('view')) ? params.get('view') : MODES.includes(stored('gameplay.view')) ? stored('gameplay.view') : 'first'
let sensitivity = Number(stored('gameplay.sensitivity', 6))
ui.sensitivity.value = sensitivity
ui.sensitivity.addEventListener('input', () => {
  sensitivity = Number(ui.sensitivity.value)
  store('gameplay.sensitivity', String(sensitivity))
})

const pointer = new PointerLock(renderer.domElement, {
  change: locked => {
    // what the player held is let go with the mouse, as the game pauses
    if (!locked) releaseAll()
    notice = ''
    showHint()
  },
  // degrees a pixel: 0.15 at the middle of the slider, as bedrock-renderer turns; the pathfinder turns the player while
  // it walks it
  turn: (dx, dy) => {
    if (walking()) return
    const degrees = sensitivity * 0.025
    look.set(look.yaw + dx * degrees, look.pitch + dy * degrees)
  },
  refused: text => notify(text)
})

let notice = ''
let noticeTimer
function showHint () {
  ui.hint.textContent = !session?.client ? '' : notice || (pointer.locked ? '' : HINTS[mode])
  ui.crosshair.hidden = !pointer.locked
}

function notify (text) {
  notice = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice = ''; showHint() }, NOTICE_MS)
  showHint()
}

function setMode (next) {
  if (!MODES.includes(next)) return
  if (mode === 'walk' && next !== 'walk') session?.pathfinder?.stop()
  mode = next
  rig.setMode(mode)
  if (mode === 'walk') pointer.unlock()
  for (const button of ui.modes) button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
  store('gameplay.view', mode)
  syncAddress()
  showHint()
}
rig.setMode(mode)
for (const button of ui.modes) {
  button.addEventListener('click', () => {
    button.blur()
    setMode(button.dataset.mode)
  })
}

// first and third person: a click on the world takes the mouse, and does nothing else
renderer.domElement.addEventListener('pointerdown', event => {
  if (!session?.client || mode === 'walk' || pointer.locked || event.button !== 0 || event.pointerType !== 'mouse') return
  pointer.lock()
})

// the walk view: a click walks the player to the block under the cursor (onto it from its top, next to it from a side
// or below, into it when nothing stops the player there: water, a plant)
walkInput(renderer.domElement, rig, (clientX, clientY) => {
  const picked = pick(viewer, renderer.domElement, clientX, clientY)
  if (picked) walkTo(picked.block, picked.face)
})

function walkTo (block, face) {
  const s = session
  const client = s?.client
  if (!client?.player || !s.pathfinder) return 'not playing'
  const open = !client.movement.world.getBlock(block)?.shapes?.length
  const goal = open ? block : face.y === 1 ? { x: block.x, y: block.y + 1, z: block.z } : { x: block.x + face.x, y: block.y + face.y, z: block.z + face.z }
  const refused = s.pathfinder.goTo(goal, open || face.y === 1 ? 0 : 2)
  hud.log(refused ? `walk: ${refused}` : `walking to ${goal.x}, ${goal.y}, ${goal.z}`)
  return refused
}

// ---- joining ---------------------------------------------------------------------------------------------------

async function join () {
  leave()
  const version = ui.version.value
  const v = bare(version)
  const token = ++sessions
  const current = () => sessions === token
  status(`${v}: loading data`)
  await preload(version)
  // the exact sine routines of the physics (else Math.sin stands in, a float32 step off on a few angles)
  exactTrig = await loadCrtAsync()
  if (!current()) return
  const hashes = ui.hashes.checked && supportsHashes(version)
  status(`${v}: starting the server`)
  const worker = new Worker('gameplay-server.js')
  const s = { token, version, worker, client: null, pathfinder: null, ticker: null, columns: new Map(), serverStats: null, target: null, buttons: {}, rates: { at: Date.now(), sent: 0, received: 0, up: 0, down: 0 } }
  session = s
  await new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') resolve()
      else if (data.type === 'error') reject(new Error(data.message))
      else if (data.type === 'log') console.log('[server]', data.line)
      else if (data.type === 'stats') s.serverStats = data.stats
    }
    worker.onerror = event => reject(new Error(`the server did not start: ${event.message ?? 'see the console'}`))
    worker.postMessage({ type: 'start', version: v, hashes, world: ui.world.value || undefined, radius: VIEW_DISTANCE, verify })
  })
  if (!current()) return
  const { port1, port2 } = new MessageChannel()
  worker.postMessage({ type: 'connect' }, [port2])
  const client = createClient({ port: port1, version: v, username: 'Steve', cache: ui.cache.checked, viewDistance: VIEW_DISTANCE, blobStore, verify })
  s.client = client
  client.on('status', (stage, text) => {
    if (!current()) return
    status(`${v}: ${text}`)
    showHint()
  })
  client.on('startGame', (packet, { blockHashes }) => {
    if (!viewer.setVersion(version, { blockHashes })) status(`${v}: the viewer has no assets of this version`)
    // the sky of the dimension (the viewer has the overworld's)
    viewer.scene.background = new THREE.Color(SKIES[client.dimension] ?? SKIES[0])
    hud.setVersion(version).then(() => hud.hotbar(client.interaction.hotbar, client.interaction.selectedSlot))
    // the player's model, of the version's entities
    loadEntityAssets(version).then(assets => {
      if (!current()) return
      playerModel.use(assets)
      entityModels.use(assets)
    }, () => {})
  })
  client.on('column', column => s.columns.set(`${column.x},${column.z}`, column))
  client.on('unloadColumn', (x, z) => {
    s.columns.delete(`${x},${z}`)
    viewer.removeColumn(x * 16, z * 16)
  })
  client.on('blockUpdate', (pos, stateId, layer) => viewer.setBlockStateId(new Vec3(pos.x, pos.y, pos.z), stateId, layer))
  client.on('blockEntity', (pos, tag) => viewer.setBlockEntity(new Vec3(pos.x, pos.y, pos.z), tag))
  client.on('hotbar', (slots, selected) => hud.hotbar(slots, selected))
  // through a portal: the sky of the dimension (its columns come again)
  client.on('dimension', dimension => { viewer.scene.background = new THREE.Color(SKIES[dimension] ?? SKIES[0]) })
  client.on('message', text => hud.log(text))
  client.on('problem', text => {
    console.warn(text)
    hud.info(text.split('\n')[0])
  })
  client.on('close', reason => {
    if (!current()) return
    status(`${v}: left (${reason})`)
    stop(s)
  })
  // the pathfinder, with the menu's options: its route drawn, why a walk ended told
  s.pathfinder = attachPathfinder(client, walkOptions)
  s.pathfinder.on('route', route => shapes.set('route', routePrimitives(route, client.player?.pos ?? route?.goal)))
  s.pathfinder.on('end', reason => {
    if (!current()) return
    if (WALKS[reason]) notify(WALKS[reason])
    // the keys the player holds, which the walk let go of, are pressed again
    for (const control of held) client.setControl(control, true)
  })
  s.ticker = setInterval(() => client.tick(), 50)
  window.addEventListener('beforeunload', guard)
}

// Ctrl+W (sprint and forward) would close the tab
function guard (event) {
  event.preventDefault()
  event.returnValue = ''
}

function stop (s) {
  clearInterval(s.ticker)
  s.pathfinder?.close()
  s.worker.terminate()
  window.removeEventListener('beforeunload', guard)
}

function leave () {
  sessions++
  if (!session) return
  const s = session
  session = null
  s.client?.close()
  stop(s)
  viewer.resetAll()
  shapes.clear()
  playerModel.dispose()
  entityModels.dispose()
  outline.visible = false
  hud.clear()
  pointer.unlock()
  showHint()
}

// ---- each frame ------------------------------------------------------------------------------------------------

let blocksSeen = null
function frame () {
  const s = session
  const client = s?.client
  if (!client?.player) return
  // the columns arrived since, a few a frame
  let given = 0
  for (const [key, column] of s.columns) {
    if (given++ >= COLUMNS_A_FRAME) break
    s.columns.delete(key)
    viewer.addColumn(column.x * 16, column.z * 16, column.toJson())
  }
  // the eyes, between the last two ticks
  const { movement } = client
  const { player, prevPos, physics } = movement
  const alpha = Math.max(0, Math.min(1, (Date.now() - movement.lastTickTime) / 50))
  const lerp = (a, b) => a + (b - a) * alpha
  const offset = lerp(player.bedrock?.eyeOffsetPrev ?? 0, player.bedrock?.eyeOffset ?? 0)
  const feet = { x: lerp(prevPos.x, player.pos.x), y: lerp(prevPos.y, player.pos.y), z: lerp(prevPos.z, player.pos.z) }
  const eye = { x: feet.x, y: feet.y + physics.eyeHeight - offset, z: feet.z }
  // the camera of the view: behind the player as far as the blocks leave room for
  if (blocksSeen?.world !== movement.world) blocksSeen = { world: movement.world, blocks: cameraBlocks(pos => movement.world.getBlock(pos)) }
  const placed = rig.place(eye, (from, to) => cameraDistance(blocksSeen.blocks, from, to, NEAR))
  viewer.camera.position.set(placed.position.x, placed.position.y, placed.position.z)
  // (in the eyes: turned by the look, as the mouse says at once; else at the eyes)
  if (placed.distance === 0) viewer.camera.rotation.set(client.look.pitch, client.look.yaw, 0, 'YXZ')
  else viewer.camera.lookAt(placed.target.x, placed.target.y, placed.target.z)
  playerModel.place(feet, look.yaw, look.pitch, placed.distance > MODEL_DISTANCE, player, client.interaction.held?.name, performance.now())
  // the block aimed at: from the eyes along the look (none in the walk view)
  entityModels.place(client.entities, performance.now())
  s.target = mode === 'walk' ? null : client.target(eye, forward(look), REACH)
  // an entity (a boat) nearer than the block aimed at is aimed at instead
  const hit = mode === 'walk' ? null : entityHit(client.entities, eye, forward(look), REACH)
  s.entity = hit && (!s.target || hit.t < Math.hypot(s.target.point.x + s.target.pos.x - eye.x, s.target.point.y + s.target.pos.y - eye.y, s.target.point.z + s.target.pos.z - eye.z)) ? hit.entity : null
  if (s.entity) s.target = null
  outline.visible = !!s.target
  if (s.target) {
    const [x0, y0, z0, x1, y1, z1] = s.target.box
    outline.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    outline.scale.set(x1 - x0 + 0.004, y1 - y0 + 0.004, z1 - z0 + 0.004)
  }
  // a held mouse button uses again
  for (const [button, since] of Object.entries(s.buttons)) {
    if (Date.now() - since >= REPEAT) {
      s.buttons[button] = Date.now()
      use(Number(button))
    }
  }
}

// ---- input -----------------------------------------------------------------------------------------------------

const KEYS = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak', ControlLeft: 'sprint', KeyR: 'sprint' }
const chatOpen = () => element('say').style.display === 'block'

function releaseAll () {
  const client = session?.client
  held.clear()
  if (!client) return
  if (!walking()) for (const name of Object.values(KEYS)) client.setControl(name, false)
  if (session) session.buttons = {}
}

// left: break, right: place (or use a gate; aimed at nothing, use the held item: a firework rocket boosts a glide),
// middle: the block aimed at into the hand (if the hotbar has it)
function use (button) {
  const s = session
  const client = s?.client
  if (!client?.player) return
  // an entity aimed at: right gets on it, left hits it (a boat breaks)
  if (s.entity) {
    playerModel.swing()
    if (button === 2) client.interactEntity(s.entity)
    else if (button === 0) client.attackEntity(s.entity)
    return
  }
  if (!s.target) {
    if (button === 2 && client.useItem()) playerModel.swing()
    return
  }
  playerModel.swing()
  if (button === 0) client.breakBlock(s.target)
  else if (button === 2) client.placeBlock(s.target)
  else if (button === 1) {
    const slot = client.interaction.hotbar.findIndex(item => item?.blockRuntimeId === s.target.stateId || item?.name === s.target.name)
    if (slot >= 0) client.selectSlot(slot)
  }
}

window.addEventListener('blur', releaseAll)
renderer.domElement.addEventListener('mousedown', event => {
  if (!pointer.locked) return
  event.preventDefault()
  use(event.button)
  if (event.button !== 1 && session) session.buttons[event.button] = Date.now()
})
document.addEventListener('mouseup', event => { if (session) delete session.buttons[event.button] })
renderer.domElement.addEventListener('contextmenu', event => event.preventDefault())
// the wheel picks the hotbar slot; with Ctrl it brings the walk camera closer or further, never zooms the page
renderer.domElement.addEventListener('wheel', event => {
  const client = session?.client
  event.preventDefault()
  if (event.ctrlKey) {
    if (mode === 'walk') rig.zoom(event.deltaY < 0 ? 0.8 : 1.25)
    return
  }
  if (client) client.selectSlot((client.interaction.selectedSlot + (event.deltaY > 0 ? 1 : 8)) % 9)
}, { passive: false })

document.addEventListener('keydown', event => {
  const client = session?.client
  if (!client || chatOpen() || event.target.tagName === 'SELECT' || event.target.tagName === 'INPUT') return
  if (event.code === 'F3') {
    event.preventDefault()
    element('debug').hidden = !element('debug').hidden
    return
  }
  // V, or F5 with the mouse locked: first or third person
  if ((event.code === 'KeyV' || (event.code === 'F5' && pointer.locked)) && mode !== 'walk' && !event.repeat) {
    event.preventDefault()
    setMode(mode === 'first' ? 'third' : 'first')
    return
  }
  // Escape stops a walk (and lets the mouse go, as the browser does)
  if (event.code === 'Escape') {
    session.pathfinder?.stop()
    return
  }
  if (event.code === 'KeyT' || event.code === 'Slash' || event.code === 'Enter') {
    event.preventDefault()
    releaseAll()
    pointer.unlock()
    hud.typing(event.code === 'Slash' ? '/' : '')
    return
  }
  if (/^Digit[1-9]$/.test(event.code)) {
    client.selectSlot(Number(event.code.slice(5)) - 1)
    return
  }
  const control = KEYS[event.code]
  if (!control) return
  event.preventDefault()
  held.add(control)
  // a key that moves the player stops a walk first
  session.pathfinder?.stop('a key was pressed')
  client.setControl(control, true)
})
document.addEventListener('keyup', event => {
  const control = KEYS[event.code]
  if (!control) return
  held.delete(control)
  if (!walking()) session?.client?.setControl(control, false)
})
element('say').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    session?.client?.chat(element('say').value)
    hud.typing(null)
  } else if (event.key === 'Escape') {
    hud.typing(null)
  }
  event.stopPropagation()
})

// ---- the pathfinder menu ---------------------------------------------------------------------------------------

function showOptions () {
  for (const input of ui.options) input.checked = walkOptions[input.dataset.option]
  if (document.activeElement !== ui.maxDrop) ui.maxDrop.value = String(walkOptions.maxDrop)
}
function setOptions (given) {
  walkOptions = session?.pathfinder?.setOptions(given) ?? pathfinderOptions(given, walkOptions)
  store('gameplay.pathfinder', JSON.stringify(walkOptions))
  showOptions()
}
for (const input of ui.options) input.addEventListener('change', () => setOptions({ [input.dataset.option]: input.checked }))
ui.maxDrop.addEventListener('change', () => {
  if (ui.maxDrop.validity.valid && ui.maxDrop.value !== '') setOptions({ maxDrop: Number(ui.maxDrop.value) })
})
const hex = color => `#${color.toString(16).padStart(6, '0')}`
for (const swatch of document.querySelectorAll('#pathfinder [data-color]')) {
  const color = hex(ROUTE_COLORS[swatch.dataset.color])
  if (swatch.classList.contains('block')) swatch.style.borderColor = color
  else swatch.style.background = color
}
showOptions()

// ---- stats -----------------------------------------------------------------------------------------------------

const fixed = (n, d = 2) => Number(n).toFixed(d)
const kb = bytes => `${fixed(bytes / 1024, 1)} KB`

setInterval(() => {
  const s = session
  const client = s?.client
  if (!client) return
  const channel = client.channel.stats
  const now = Date.now()
  const seconds = Math.max(0.001, (now - s.rates.at) / 1000)
  s.rates = { at: now, sent: channel.bytesSent, received: channel.bytesReceived, up: (channel.bytesSent - s.rates.sent) / seconds, down: (channel.bytesReceived - s.rates.received) / seconds }
  const { stats } = client
  const server = s.serverStats?.connections?.[0]
  const goal = s.pathfinder?.goal
  hud.stats([
    `columns ${stats.columns}  sections ${stats.sections}`,
    `blobs: ${stats.blobs.hits} hit, ${stats.blobs.misses} missed, ${stats.blobs.received} received (${blobStore.size} kept)`,
    `in  ${kb(channel.bytesReceived)} (${kb(s.rates.down)}/s), ${channel.batchesReceived} batches`,
    `out ${kb(channel.bytesSent)} (${kb(s.rates.up)}/s), ${channel.batchesSent} batches`,
    `unread ${channel.decodeErrors}  read back otherwise ${client.codec.stats.verifyMismatches}${verify ? '' : ' (?verify=1)'}`,
    `teleports ${stats.teleports}  corrections ${stats.corrections}  unconfirmed ${client.interaction.unconfirmed(client.movement?.last ?? 0n)}`,
    server ? `server: ${server.columns} columns sent, ${server.placed} placed, ${server.broken} broken, ${server.refused} refused` : '',
    goal ? `walking to ${goal.x} ${goal.y} ${goal.z}` : '',
    `physics: ${exactTrig ? 'exact' : 'Math.sin'} trig`
  ].filter(Boolean).join('\n'))
  const player = client.player
  if (!player || element('debug').hidden) return
  const p = player.pos
  const st = player.bedrock ?? {}
  const target = s.target
  hud.debug([
    `${client.version}  ${['overworld', 'nether', 'end'][client.dimension]}  ${client.gamemode}  hashed ids ${client.registry.supportFeature('blockHashes') && !!client.startGame?.block_network_ids_are_hashes}  cache ${client.cache}`,
    `XYZ ${fixed(p.x, 3)} / ${fixed(p.y, 3)} / ${fixed(p.z, 3)}`,
    `block ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}  chunk ${Math.floor(p.x) >> 4} ${Math.floor(p.y) >> 4} ${Math.floor(p.z) >> 4}`,
    `facing yaw ${fixed(look.yaw, 1)} pitch ${fixed(look.pitch, 1)} (Bedrock degrees)  view ${mode}`,
    `velocity ${fixed(player.vel.x, 3)} ${fixed(player.vel.y, 3)} ${fixed(player.vel.z, 3)}`,
    ['onGround', 'sprinting', 'sneaking', 'swimming', 'crawling', 'flying'].filter(f => f === 'onGround' ? player.onGround : f === 'flying' ? player.flying : st[f]).join(' ') || '-',
    `tick ${client.movement.last}  time ${client.time}`,
    target ? `looking at ${target.name} ${target.pos.x} ${target.pos.y} ${target.pos.z} (face ${target.face})` : 'looking at nothing'
  ].join('\n'))
}, 500)

// ---- the bar ---------------------------------------------------------------------------------------------------

let queue = Promise.resolve()
const run = fn => { queue = queue.then(fn).catch(err => { status(String(err?.stack ?? err)) }) }

function syncAddress () {
  const url = new URL(window.location.href)
  url.searchParams.set('version', ui.version.value)
  if (ui.world.value) url.searchParams.set('world', ui.world.value)
  else url.searchParams.delete('world')
  url.searchParams.set('cache', ui.cache.checked ? '1' : '0')
  url.searchParams.set('hashes', ui.hashes.checked ? '1' : '0')
  url.searchParams.set('view', mode)
  window.history.replaceState(null, '', url)
}

function settings () {
  ui.hashes.disabled = !supportsHashes(ui.version.value)
  syncAddress()
}

async function main () {
  versionSelect(ui.version, (await bedrockVersions()).filter(({ version }) => hasProtocol(version)))
  ui.cache.checked = params.get('cache') !== '0'
  ui.hashes.checked = params.get('hashes') === '1'
  hud.info('first and third person: click the world to play: WASD move, Space jumps (twice: flies), Shift sneaks, R or Ctrl sprints; left breaks, right places (or opens a gate), middle picks, 1-9 and the wheel choose; V switches the view; T or / chat, F3 debug, Escape lets the mouse go. Walk view: a click walks there with the pathfinder')
  // the worlds imported (worldImport.js), besides the showcase
  const worlds = await fetch('worlds/index.json').then(r => r.ok ? r.json() : []).catch(() => [])
  // (each dimension of a world: explore, explore:nether, explore:end)
  for (const world of worlds) {
    for (const [dimension, columns] of Object.entries(world.dimensions ?? {})) {
      const option = document.createElement('option')
      option.value = dimension === 'overworld' ? world.name : `${world.name}:${dimension}`
      option.textContent = `${world.name}: ${dimension} (recorded in ${world.recorded}, ${columns} columns)`
      ui.world.appendChild(option)
    }
  }
  if ([...ui.world.options].some(option => option.value === params.get('world'))) ui.world.value = params.get('world')
  for (const input of [ui.version, ui.world, ui.cache, ui.hashes]) {
    input.addEventListener('change', () => {
      settings()
      run(join)
    })
  }
  ui.join.addEventListener('click', () => {
    ui.join.blur()
    run(join)
  })
  ui.leave.addEventListener('click', () => {
    ui.leave.blur()
    leave()
    status('left')
  })
  setMode(mode)
  settings()
  run(join)
}

// for the console and the smoke test
window.gameplay = {
  viewer,
  get client () { return session?.client },
  get pathfinder () { return session?.pathfinder },
  get mode () { return mode },
  setMode,
  walkTo,
  position () {
    const p = session?.client?.player?.pos
    return p ? { x: p.x, y: p.y, z: p.z } : null
  }
}

main()
