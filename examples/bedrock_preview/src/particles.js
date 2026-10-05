/* global THREE, document, window */
// Every particle effect of a Bedrock version (its resource packs' particles, built into its entity file), the ones
// chosen played side by side in a grid: those that run on (a looping or an endless lifetime) run on, those that end
// (a lifetime once) are played again every few seconds, and those whose particles the game emits itself (a manual
// rate) are given some every moment. They are drawn by the viewer's ParticleSystem (viewer/lib/bedrock/particles).
//
// particles.html?version=bedrock_1.26.51&filter=flame&play=shown (play: shown, or identifiers comma separated)
const { bedrockVersions, versionSelect, createViewer, viewFrom45, label } = require('./common')
const { loadEntityAssets, entityAssetFile } = require('../../../viewer/lib/bedrock/entity/assets')
const { ParticleSystem } = require('../../../viewer/lib/bedrock/particles/system')

// blocks between the effects
const CELL = 5
// an effect that ends is played again after so many seconds
const REPLAY_SECONDS = 3
// an effect of manual rate is given a particle so often (seconds)
const EMIT_SECONDS = 0.15
// the game's queries of the effects on no entity: in water (bubbles, a dolphin's trail), else the system's
const QUERIES = { is_in_water: 1 }

const $ = id => document.getElementById(id)
const params = new URLSearchParams(window.location.search)

function setParam (name, value) {
  if (value) params.set(name, value)
  else params.delete(name)
  window.history.replaceState(null, '', '?' + params.toString())
}

const short = identifier => identifier.replace(/^minecraft:/, '')

// how an effect is played: 'emitted' (manual rate), 'once' (it ends), 'runs' (looping, or for as long as its Molang says)
function kindOf (def) {
  if (def.rate.kind === 'manual') return 'emitted'
  return def.lifetime.kind === 'once' ? 'once' : 'runs'
}

async function main () {
  const status = $('status')
  const info = $('info')

  // the versions, those whose entity files are built (or the nearest's) usable
  const versions = await bedrockVersions()
  const select = $('version')
  versionSelect(select, versions)
  const files = await Promise.all(versions.map(v => entityAssetFile(v.version)))
  const usable = new Set()
  for (const [i, option] of [...select.options].entries()) {
    if (files[i]) usable.add(option.value)
    else {
      option.disabled = true
      option.textContent += ' (not built)'
    }
  }
  if (!usable.has(select.value) && !params.get('version')) select.value = [...usable][0] ?? select.value
  select.addEventListener('change', () => {
    params.set('version', select.value)
    window.location.search = '?' + params.toString()
  })
  const version = select.value
  const assets = usable.has(version) ? await loadEntityAssets(version) : null
  if (!assets) {
    status.textContent = `${version} has no entity file built: build it with node viewer/prerender.js --versions ${version}`
    return
  }
  const identifiers = Object.keys(assets.particles ?? {}).sort()
  if (!identifiers.length) {
    status.textContent = `${version}'s entity file has no particle effects: build it again (node viewer/prerender.js -f --versions ${version})`
    return
  }

  let system = null
  const { viewer, controls } = createViewer($('view'), frame)
  const scene = viewer.scene
  // the atlases the game draws the particles of blocks and items from: a block of dirt and an apple stand in
  system = new ParticleSystem(scene, assets, {
    ground: 0,
    query: name => QUERIES[name],
    atlases: { 'atlas.terrain': assets.texture('blocks/dirt'), 'atlas.items': assets.texture('items/apple') }
  })

  // ---- the list --------------------------------------------------------------------------------------------------

  const rows = new Map()
  for (const identifier of identifiers) {
    const def = system.definition(identifier)
    const row = document.createElement('label')
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.addEventListener('change', () => { setChosen(); layout() })
    const name = document.createElement('span')
    name.textContent = short(identifier)
    const kind = document.createElement('span')
    kind.className = 'kind' + (def?.unsupported.length ? ' unsupported' : '')
    kind.textContent = def ? kindOf(def) + (def.unsupported.length ? ' *' : '') : 'broken'
    row.title = def
      ? `${identifier}\n${def.material}, ${def.texture}\nrate ${def.rate.kind}, lifetime ${def.lifetime.kind}, shape ${def.shape.kind}` +
        `${def.billboard ? `, ${def.billboard.facing}` : ', no billboard'}${def.unsupported.length ? `\nnot run: ${def.unsupported.join(', ')}` : ''}`
      : identifier
    row.append(box, name, kind)
    $('list').appendChild(row)
    rows.set(identifier, { row, box })
  }

  function shownIdentifiers () {
    return identifiers.filter(id => !rows.get(id).row.classList.contains('hidden'))
  }
  function filter () {
    const words = $('filter').value.toLowerCase().split(/[\s,]+/).filter(Boolean)
    for (const [id, { row }] of rows) row.classList.toggle('hidden', words.length > 0 && !words.some(w => id.includes(w)))
    setParam('filter', $('filter').value.trim())
  }
  function setChosen () {
    const chosen = identifiers.filter(id => rows.get(id).box.checked)
    setParam('play', chosen.length === identifiers.length ? 'all' : chosen.map(short).join(','))
  }

  // ---- the grid of those played ----------------------------------------------------------------------------------

  // identifier -> { at, label, kind, emitter, next }
  const playing = new Map()
  let ground = null
  function layout () {
    const chosen = identifiers.filter(id => rows.get(id).box.checked)
    for (const [id, p] of playing) {
      if (chosen.includes(id)) continue
      p.emitter?.kill()
      scene.remove(p.label)
      playing.delete(id)
    }
    const columns = Math.max(1, Math.ceil(Math.sqrt(chosen.length)))
    const rowsCount = Math.ceil(chosen.length / columns)
    chosen.forEach((id, i) => {
      const at = new THREE.Vector3((i % columns - (columns - 1) / 2) * CELL, 1, (Math.floor(i / columns) - (rowsCount - 1) / 2) * CELL)
      let p = playing.get(id)
      if (!p) {
        p = { kind: kindOf(system.definition(id)), emitter: null, next: 0, label: label(short(id), { height: 0.4 }) }
        playing.set(id, p)
        scene.add(p.label)
      }
      if (!p.at || !p.at.equals(at)) {
        // (moved: played again where it is now)
        p.at = at
        p.emitter?.kill()
        p.emitter = null
        p.next = 0
      }
      p.label.position.set(at.x, 3.4, at.z)
      p.label.visible = $('names').checked
    })
    if (ground) scene.remove(ground)
    const size = Math.max(columns, rowsCount) * CELL + CELL
    ground = new THREE.GridHelper(size, size, 0x5a6a7a, 0x8aa0b0)
    scene.add(ground)
    viewFrom45(viewer, controls, new THREE.Vector3(0, 1, 0), Math.max(8, Math.max(columns, rowsCount) * CELL * 0.9))
    showInfo()
  }

  function showInfo () {
    const unsupported = Object.entries(system.unsupported()).map(([name, n]) => `${name} (${n})`)
    info.textContent = [
      `${version}: ${identifiers.length} particle effects, ${playing.size} played, ${system.count()} particles`,
      'runs: looping or endless, played on; once: played again every 3 seconds; emitted: of manual rate, the game emits ' +
        'their particles (given some here). Those of the game\'s atlases are drawn from a block of dirt and an apple.',
      unsupported.length ? `not run: ${unsupported.join(', ')}` : 'every component of them is run'
    ].join('\n')
  }

  // ---- every frame -----------------------------------------------------------------------------------------------

  let clock = 0
  let shown = 0
  function frame (dt) {
    if (!system) return
    clock += dt
    for (const [id, p] of playing) {
      if (p.kind === 'emitted') {
        if (clock >= p.next) {
          p.next = clock + EMIT_SECONDS
          system.emit(id, { x: p.at.x + (Math.random() - 0.5) * 0.5, y: p.at.y + Math.random() * 0.5, z: p.at.z + (Math.random() - 0.5) * 0.5 })
        }
        continue
      }
      // one that ended starts again; one that ends, every few seconds once it has made its particles (a burst at once,
      // or as many as it makes in its active time)
      const e = p.emitter
      const again = !e || e.done || (p.kind === 'once' && clock >= p.next && (e.expired || e.def.rate.kind === 'instant'))
      if (!again) continue
      e?.stop()
      p.emitter = system.spawn(id, { position: p.at })
      p.next = clock + REPLAY_SECONDS
    }
    system.update(dt, viewer.camera)
    shown += dt
    if (shown > 0.5) {
      shown = 0
      showInfo()
    }
  }

  // ---- the controls ----------------------------------------------------------------------------------------------

  $('filter').addEventListener('input', filter)
  $('playShown').addEventListener('click', () => {
    for (const id of shownIdentifiers()) rows.get(id).box.checked = true
    setChosen()
    layout()
  })
  $('none').addEventListener('click', () => {
    for (const { box } of rows.values()) box.checked = false
    setChosen()
    layout()
  })
  $('names').addEventListener('change', () => { for (const p of playing.values()) p.label.visible = $('names').checked })
  $('ground').addEventListener('change', () => { system.ground = $('ground').checked ? 0 : null })

  $('filter').value = params.get('filter') ?? ''
  filter()
  const asked = params.get('play') ?? 'shown'
  const play = asked === 'all' ? identifiers : asked === 'shown' ? (params.get('filter') ? shownIdentifiers() : []) : asked.split(',').map(n => n.includes(':') ? n : 'minecraft:' + n)
  for (const id of play) if (rows.has(id)) rows.get(id).box.checked = true
  layout()
  status.textContent = `${identifiers.length} effects`

  // ready once the textures of those played have loaded (or failed)
  for (let i = 0; i < 3; i++) frame(0.05)
  await Promise.allSettled([...assets.textures.values()].filter(Boolean).map(t => t.userData.ready))
  document.body.dataset.ready = 'true'
}

main()
