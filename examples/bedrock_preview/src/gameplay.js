/* global document, window, THREE, Worker, MessageChannel, localStorage, fetch */
// Bedrock gameplay in the page alone: a Bedrock server in a Web Worker (gameplayServer.js) sends the showcase world, and
// a client on the page (gameplay/client) plays it, the two exchanging the game's own packets, written and read by
// bedrock-protocol, over a MessagePort; the player moves with prismarine-physics' Bedrock engine, and the viewer draws
// the world the client is sent, in first person.
//
// The version, the blob cache and hashed block ids are chosen in the bar (and the address: ?version=bedrock_1.26.51
// &cache=1&hashes=1); a change joins again. The page keeps the blobs the client was sent from one join to the next, so
// that a join again with the cache on finds the world's blobs (the stats count the hits).
globalThis.Buffer = globalThis.Buffer ?? require('buffer').Buffer
const { Vec3 } = require('vec3')
const { preload } = require('../../../viewer/lib/mcData')
const { loadCrtAsync } = require('prismarine-physics-bedrock/lib/bedrock/index.ts')
const { bedrockVersions, versionSelect, createViewer } = require('./common')
const { bare, hasProtocol, supportsHashes } = require('./gameplay/data')
const { createClient } = require('./gameplay/client/client')
const { BlobStore } = require('./gameplay/client/blobs')
const { bedrockYaw, bedrockPitch } = require('./gameplay/client/movement')
const { createHud } = require('./gameplay/hud')

// how far the client sees (chunks), and reaches
const VIEW_DISTANCE = 6
const REACH = 6
// columns given to the viewer a frame (a column arrives again with each of its sections)
const COLUMNS_A_FRAME = 4
// a held mouse button repeats its use this often (ms)
const REPEAT = 250
// the sky of each dimension: the overworld's (the viewer's own), the nether's haze, the end's dark
const SKIES = ['lightblue', '#3a1414', '#17101f']

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
  view: element('view')
}
const hud = createHud({ hotbar: element('hotbar'), log: element('log'), say: element('say'), stats: element('stats'), debug: element('debug'), info: element('info') })
const params = new URLSearchParams(window.location.search)
const verify = params.get('verify') === '1'

// the session playing, if any (each join counts one more); the blobs of every join (the game keeps them on disk)
const blobStore = new BlobStore()
let session = null
let sessions = 0
// whether the physics' exact sine routines loaded
let exactTrig = false

const { viewer, renderer } = createViewer(ui.view, frame, { orbit: false })
viewer.camera.near = 0.05
viewer.camera.updateProjectionMatrix()
// the outline of the block aimed at
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x101010 }))
outline.visible = false
viewer.scene.add(outline)

const status = text => { ui.status.textContent = text }

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
  const s = { token, version, worker, client: null, ticker: null, columns: new Map(), serverStats: null, target: null, buttons: {}, rates: { at: Date.now(), sent: 0, received: 0, up: 0, down: 0 } }
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
  client.on('status', (stage, text) => current() && status(`${v}: ${text}`))
  client.on('startGame', (packet, { blockHashes }) => {
    if (!viewer.setVersion(version, { blockHashes })) status(`${v}: the viewer has no assets of this version`)
    // the sky of the dimension (the viewer has the overworld's)
    viewer.scene.background = new THREE.Color(SKIES[client.dimension] ?? SKIES[0])
    hud.setVersion(version).then(() => hud.hotbar(client.interaction.hotbar, client.interaction.selectedSlot))
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
  outline.visible = false
  hud.clear()
  if (document.pointerLockElement) document.exitPointerLock()
}

// ---- each frame ------------------------------------------------------------------------------------------------

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
  // the camera at the eyes, between the last two ticks, looking where the mouse says (at once)
  const { movement, look } = client
  const { player, prevPos, physics } = movement
  const alpha = Math.max(0, Math.min(1, (Date.now() - movement.lastTickTime) / 50))
  const lerp = (a, b) => a + (b - a) * alpha
  const offset = lerp(player.bedrock?.eyeOffsetPrev ?? 0, player.bedrock?.eyeOffset ?? 0)
  viewer.camera.position.set(lerp(prevPos.x, player.pos.x), lerp(prevPos.y, player.pos.y) + physics.eyeHeight - offset, lerp(prevPos.z, player.pos.z))
  viewer.camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ')
  // the block aimed at
  const dir = new THREE.Vector3()
  viewer.camera.getWorldDirection(dir)
  const eye = viewer.camera.position
  s.target = client.target({ x: eye.x, y: eye.y, z: eye.z }, { x: dir.x, y: dir.y, z: dir.z }, REACH)
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
let sensitivity = Number(localStorage?.getItem('gameplay.sensitivity') ?? 6)
ui.sensitivity.value = sensitivity
ui.sensitivity.addEventListener('input', () => {
  sensitivity = Number(ui.sensitivity.value)
  try { localStorage.setItem('gameplay.sensitivity', String(sensitivity)) } catch {}
})
const chatOpen = () => element('say').style.display === 'block'

function releaseAll () {
  const client = session?.client
  if (!client) return
  for (const name of Object.values(KEYS)) client.setControl(name, false)
  if (session) session.buttons = {}
}

// left: break, right: place, middle: the block aimed at into the hand (if the hotbar has it)
function use (button) {
  const s = session
  const client = s?.client
  if (!client?.player || !s.target) return
  if (button === 0) client.breakBlock(s.target)
  else if (button === 2) client.placeBlock(s.target)
  else if (button === 1) {
    const slot = client.interaction.hotbar.findIndex(item => item?.blockRuntimeId === s.target.stateId || item?.name === s.target.name)
    if (slot >= 0) client.selectSlot(slot)
  }
}

renderer.domElement.addEventListener('click', () => {
  if (!session?.client || document.pointerLockElement) return
  // (unadjusted movement: the mouse's own counts, where the browser has it)
  const locked = renderer.domElement.requestPointerLock({ unadjustedMovement: true })
  locked?.catch?.(() => renderer.domElement.requestPointerLock()?.catch?.(() => {}))
})
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) releaseAll() })
window.addEventListener('blur', releaseAll)
document.addEventListener('mousemove', event => {
  const client = session?.client
  if (!client || document.pointerLockElement !== renderer.domElement) return
  const k = sensitivity * 0.0004
  client.setLook(client.look.yaw - event.movementX * k, client.look.pitch - event.movementY * k)
})
renderer.domElement.addEventListener('mousedown', event => {
  if (document.pointerLockElement !== renderer.domElement) return
  event.preventDefault()
  use(event.button)
  if (event.button !== 1 && session) session.buttons[event.button] = Date.now()
})
document.addEventListener('mouseup', event => { if (session) delete session.buttons[event.button] })
renderer.domElement.addEventListener('contextmenu', event => event.preventDefault())
renderer.domElement.addEventListener('wheel', event => {
  const client = session?.client
  if (!client) return
  event.preventDefault()
  client.selectSlot((client.interaction.selectedSlot + (event.deltaY > 0 ? 1 : 8)) % 9)
}, { passive: false })

document.addEventListener('keydown', event => {
  const client = session?.client
  if (!client || chatOpen() || event.target.tagName === 'SELECT' || event.target.tagName === 'INPUT') return
  if (event.code === 'F3') {
    event.preventDefault()
    element('debug').hidden = !element('debug').hidden
    return
  }
  if (event.code === 'KeyT' || event.code === 'Slash' || event.code === 'Enter') {
    event.preventDefault()
    releaseAll()
    if (document.pointerLockElement) document.exitPointerLock()
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
  client.setControl(control, true)
})
document.addEventListener('keyup', event => {
  const control = KEYS[event.code]
  if (control) session?.client?.setControl(control, false)
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
  hud.stats([
    `columns ${stats.columns}  sections ${stats.sections}`,
    `blobs: ${stats.blobs.hits} hit, ${stats.blobs.misses} missed, ${stats.blobs.received} received (${blobStore.size} kept)`,
    `in  ${kb(channel.bytesReceived)} (${kb(s.rates.down)}/s), ${channel.batchesReceived} batches`,
    `out ${kb(channel.bytesSent)} (${kb(s.rates.up)}/s), ${channel.batchesSent} batches`,
    `unread ${channel.decodeErrors}  read back otherwise ${client.codec.stats.verifyMismatches}${verify ? '' : ' (?verify=1)'}`,
    `teleports ${stats.teleports}  corrections ${stats.corrections}  unconfirmed ${client.interaction.unconfirmed(client.movement?.last ?? 0n)}`,
    server ? `server: ${server.columns} columns sent, ${server.placed} placed, ${server.broken} broken, ${server.refused} refused` : '',
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
    `facing yaw ${fixed(bedrockYaw(client.look.yaw), 1)} pitch ${fixed(bedrockPitch(client.look.pitch), 1)} (Bedrock degrees)`,
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
  hud.info('click the world to play: WASD move, Space jumps (twice: flies), Shift sneaks, R or Ctrl sprints; left breaks, right places, middle picks, 1-9 and the wheel choose; T or / chat, F3 debug, Escape lets the mouse go')
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
  settings()
  run(join)
}

// for the console and the smoke test
window.gameplay = {
  viewer,
  get client () { return session?.client },
  position () {
    const p = session?.client?.player?.pos
    return p ? { x: p.x, y: p.y, z: p.z } : null
  }
}

main()
