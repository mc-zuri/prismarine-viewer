/* global THREE, document, window, createImageBitmap */
// Every entity of a Bedrock version, as the viewer draws it with the version's client entities (its scripts,
// animations, animation controllers and render controllers), in the poses and movements the game animates: standing,
// walking, sprinting, sneaking, swimming, gliding, crawling, sitting, riding, sleeping; and what it does once: an
// attack, a hurt, a death, grazing... Each mode sets what the client would be told of the entity (its flags, whether it
// is on the ground or in water) and moves it: a moving entity walks on a position of its own while it stays in its
// cell, so that its legs swing as far as they would.
//
// entities.html?version=bedrock_1.26.51&mode=walk&focus=player&filter=zombie (focus: an entity's name, with or without
// minecraft:, or player for Steve)
const { bedrockVersions, versionSelect, createViewer, viewFrom45, label } = require('./common')
const { loadEntityAssets, entityAssetFile } = require('../../../viewer/lib/bedrock/entity/assets')
const { ParticleSystem } = require('../../../viewer/lib/bedrock/particles/system')

// The modes: flags set, speed (blocks a tick, forward), off the ground, in water, sinking (blocks a tick), what it rides
const MODES = {
  stand: { title: 'stand', flags: [], about: 'nothing: still, on the ground' },
  walk: { title: 'walk', flags: [], speed: 0.2, about: 'moves forward 0.2 blocks a tick' },
  sprint: { title: 'sprint', flags: ['sprinting'], speed: 0.28, about: 'moves forward 0.28 blocks a tick' },
  sneak: { title: 'sneak', flags: ['sneaking'], about: 'still' },
  sneak_walk: { title: 'sneak + walk', flags: ['sneaking'], speed: 0.065, about: 'moves forward 0.065 blocks a tick' },
  swim: { title: 'swim', flags: ['swimming'], speed: 0.2, inWater: true, airborne: true, about: 'in water, off the ground, moves forward 0.2 blocks a tick' },
  glide: { title: 'glide', flags: ['gliding'], speed: 0.8, sink: 0.05, airborne: true, about: 'off the ground, moves forward 0.8 and down 0.05 blocks a tick (an elytra flight: the body lies along the look)' },
  fly: { title: 'fly / fall', flags: [], speed: 0.2, airborne: true, about: 'off the ground, moves forward 0.2 blocks a tick (wings flap)' },
  crawl: { title: 'crawl', flags: ['crawling'], speed: 0.065, about: 'moves forward 0.065 blocks a tick' },
  sit: { title: 'sit', flags: ['sitting'], about: 'still (cats, wolves, parrots, foxes, camels...)' },
  ride: { title: 'ride', flags: ['riding'], vehicle: 'minecraft:horse', about: 'state.vehicle minecraft:horse: query.is_riding, no walk' },
  sleep: { title: 'sleep', flags: ['sleeping'], about: 'still (a player in bed, a villager, a fox)' },
  rest: { title: 'rest / lie down', flags: ['resting', 'laying_down'], about: 'still (a bat hangs, a cat lies down, a panda lies)' }
}

// the way they all face, the game's yaw (degrees, 0 toward +z, turning clockwise): toward the camera's first view
const YAW = -45
const FORWARD = { x: -Math.sin(YAW * Math.PI / 180), z: Math.cos(YAW * Math.PI / 180) }
const TICKS_PER_SECOND = 20
// the jump button's hop
const HOP_SECONDS = 0.5
const HOP_HEIGHT = 0.5
// the farthest a name shows (blocks from the camera)
const LABEL_DISTANCE = 26

const $ = id => document.getElementById(id)
const params = new URLSearchParams(window.location.search)

function setParam (name, value) {
  if (value) params.set(name, value)
  else params.delete(name)
  window.history.replaceState(null, '', '?' + params.toString())
}

// ---- settings: what the controls say, for all entities or one -------------------------------------------------------

const FLAG_BOXES = [...document.querySelectorAll('input[data-flag]')]
const SLOT_SELECTS = [...document.querySelectorAll('select[data-slot]')]

// what the equipment selects offer, of what the version has
const HELD = ['iron_sword', 'diamond_sword', 'golden_axe', 'bow', 'crossbow', 'trident', 'shield', 'mace', 'iron_spear', 'spyglass', 'totem_of_undying', 'torch', 'apple', 'stone']
const ARMOUR = ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite', 'copper']
const PIECES = { head: 'helmet', chest: 'chestplate', legs: 'leggings', feet: 'boots' }

function equipmentOptions (assets) {
  const has = name => !!assets.items?.[name] || !!assets.attachables?.['minecraft:' + name]
  const fill = (select, names, none) => {
    select.innerHTML = `<option value="">${none}</option>` + names.filter(has).map(n => `<option>${n}</option>`).join('')
  }
  fill($('mainhand'), HELD, 'nothing')
  fill($('offhand'), ['shield', 'totem_of_undying', 'torch', ...HELD.filter(n => !['shield', 'totem_of_undying', 'torch'].includes(n))], 'nothing')
  for (const [slot, piece] of Object.entries(PIECES)) {
    fill($(slot), [...ARMOUR.map(m => `${m}_${piece}`), ...(slot === 'head' ? ['turtle_helmet'] : [])], 'no ' + piece)
  }
}

function readControls () {
  return {
    mode: $('mode').value,
    flags: Object.fromEntries(FLAG_BOXES.map(box => [box.dataset.flag, box.checked])),
    extraFlags: $('flags').value,
    inWater: $('inWater').checked,
    equipment: Object.fromEntries(SLOT_SELECTS.map(select => [select.dataset.slot, select.value])),
    variant: Number($('variant').value) || 0,
    mark_variant: Number($('mark_variant').value) || 0,
    color: Number($('color').value) || 0,
    climate: $('climate').value
  }
}

function writeControls (settings) {
  $('mode').value = settings.mode
  for (const box of FLAG_BOXES) box.checked = !!settings.flags[box.dataset.flag]
  $('flags').value = settings.extraFlags
  $('inWater').checked = settings.inWater
  for (const select of SLOT_SELECTS) select.value = settings.equipment[select.dataset.slot] ?? ''
  $('variant').value = settings.variant
  $('mark_variant').value = settings.mark_variant
  $('color').value = settings.color
  $('climate').value = settings.climate
}

// the flags an entity is told of with its settings
function flagsOf (settings) {
  const flags = {}
  for (const flag of MODES[settings.mode].flags) flags[flag] = true
  for (const [flag, on] of Object.entries(settings.flags)) if (on) flags[flag] = true
  for (const flag of settings.extraFlags.split(',').map(f => f.trim()).filter(Boolean)) flags[flag] = true
  return flags
}

// ---- the entities ----------------------------------------------------------------------------------------------------

// the names of the entity properties a definition, its render controllers and animation controllers read
function propertiesRead (assets, desc) {
  let text = JSON.stringify(desc)
  for (const rc of desc.render_controllers ?? []) text += JSON.stringify(assets.render_controllers[typeof rc === 'string' ? rc : Object.keys(rc)[0]] ?? {})
  for (const id of Object.values(desc.animations ?? {})) text += JSON.stringify(assets.animation_controllers[id] ?? {})
  return [...new Set([...text.matchAll(/q(?:uery)?\.property\(\s*'([^']+)'\s*\)/gi)].map(m => m[1].toLowerCase()))]
    .filter(name => name !== 'minecraft:climate_variant')
}

// One entity: its model and what it is told. -> { name, model, object, ok, reason }
function createRecord (assets, name, make) {
  const record = { name, ok: true, override: null, properties: {}, dirty: true, pos: { x: 0, y: 0, z: 0 } }
  try {
    record.model = make()
  } catch (err) {
    record.ok = false
    record.reason = err.message
    return record
  }
  record.object = record.model.object
  record.object.rotation.y = Math.PI - YAW * Math.PI / 180
  record.object.userData.record = record
  record.properties = Object.fromEntries(propertiesRead(assets, record.model.desc).map(p => [p, '']))
  return record
}

// Builds a model's layers once and measures it; one that throws or draws nothing is skipped
function measure (record, settings) {
  try {
    applyState(record, settings)
    record.model.setMotion({ position: record.pos, yaw: YAW, headYaw: YAW, pitch: 0, onGround: true })
    record.model.update(0.05)
  } catch (err) {
    record.ok = false
    record.reason = err.message
    return
  }
  const drawn = [...record.model.layers.values()].some(layer => layer.skeleton)
  record.object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(record.object)
  if (!drawn || box.isEmpty()) {
    record.ok = false
    record.reason = drawn ? 'its geometry has no cubes' : 'no geometry its render controllers name'
    return
  }
  record.box = box
}

// who wears armour and holds things in the game: the equipment selects go on them only (a cow has a head and a body,
// but no helmet goes on it)
const WEARS_ARMOUR = new Set(['player', 'zombie', 'husk', 'drowned', 'zombie_villager', 'zombie_villager_v2', 'zombie_pigman', 'piglin', 'piglin_brute', 'skeleton', 'stray', 'wither_skeleton', 'bogged', 'parched', 'armor_stand'])
const HOLDS = new Set([...WEARS_ARMOUR, 'pillager', 'vindicator', 'evocation_illager', 'illusioner', 'vex', 'allay', 'fox', 'witch', 'copper_golem'])
const ARMOUR_SLOTS = new Set(['head', 'chest', 'legs', 'feet'])
function equipmentFor (record, equipment) {
  const kind = record.name.split(' ')[0]
  return Object.fromEntries(Object.entries(equipment).filter(([slot, item]) => item && (ARMOUR_SLOTS.has(slot) ? WEARS_ARMOUR.has(kind) : HOLDS.has(kind))))
}

function applyState (record, settings) {
  const mode = MODES[settings.mode]
  const props = Object.fromEntries(Object.entries(record.properties).filter(([, v]) => v !== '').map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)]))
  record.model.setState({
    metadata: { flags: flagsOf(settings), variant: settings.variant, mark_variant: settings.mark_variant, color: settings.color },
    properties: { 'minecraft:climate_variant': settings.climate, ...props },
    equipment: equipmentFor(record, settings.equipment),
    vehicle: mode.vehicle ?? null
  })
}

// ---- the page ----------------------------------------------------------------------------------------------------------

async function main () {
  const status = $('status')
  const info = $('info')

  // the versions, those whose entities are built (or of the nearest version that has them) usable
  const versions = await bedrockVersions()
  const select = $('version')
  versionSelect(select, versions)
  const files = await Promise.all(versions.map(v => entityAssetFile(v.version)))
  const usable = new Map()
  for (const [i, option] of [...select.options].entries()) {
    const file = files[i]
    if (!file) {
      option.disabled = true
      option.textContent += ' (no entities built)'
    } else {
      usable.set(option.value, file)
      if (file !== option.value && file !== versions[i].files) option.textContent += ` (entities of ${file.replace('bedrock_', '')})`
    }
  }
  const asked = params.get('version')
  if (!usable.has(select.value)) {
    const first = [...usable.keys()][0]
    if (first && !asked) select.value = first
  }
  select.addEventListener('change', () => {
    params.set('version', select.value)
    window.location.search = '?' + params.toString()
  })
  const version = select.value
  if (!usable.has(version)) {
    status.textContent = asked ? `${asked} has no entities built: build it with node viewer/prerender.js --versions ${asked}` : 'no Bedrock version has its entities built: run node viewer/prerender.js'
    return
  }
  status.textContent = 'loading...'

  const assets = await loadEntityAssets(version)
  if (!assets) {
    status.textContent = `the entities of ${version} could not be loaded`
    return
  }

  // the controls
  equipmentOptions(assets)
  for (const [key, mode] of Object.entries(MODES)) {
    const option = document.createElement('option')
    option.value = key
    option.textContent = mode.title
    $('mode').appendChild(option)
  }
  $('legendTable').innerHTML = Object.values(MODES).map(mode => `<tr><td>${mode.title}</td><td>${mode.flags.map(f => `<code>flags.${f}</code>`).join(' ')}` +
    `${mode.vehicle ? ' <code>vehicle</code>' : ''}${mode.inWater ? ' <code>inWater</code>' : ''}${mode.airborne ? ' <code>onGround: false</code>' : ''} ${mode.about}</td></tr>`).join('') +
    '<tr><td colspan="2">A moving entity walks on a position of its own (setMotion) while it stays in its cell: query.modified_move_speed, ' +
    'query.ground_speed, the body turning to the way it goes. The buttons send its events (event()); the checkboxes set its flags ' +
    '(setState metadata.flags), as their tooltips say. Each control applies to all entities, or to the focused one only: ' +
    'focusing one (a click on it, or the Focus list) sets what follows for it alone, until the overview.</td></tr>'

  const global = { ...readControls(), mode: MODES[params.get('mode')] ? params.get('mode') : 'stand' }
  writeControls(global)

  // (the viewer draws from now on: frame() runs before every frame)
  let shown = []
  let visible = []
  let focused = null
  const skipped = []
  let particles = null
  const { viewer, controls, renderer } = createViewer($('view'), frame)
  const scene = viewer.scene
  // the particle effects the entities start (a blaze's flames, an evoker's spell...), landing on the grid
  particles = new ParticleSystem(scene, assets, { ground: 0 })

  // every client entity, and the players as Steve and Alex
  const records = []
  for (const identifier of Object.keys(assets.entities).sort()) {
    if (identifier === 'minecraft:player') continue
    records.push(createRecord(assets, identifier.replace(/^minecraft:/, ''), () => assets.create(identifier)))
  }
  if (assets.has('minecraft:player')) {
    records.unshift(createRecord(assets, 'player (Steve)', () => assets.player({ armSize: 'wide' })))
    records.unshift(createRecord(assets, 'player (Alex)', () => assets.player({ armSize: 'slim' })))
    records[0].armSize = 'slim'
    records[1].armSize = 'wide'
  }
  // (measured standing, wherever the mode puts them)
  for (const record of records) {
    if (!record.ok) continue
    record.model.particles = particles
    measure(record, { ...global, mode: 'stand' })
  }
  shown = records.filter(r => r.ok)
  skipped.push(...records.filter(r => !r.ok))
  for (const record of shown) {
    scene.add(record.object)
    // a name over it, hidden behind what is in front of it
    record.label = label(record.name, { height: 0.35 })
    record.label.material.depthTest = true
    scene.add(record.label)
  }

  // ---- the grid, of those the filter lets through --------------------------------------------------------------------

  let ground = null
  let extent = 10
  function layout () {
    // (several words: any of them)
    const words = $('filter').value.toLowerCase().split(/[\s,]+/).filter(Boolean)
    visible = shown.filter(r => !words.length || words.some(word => r.name.includes(word)))
    for (const r of shown) {
      r.object.visible = visible.includes(r)
      // (those hidden are not run: their effects stop, and start again as they are shown)
      if (!r.object.visible) r.model.stopAllEffects()
    }
    showLabels()
    const cells = visible.map(r => {
      const size = r.box.getSize(new THREE.Vector3())
      return { r, w: Math.max(2.5, size.x + 1.5), d: Math.max(2.5, size.z + 1.5), h: size.y }
    })
    const area = cells.reduce((sum, c) => sum + c.w * c.d, 0)
    const rowWidth = Math.max(12, Math.sqrt(area) * 1.1)
    let x = 0
    let z = 0
    let rowDepth = 0
    let width = 0
    for (const c of cells) {
      if (x > 0 && x + c.w > rowWidth) {
        x = 0
        z += rowDepth
        rowDepth = 0
      }
      c.x = x + c.w / 2
      c.z = z + c.d / 2
      x += c.w
      width = Math.max(width, x)
      rowDepth = Math.max(rowDepth, c.d)
    }
    const depth = z + rowDepth
    for (const c of cells) {
      const center = c.r.box.getCenter(new THREE.Vector3()).sub(c.r.object.position)
      c.r.object.position.set(c.x - width / 2 - center.x, 0, c.z - depth / 2 - center.z)
      c.r.object.updateMatrixWorld(true)
      c.r.box.setFromObject(c.r.object)
      c.r.label.position.set(c.x - width / 2, c.h + 0.3, c.z - depth / 2)
      c.r.pos = { x: c.r.object.position.x, y: 0, z: c.r.object.position.z }
    }
    if (ground) scene.remove(ground)
    extent = Math.max(width, depth, 6)
    ground = new THREE.GridHelper(Math.ceil(extent) + 4, Math.ceil(extent) + 4, 0x5a6a7a, 0x8aa0b0)
    scene.add(ground)

    // the focus list
    const focus = $('focus')
    focus.innerHTML = '<option value="">(overview)</option>' + visible.map(r => `<option>${r.name}</option>`).join('')
    focus.value = focused && visible.includes(focused) ? focused.name : ''
  }

  // ---- focus -------------------------------------------------------------------------------------------------------

  // the names over them: in the overview only (close up, they would hide what is focused), and those near the camera
  function showLabels () {
    const names = $('names').checked && !focused
    for (const r of shown) r.label.visible = names && visible.includes(r) && r.label.position.distanceTo(viewer.camera.position) < LABEL_DISTANCE
  }

  function overview () {
    viewFrom45(viewer, controls, new THREE.Vector3(0, 1, 0), extent * 0.5 + 4)
  }
  function focus (record) {
    focused = record && visible.includes(record) ? record : null
    document.body.classList.toggle('focused', !!focused)
    showLabels()
    $('focus').value = focused ? focused.name : ''
    setParam('focus', focused?.name)
    if (!focused) {
      if ($('scopeFocused').checked) document.querySelector('input[name=scope][value=all]').checked = true
      writeControls(global)
      overview()
      showInfo()
      return
    }
    // what is set from now on is set for it alone, until the overview
    $('scopeFocused').checked = true
    const target = focused
    const box = focused.box
    const center = box.getCenter(new THREE.Vector3())
    viewFrom45(viewer, controls, center, Math.max(3.5, box.getSize(new THREE.Vector3()).length() * 1.4))
    // its animations, and the entity properties it reads
    const animations = Object.keys(focused.model.desc.animations ?? {}).sort()
    $('animation').innerHTML = animations.map(a => `<option>${a}</option>`).join('')
    const props = $('properties')
    props.innerHTML = ''
    for (const [name, value] of Object.entries(focused.properties)) {
      const field = document.createElement('label')
      field.title = `properties['${name}']: query.property`
      field.textContent = name.replace(/^minecraft:/, '') + ' '
      const input = document.createElement('input')
      input.size = 8
      input.value = value
      input.addEventListener('change', () => {
        target.properties[name] = input.value
        target.dirty = true
      })
      field.appendChild(input)
      props.appendChild(field)
    }
    writeControls(settingsOfTarget())
    showInfo()
  }

  const scopeFocused = () => $('scopeFocused').checked && focused
  const settingsOf = record => record.override ?? global
  const settingsOfTarget = () => scopeFocused() ? settingsOf(focused) : global

  function showInfo () {
    const lines = [`${version}${usable.get(version) !== version ? ` (entities of ${usable.get(version)})` : ''}: ` +
      `${shown.length} entities drawn${visible.length !== shown.length ? `, ${visible.length} shown` : ''}`]
    if (skipped.length) lines.push(`skipped, as they draw nothing: ${skipped.map(r => `${r.name} (${r.reason})`).join(', ')}`)
    if (focused) {
      const desc = focused.model.desc
      lines.push(`${focused.model.identifier}: geometry ${Object.values(desc.geometry ?? {}).join(' ')}; ` +
        `render controllers ${(desc.render_controllers ?? []).map(rc => typeof rc === 'string' ? rc : Object.keys(rc)[0]).join(' ') || 'none (the default)'}; ` +
        `${Object.keys(desc.animations ?? {}).length} animations`)
    }
    info.textContent = lines.join('\n')
  }

  // ---- the controls ------------------------------------------------------------------------------------------------

  function changed () {
    const settings = readControls()
    if (scopeFocused()) {
      focused.override = settings
      focused.dirty = true
    } else {
      Object.assign(global, settings)
      for (const r of shown) if (!r.override) r.dirty = true
      setParam('mode', global.mode === 'stand' ? null : global.mode)
    }
  }
  for (const input of $('bar').querySelectorAll('.row:nth-child(2) input, .row:nth-child(2) select')) {
    input.addEventListener('change', changed)
  }
  for (const radio of document.querySelectorAll('input[name=scope]')) {
    radio.addEventListener('change', () => writeControls(settingsOfTarget()))
  }
  // the events; those only some kinds show (data-kinds) say so when none of them is shown. A jump is a hop too: newer
  // rabbits hop as they move up
  for (const button of document.querySelectorAll('button[data-event]')) {
    button.addEventListener('click', () => {
      const targets = scopeFocused() ? [focused] : visible
      for (const r of targets) {
        r.model.event(button.dataset.event)
        if (button.dataset.event === 'jump') r.hop = 0
      }
      const kinds = button.dataset.kinds?.split(' ')
      const shows = !kinds || targets.some(r => kinds.includes(r.name.replace(/^minecraft:/, '')))
      $('eventNote').textContent = shows ? '' : `${button.textContent}: only ${kinds.map(k => k.replace(/_/g, ' ')).join(', ')} shows it, and none is shown`
    })
  }
  $('play').addEventListener('click', () => {
    if (focused) focused.model.playAnimation({ animation: $('animation').value })
  })
  $('stop').addEventListener('click', () => {
    if (focused) focused.model.runtime.clear()
  })
  $('filter').addEventListener('input', () => {
    setParam('filter', $('filter').value.trim())
    layout()
    if (focused && !visible.includes(focused)) focus(null)
    else if (!focused) overview()
    showInfo()
  })
  $('focus').addEventListener('change', () => focus(shown.find(r => r.name === $('focus').value)))
  $('overview').addEventListener('click', () => focus(null))
  $('names').addEventListener('change', showLabels)

  // the players' skin: the pack's Steve and Alex, or an image of one, drawn wide and slim
  let skinImage = null
  async function readSkin () {
    const file = $('skinFile').files[0]
    if (!file) return null
    const image = await createImageBitmap(file)
    // a classic 64x32 skin as a 64x64 one: its leg and arm for the left ones too (as the game converts it)
    const legacy = image.height * 2 === image.width
    const size = image.width / 64
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = legacy ? image.width : image.height
    const g = canvas.getContext('2d')
    g.drawImage(image, 0, 0)
    if (legacy) {
      g.drawImage(image, 0, 16 * size, 16 * size, 16 * size, 16 * size, 48 * size, 16 * size, 16 * size)
      g.drawImage(image, 40 * size, 16 * size, 16 * size, 16 * size, 32 * size, 48 * size, 16 * size, 16 * size)
    }
    return { width: canvas.width, height: canvas.height, data: g.getImageData(0, 0, canvas.width, canvas.height).data }
  }
  async function applySkin () {
    if ($('skin').value === 'custom') skinImage = skinImage ?? await readSkin()
    for (const r of shown.filter(r => r.armSize)) {
      const geometry = r.armSize === 'slim' ? 'geometry.humanoid.customSlim' : 'geometry.humanoid.custom'
      const skin = $('skin').value === 'custom' && skinImage
        ? { image: skinImage, resourcePatch: JSON.stringify({ geometry: { default: geometry } }), geometryData: '', armSize: r.armSize }
        : { armSize: r.armSize }
      const model = assets.player(skin)
      model.particles = particles
      const old = r.model
      model.object.position.copy(r.object.position)
      model.object.rotation.copy(r.object.rotation)
      scene.remove(r.object)
      old.dispose()
      r.model = model
      r.object = model.object
      r.object.userData.record = r
      r.dirty = true
      scene.add(r.object)
    }
    status.textContent = $('skin').value === 'custom' && !skinImage ? 'choose a skin image' : `${shown.length} entities`
  }
  $('skin').addEventListener('change', applySkin)
  $('skinFile').addEventListener('change', () => {
    skinImage = null
    $('skin').value = 'custom'
    applySkin()
  })

  // a click (not a drag) on an entity focuses it
  let down = null
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY } })
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
    const rect = renderer.domElement.getBoundingClientRect()
    const mouse = new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, viewer.camera)
    for (const hit of raycaster.intersectObjects(visible.map(r => r.object), true)) {
      let o = hit.object
      while (o && !o.userData.record) o = o.parent
      if (o) return focus(o.userData.record)
    }
  })

  // ---- every frame -------------------------------------------------------------------------------------------------

  function frame (dt) {
    if (shown.length) showLabels()
    for (const r of visible) {
      if (!r.ok) continue
      const settings = settingsOf(r)
      const mode = MODES[settings.mode]
      try {
        if (r.dirty) {
          applyState(r, settings)
          r.dirty = false
        }
        // a moving one goes on a position of its own (the dragon opposite its yaw, as a server moves it: the client
        // turns it round)
        const step = (mode.speed ?? 0) * dt * TICKS_PER_SECOND * (r.name === 'ender_dragon' ? -1 : 1)
        r.pos = { x: r.pos.x + FORWARD.x * step, y: r.pos.y - (mode.sink ?? 0) * dt * TICKS_PER_SECOND, z: r.pos.z + FORWARD.z * step }
        // a hop: half a block up and down over half a second
        let hopY = 0
        if (r.hop !== undefined) {
          r.hop += dt / HOP_SECONDS
          if (r.hop >= 1) delete r.hop
          else hopY = 4 * HOP_HEIGHT * r.hop * (1 - r.hop)
        }
        // (it is drawn in its cell, lifted by its hop)
        r.object.position.y = hopY
        r.model.setMotion({ position: { ...r.pos, y: r.pos.y + hopY }, yaw: YAW, headYaw: YAW, pitch: 0, onGround: !mode.airborne && !hopY, inWater: settings.inWater || !!mode.inWater })
        r.model.setCamera(viewer.camera.position)
        r.model.update(dt)
      } catch (err) {
        // its scripts broke: it stays as it was, and is listed
        r.ok = false
        r.reason = err.message
        skipped.push(r)
        showInfo()
      }
    }
    // (after the entities: their effects follow them where they are now)
    particles?.update(dt, viewer.camera)
  }

  $('filter').value = params.get('filter') ?? ''
  layout()
  const focusAsked = (params.get('focus') ?? '').replace(/^minecraft:/, '')
  focus(shown.find(r => r.name === focusAsked) ?? shown.find(r => r.name.startsWith(focusAsked + ' (')) ?? null)
  status.textContent = `${shown.length} entities`

  // ready once every texture they named has loaded (or failed)
  await Promise.allSettled([...assets.textures.values()].filter(Boolean).map(t => t.userData.ready))
  document.body.dataset.ready = 'true'
}

main()
