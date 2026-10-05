/* global document, window, THREE, fetch */
// The block states of a Bedrock version, a page of them at a time, each in its own cell of a grid, leaning 45° towards
// the camera and spinning so that every face of it shows in one turn; the states shown filtered by the words of their
// block's name and by state=value. And elsewhere in the same scene, in one strip per biome: still and flowing water,
// lava, grass, leaves and the other blocks a biome tints, each as its biome tints it.
//
// The grid's blocks are meshed here, one by one, by the viewer's mesher (models.js) out of a world of one block; the
// biome strips are a world the viewer draws as it draws any.
const { Vec3 } = require('vec3')
const { preload } = require('../../../viewer/lib/mcData')
const { World } = require('../../../viewer/lib/world')
const { getSectionGeometry } = require('../../../viewer/lib/models')
const { bedrockVersions, versionSelect, createViewer, viewFrom45, viewFromFront, label } = require('./common')

// the grid: this many cells to a row, this far apart, its top left cell here, away from the biome strips
const COLUMNS = 8
const CELL = 2.4
const ROW = CELL * 1.45
const GRID_LEFT = 400
const GRID_TOP = 140
// where the block meshed for the grid stands in its world: the middle of a section
const MESH_AT = new Vec3(8, 72, 8)
// the biome strips: chunks at z < 0, this many to a row, at this height
const BIOME_CHUNK_Z = -2
const BIOMES_PER_ROW = 4
const Y = 64

// the biomes the strips show, of those the version has
const BIOMES = ['plains', 'swampland', 'jungle', 'desert', 'savanna', 'cold_taiga', 'birch_forest', 'roofed_forest',
  'mesa', 'mushroom_island', 'mangrove_swamp', 'cherry_grove', 'warm_ocean', 'frozen_ocean']

const element = id => document.getElementById(id)
const view = element('view')
const info = element('info')
const status = element('status')
const ui = {
  version: element('version'),
  filter: element('filter'),
  show: element('show'),
  pageSize: element('pageSize'),
  prev: element('prev'),
  next: element('next'),
  page: element('page'),
  biome: element('biome'),
  spin: element('spin'),
  tilt: element('tilt'),
  toGrid: element('toGrid'),
  toBiomes: element('toBiomes')
}

const grid = new THREE.Group()
const biomeLabels = new THREE.Group()
// the spinning part of every cell
let spinners = []
const { viewer, controls: orbit, renderer } = createViewer(view, dt => {
  if (!ui.spin.checked) return
  for (const spinner of spinners) spinner.rotation.y += dt * 0.8
})
viewer.scene.add(grid)
viewer.scene.add(biomeLabels)

// what the page has of the version shown: { version, registry, Chunk, states, find, blocksStates, world, air }
let current = null
let matching = [] // the states the filter lets through
let page = 0
let gridCenter = new Vec3(GRID_LEFT, GRID_TOP, 0)
let gridDistance = 20
let biomesCenter = null
let biomesDistance = 20

// ---- states ------------------------------------------------------------------------------------------------------

// The states of a version: { id (its index: the page uses index ids), name, props }, and a finder of the first state
// of the first candidate the version has: [name, props]...
function statesOf (registry) {
  const states = registry.blockStates.map((s, id) => {
    const props = {}
    for (const [k, v] of Object.entries(s.states ?? {})) props[k] = String(v.value)
    return { id, name: s.name, props }
  })
  const byName = new Map()
  for (const s of states) {
    if (!byName.has(s.name)) byName.set(s.name, [])
    byName.get(s.name).push(s)
  }
  const find = (...candidates) => {
    for (const [name, props = {}] of candidates) {
      const match = byName.get(name)?.find(s => Object.entries(props).every(([k, v]) => s.props[k] === String(v)))
      if (match) return match
    }
    return null
  }
  return { states, find }
}

const describe = s => s.name + Object.entries(s.props).map(([k, v]) => `\n  ${k}=${v}`).join('') + `\nstate ${s.id}`

// The filter: words of the block's name, and state=value terms, every one of which a state must match. A part of a
// state's name will do ('cardinal=east' is minecraft:cardinal_direction=east), and no value any value ('corner=').
function filterOf (text) {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean).map(term => {
    const i = term.indexOf('=')
    return i === -1 ? { name: term } : { key: term.slice(0, i), value: term.slice(i + 1) }
  })
  return s => terms.every(term => term.name !== undefined
    ? s.name.includes(term.name)
    : Object.entries(s.props).some(([k, v]) => k.includes(term.key) && (term.value === '' || v === term.value)))
}

function updateMatching () {
  const { registry, states } = current
  const pass = filterOf(ui.filter.value)
  matching = states.filter(s => s.name !== 'air' && pass(s))
  if (ui.show.value === 'blocks') {
    // each block's default state, else its first that matches
    const defaults = new Set(registry.blocksArray.map(b => b.defaultState))
    const first = new Map()
    for (const s of matching) {
      const kept = first.get(s.name)
      if (!kept || (!defaults.has(kept.id) && defaults.has(s.id))) first.set(s.name, s)
    }
    matching = [...first.values()]
  }
  page = 0
}

// ---- the grid ----------------------------------------------------------------------------------------------------

// The mesh of one block state, centred on the origin: the viewer's mesher drawing the section it stands alone in,
// tinted as in the biome chosen
function blockMesh (state) {
  const { world, blocksStates } = current
  world.setBlockStateId(MESH_AT, state.id)
  const geometry = getSectionGeometry(0, MESH_AT.y & ~15, 0, world, blocksStates)
  world.setBlockStateId(MESH_AT, current.air)
  const buffer = new THREE.BufferGeometry()
  buffer.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3))
  buffer.setAttribute('normal', new THREE.BufferAttribute(geometry.normals, 3))
  buffer.setAttribute('color', new THREE.BufferAttribute(geometry.colors, 3))
  buffer.setAttribute('uv', new THREE.BufferAttribute(geometry.uvs, 2))
  buffer.setAttribute('animation', new THREE.BufferAttribute(geometry.animations, 3))
  buffer.setIndex(new THREE.BufferAttribute(geometry.indices, 1))
  // (section-local positions are centred on the section: the block's corner is at its offset in it - 8)
  buffer.translate(7.5 - (MESH_AT.x & 15), 7.5 - (MESH_AT.y & 15), 7.5 - (MESH_AT.z & 15))
  buffer.computeBoundingSphere()
  // the world renderer's material: the version's atlas, its animated textures
  return new THREE.Mesh(buffer, viewer.world.material)
}

function clearGrid () {
  for (const child of [...grid.children]) {
    grid.remove(child)
    child.traverse(o => {
      if (o.isSprite) {
        o.material.map.dispose()
        o.material.dispose()
      } else if (o.geometry) {
        o.geometry.dispose()
      }
    })
  }
  spinners = []
}

function showPage () {
  clearGrid()
  const size = Number(ui.pageSize.value)
  const pages = Math.max(1, Math.ceil(matching.length / size))
  page = Math.min(Math.max(page, 0), pages - 1)
  ui.page.textContent = `page ${page + 1} / ${pages}`
  ui.prev.disabled = page === 0
  ui.next.disabled = page >= pages - 1
  const shown = matching.slice(page * size, (page + 1) * size)
  const tilt = Number(ui.tilt.value) * Math.PI / 180
  shown.forEach((state, i) => {
    // cell: its place in the grid; spinner: turns about the vertical; tilter: leans the block towards the camera
    const cell = new THREE.Group()
    cell.position.set(GRID_LEFT + (i % COLUMNS) * CELL, GRID_TOP - Math.floor(i / COLUMNS) * ROW, 0)
    const spinner = new THREE.Group()
    const tilter = new THREE.Group()
    tilter.rotation.x = tilt
    const mesh = blockMesh(state)
    mesh.userData.description = describe(state)
    tilter.add(mesh)
    spinner.add(tilter)
    spinner.rotation.y = i * 0.35
    cell.add(spinner)
    const props = Object.entries(state.props)
    // its name and states, one to a line, under it
    const text = [state.name, ...props.map(([k, v]) => `${k.replace('minecraft:', '')}=${v}`)].join('\n')
    const sprite = label(text, { height: 0.19 })
    sprite.center.set(0.5, 1)
    sprite.position.set(0, -0.95, 0)
    cell.add(sprite)
    grid.add(cell)
    spinners.push(spinner)
  })
  const across = Math.min(shown.length, COLUMNS)
  const rows = Math.ceil(shown.length / COLUMNS)
  gridCenter = new Vec3(GRID_LEFT + (across - 1) * CELL / 2, GRID_TOP - (rows - 1) * ROW / 2 - 0.4, 0)
  gridDistance = Math.max(5, across * CELL * 0.7, rows * ROW * 0.85)
  status.textContent = `${current.version}: ${matching.length} ${ui.show.value === 'blocks' ? 'blocks' : 'states'}` +
    `${ui.filter.value.trim() ? ` match "${ui.filter.value.trim()}"` : ''}`
}

// ---- the biome strips --------------------------------------------------------------------------------------------

// A world of Bedrock columns, built here: place(x, y, z, stateId, layer), biome(x, y, z, id)
function columnsOf (Chunk) {
  const columns = new Map()
  const at = (x, z) => {
    const key = `${Math.floor(x / 16)},${Math.floor(z / 16)}`
    if (!columns.has(key)) columns.set(key, new Chunk({ x: Math.floor(x / 16), z: Math.floor(z / 16) }))
    return columns.get(key)
  }
  const local = (x, y, z) => new Vec3(((x % 16) + 16) % 16, y, ((z % 16) + 16) % 16)
  return {
    columns,
    place (x, y, z, stateId, layer = 0) {
      const pos = local(x, y, z)
      pos.l = layer
      at(x, z).setBlockStateId(pos, stateId)
    },
    biome (x, y, z, id) {
      at(x, z).setBiomeId(local(x, y, z), id)
    }
  }
}

// what the biome strips have under the pointer: 'x,y,z' -> description
let stripBlocks = new Map()

// One strip per biome, in a chunk of its own: a pool of water with a lily pad, seagrass and kelp, water flowing away
// from it down a slope, lava, grass with plants on it, every kind of leaves, vines, sugar cane
function biomeStrip (world, find, chunkX, chunkZ, biome) {
  const x0 = chunkX * 16
  const z0 = chunkZ * 16
  const put = (x, y, z, state, layer) => {
    if (!state) return
    world.place(x0 + x, y, z0 + z, state.id, layer)
    stripBlocks.set(`${x0 + x},${y},${z0 + z}`, `${describe(state)}${layer ? ' (in the liquid layer)' : ''}\nbiome ${biome.name}`)
  }
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = Y - 2; y < Y + 4; y++) world.biome(x0 + x, y, z0 + z, biome.id)
    }
  }
  const stone = find(['stone'])
  const water = find(['water', { liquid_depth: 0 }])
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) put(x, Y - 2, z, stone)
  for (let x = 1; x <= 4; x++) {
    for (let z = 1; z <= 4; z++) {
      put(x, Y - 1, z, stone)
      put(x, Y, z, water)
    }
  }
  put(2, Y + 1, 2, find(['waterlily']))
  put(3, Y, 3, find(['seagrass']))
  put(3, Y, 3, water, 1)
  put(4, Y, 4, find(['kelp', { kelp_age: 5 }], ['kelp']))
  put(4, Y, 4, water, 1)
  for (let depth = 1; depth <= 7; depth++) {
    for (const z of [2, 3]) put(4 + depth, Y - 1, z, find(['flowing_water', { liquid_depth: depth }], ['water', { liquid_depth: depth }]))
  }
  put(13, Y - 1, 2, find(['lava', { liquid_depth: 0 }]))
  put(14, Y - 1, 2, find(['flowing_lava', { liquid_depth: 2 }], ['lava', { liquid_depth: 2 }]))
  const grass = find(['grass_block'], ['grass'])
  const plants = [find(['short_grass'], ['tallgrass', { tall_grass_type: 'tall' }]), find(['fern'], ['tallgrass', { tall_grass_type: 'fern' }]),
    find(['poppy'], ['red_flower']), find(['sugar_cane'], ['reeds'])]
  plants.forEach((plant, i) => {
    put(1 + i * 2, Y - 1, 7, grass)
    put(1 + i * 2, Y, 7, plant)
  })
  const leaves = [
    find(['oak_leaves'], ['leaves', { old_leaf_type: 'oak' }]),
    find(['spruce_leaves'], ['leaves', { old_leaf_type: 'spruce' }]),
    find(['birch_leaves'], ['leaves', { old_leaf_type: 'birch' }]),
    find(['jungle_leaves'], ['leaves', { old_leaf_type: 'jungle' }]),
    find(['acacia_leaves'], ['leaves2', { new_leaf_type: 'acacia' }]),
    find(['dark_oak_leaves'], ['leaves2', { new_leaf_type: 'dark_oak' }]),
    find(['mangrove_leaves']), find(['cherry_leaves']), find(['azalea_leaves']), find(['pale_oak_leaves'])
  ].filter(Boolean)
  leaves.forEach((leaf, i) => put(1 + i, Y - 1, 10, leaf))
  for (let x = 1; x <= 3; x++) {
    for (let y = Y - 1; y <= Y + 1; y++) {
      put(x, y, 13, stone)
      put(x, y, 12, find(['vine', { vine_direction_bits: 1 }], ['vine']))
    }
  }
  const sprite = label(biome.name, { height: 1.6 })
  sprite.position.set(x0 + 8, Y + 4, z0 + 8)
  biomeLabels.add(sprite)
}

function showBiomes () {
  const { registry, Chunk, find } = current
  stripBlocks = new Map()
  for (const sprite of [...biomeLabels.children]) {
    biomeLabels.remove(sprite)
    sprite.material.map.dispose()
    sprite.material.dispose()
  }
  const world = columnsOf(Chunk)
  const biomes = BIOMES.map(name => registry.biomesByName[name]).filter(Boolean)
  biomes.forEach((biome, i) => biomeStrip(world, find, i % BIOMES_PER_ROW, BIOME_CHUNK_Z - Math.floor(i / BIOMES_PER_ROW), biome))
  for (const column of world.columns.values()) viewer.addColumn(column.x * 16, column.z * 16, column.toJson())
  const rows = Math.ceil(biomes.length / BIOMES_PER_ROW)
  biomesCenter = new Vec3(Math.min(biomes.length, BIOMES_PER_ROW) * 8, Y, (BIOME_CHUNK_Z + 1 - rows / 2) * 16)
  biomesDistance = Math.max(20, Math.max(BIOMES_PER_ROW, rows) * 11)
}

// ---- versions ----------------------------------------------------------------------------------------------------

let versions = []

async function loadVersion () {
  const version = ui.version.value
  status.textContent = `${version}: loading...`
  info.textContent = ''
  clearGrid()
  // minecraft-data of the version, fetched for the page as the viewer's worker fetches it
  await preload(version)
  const registry = require('prismarine-registry')(version)
  const Chunk = require('prismarine-chunk')(registry)
  const { states, find } = statesOf(registry)
  if (!viewer.setVersion(version, { blockHashes: false })) {
    status.textContent = `${version} is not supported`
    return
  }
  // the version's blocksStates, as the viewer's workers have them: its own, or those of the version it is drawn with
  const files = versions.find(v => v.version === version)?.files ?? version
  const blocksStates = await fetch(`blocksStates/${files}.json`).then(r => r.json())
  // the world the grid's blocks are meshed in, one at a time: a column of air
  const world = new World(version, { blockHashes: false })
  world.setRender(blocksStates.__bedrock?.blocks)
  world.addColumn(0, 0, new Chunk({ x: 0, z: 0 }).toJson())
  current = { version, registry, Chunk, states, find, blocksStates, world, air: registry.blocksByName.air.defaultState }

  // the biomes the grid can be tinted as
  const chosen = ui.biome.value
  ui.biome.textContent = ''
  for (const biome of registry.biomesArray.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const option = document.createElement('option')
    option.value = biome.id
    option.textContent = biome.name
    ui.biome.appendChild(option)
  }
  ui.biome.value = registry.biomesArray.some(b => String(b.id) === chosen) ? chosen : String(registry.biomesByName.plains?.id ?? registry.biomesArray[0].id)
  setBiome()

  showBiomes()
  updateMatching()
  showPage()
  viewFromFront(viewer, orbit, gridCenter, gridDistance)
}

// the biome the grid's blocks are tinted as
function setBiome () {
  current.world.getColumn(0, 0).setBiomeId(MESH_AT, Number(ui.biome.value))
}

// ---- the page ----------------------------------------------------------------------------------------------------

// what is under the pointer: a block of the grid, or of a biome strip
const raycaster = new THREE.Raycaster()
view.addEventListener('pointermove', event => {
  const rect = renderer.domElement.getBoundingClientRect()
  const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, viewer.camera)
  const meshes = []
  grid.traverse(o => { if (o.isMesh) meshes.push(o) })
  const hit = raycaster.intersectObjects([...meshes, ...Object.values(viewer.world.sectionMeshs)], false)[0]
  if (!hit) {
    info.textContent = ''
    return
  }
  if (hit.object.userData.description) {
    info.textContent = hit.object.userData.description
    return
  }
  const p = hit.point.clone().addScaledVector(hit.face.normal, -0.01)
  info.textContent = stripBlocks.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`) ?? ''
})

// one change at a time, in the order they were made
let queue = Promise.resolve()
const run = fn => { queue = queue.then(fn).catch(err => { status.textContent = String(err?.stack ?? err) }) }

ui.version.addEventListener('change', () => {
  const url = new URL(window.location.href)
  url.searchParams.set('version', ui.version.value)
  window.history.replaceState(null, '', url)
  run(loadVersion)
})
let typing = null
ui.filter.addEventListener('input', () => {
  clearTimeout(typing)
  typing = setTimeout(() => run(() => { updateMatching(); showPage(); viewFromFront(viewer, orbit, gridCenter, gridDistance) }), 300)
})
ui.show.addEventListener('change', () => run(() => { updateMatching(); showPage() }))
ui.pageSize.addEventListener('change', () => run(() => { page = 0; showPage(); viewFromFront(viewer, orbit, gridCenter, gridDistance) }))
ui.prev.addEventListener('click', () => run(() => { page--; showPage() }))
ui.next.addEventListener('click', () => run(() => { page++; showPage() }))
ui.biome.addEventListener('change', () => run(() => { setBiome(); showPage() }))
ui.tilt.addEventListener('change', () => run(showPage))
ui.toGrid.addEventListener('click', () => viewFromFront(viewer, orbit, gridCenter, gridDistance))
ui.toBiomes.addEventListener('click', () => { if (biomesCenter) viewFrom45(viewer, orbit, biomesCenter, biomesDistance) })

async function main () {
  versions = await bedrockVersions()
  versionSelect(ui.version, versions)
  run(loadVersion)
}

main()
