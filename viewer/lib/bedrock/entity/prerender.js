// Builds the entity assets of a Bedrock version for the page (assets.js) from its minecraft-assets
// (require('minecraft-assets')('bedrock_<v>'): entities.json, items_textures.json, particles.json and the textures they
// name):
//   public/entities/<file>.json         the version's client entities, geometry, render controllers, animations,
//                                       animation controllers and materials; attachables: what an item worn or held
//                                       is drawn with (armour, a shield); items: each item's icon when dropped or
//                                       held ({ texture, variants }: the texture its stack's aux value picks);
//                                       particles: its particle effects by identifier, as the packs have them (the
//                                       entities' and the server's: bedrock/particles); textureFiles: each texture
//                                       they name (its path in the packs) -> its file in the store
//   public/entities/index.json          each built version -> its file: bedrock_<v>, or the one of a version whose
//                                       came out the same
//   public/textures/bedrock/<sha1>.png  the texture store, one file per content, shared by every version
//
// What the game draws by itself, entities.json lacks, and this fills in:
//  - before 1.17.10 the horses and the ender dragon have no render controllers, scripts or animations: they take those of
//    the nearest later version that has them, when every texture and geometry those name is the definition's too
//  - before 1.26.10 armour has no attachables (the game drew it in code): the newest version's stand in, where the
//    version has every texture they name
//  - boats are drawn by the client itself: the boat of viewer/lib/entity/entities.json (Java's, whose texture layout
//    Bedrock's boat textures keep) stands in, its hull on the floor; a chest boat is it with Java's chest, on its
//    texture of twice the height; a render controller picks the wood by the boat's variant
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const STORE = 'bedrock'

const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex')

function compareVersions (a, b) {
  const x = a.replace(/^bedrock_/, '').split('.').map(Number)
  const y = b.replace(/^bedrock_/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  }
  return 0
}

// ---- what the game draws by itself -------------------------------------------------------------------------------

// the references a render controller makes to a definition's textures and geometry
function references (rc) {
  const text = JSON.stringify(rc)
  const refs = { texture: new Set(), geometry: new Set() }
  for (const m of text.matchAll(/\b(texture|geometry)\.([a-z0-9_]+)/gi)) refs[m[1].toLowerCase()].add(m[2].toLowerCase())
  return refs
}

// later: the entities.json of each later version, nearest first (functions, so that only those needed are read). An
// entity the newest version has no render controllers for either is one the game draws itself (a bed, a boat, a
// skull): none is borrowed for it.
function borrowRenderControllers (data, later) {
  const borrowed = []
  const newest = later.length ? later[later.length - 1].entities() : null
  for (const [id, e] of Object.entries(data.entities)) {
    if (e.render_controllers || !newest?.entities[id]?.render_controllers) continue
    for (const { version, entities } of later) {
      const other = entities()
      const theirs = other?.entities[id]
      if (!theirs?.render_controllers) continue
      const names = theirs.render_controllers.map(rc => typeof rc === 'string' ? rc : Object.keys(rc)[0])
      const controllers = names.map(n => other.render_controllers[n])
      if (controllers.some(c => !c)) break
      const textures = new Set(Object.keys(e.textures ?? {}).map(k => k.toLowerCase()))
      const geometry = new Set(Object.keys(e.geometry ?? {}).map(k => k.toLowerCase()))
      const fits = controllers.every(c => {
        const refs = references(c)
        return [...refs.texture].every(t => textures.has(t)) && [...refs.geometry].every(g => geometry.has(g))
      })
      if (!fits) break
      e.render_controllers = theirs.render_controllers
      names.forEach((n, i) => { data.render_controllers[n] ??= controllers[i] })
      // their scripts set the variables those controllers read, and run the animations that pose it: the game drew
      // these itself, with none of its own (an empty {} is none)
      const none = v => !v || !Object.keys(v).length
      if (theirs.scripts && none(e.scripts)) e.scripts = theirs.scripts
      if (theirs.animations && none(e.animations)) {
        e.animations = theirs.animations
        if (theirs.animation_controllers && none(e.animation_controllers)) e.animation_controllers = theirs.animation_controllers
        const pending = [...Object.values(theirs.animations), ...(theirs.animation_controllers ?? []).flatMap(c => Object.values(c))]
        for (const ref of pending) {
          if (other.animations?.[ref]) data.animations[ref] ??= other.animations[ref]
          if (other.animation_controllers?.[ref]) data.animation_controllers[ref] ??= other.animation_controllers[ref]
        }
      }
      borrowed.push(`${id.replace('minecraft:', '')} (from ${version})`)
      break
    }
  }
  return borrowed
}

// The attachables of the newest version that the version lacks, where it has their default texture: before 1.26.10
// the game drew armour in code, with the same textures. Of their other textures (a baby's, the enchantment glint), those
// the version has; with them the geometries, render controllers, animations and materials they name that it lacks.
function borrowAttachables (data, later, hasTexture) {
  const newest = later.length ? later[later.length - 1] : null
  const other = newest?.entities()
  const borrowed = []
  for (const [id, theirs] of Object.entries(other?.attachables ?? {})) {
    if (data.attachables[id] || typeof theirs.textures?.default !== 'string' || !hasTexture(theirs.textures.default)) continue
    const textures = Object.fromEntries(Object.entries(theirs.textures)
      .filter(([, t]) => typeof t !== 'string' || t.startsWith('atlas.') || hasTexture(t)))
    const attachable = { ...theirs, textures }
    const take = (table, names) => {
      for (const name of names) if (!data[table][name] && other[table]?.[name]) data[table][name] = other[table][name]
    }
    take('geometry', Object.values(attachable.geometry ?? {}))
    take('render_controllers', (attachable.render_controllers ?? []).map(rc => typeof rc === 'string' ? rc : Object.keys(rc)[0]))
    take('animations', Object.values(attachable.animations ?? {}))
    take('animation_controllers', Object.values(attachable.animations ?? {}))
    take('materials', Object.values(attachable.materials ?? {}))
    data.attachables[id] = attachable
    borrowed.push(id.replace('minecraft:', ''))
  }
  return borrowed.length ? [`${borrowed.length} attachables (from ${newest.version})`] : []
}

// a 1.8 geometry as the export normalizes it
function normalizeLegacy (geo) {
  return {
    texture_width: geo.texturewidth ?? 64,
    texture_height: geo.textureheight ?? 64,
    bones: geo.bones.map(b => {
      const bone = { name: b.name, pivot: b.pivot ?? [0, 0, 0] }
      if (b.parent) bone.parent = b.parent
      if (b.rotation) bone.rotation = b.rotation
      if (b.bind_pose_rotation) bone.bind = b.bind_pose_rotation
      if (b.mirror !== undefined) bone.mirror = b.mirror
      if (b.cubes) bone.cubes = b.cubes
      return bone
    })
  }
}

// the hull's floor is 18 px up in the Java model
const BOAT_FLOOR = 18

function boatGeometry () {
  const boat = normalizeLegacy(require('../../entity/entities.json').boat.geometry.default)
  for (const bone of boat.bones) {
    bone.pivot = [bone.pivot[0], bone.pivot[1] - BOAT_FLOOR, bone.pivot[2]]
    // copies: the cubes are the cached model's
    bone.cubes = bone.cubes?.map(cube => ({ ...cube, origin: [cube.origin[0], cube.origin[1] - BOAT_FLOOR, cube.origin[2]] }))
  }
  return boat
}

// Java's ChestBoatModel chest, as its boat bones are converted: (x, 24 - y, z), its parts turned a quarter
function chestBoatGeometry (boat) {
  const part = (name, pivot, origin, size, uv) => ({ name, pivot: [pivot[0], 24 - pivot[1] - BOAT_FLOOR, pivot[2]], rotation: [0, -90, 0], cubes: [{ origin: [pivot[0] + origin[0], 24 - (pivot[1] + origin[1] + size[1]) - BOAT_FLOOR, pivot[2] + origin[2]], size, uv }] })
  return {
    ...boat,
    texture_height: boat.texture_height * 2,
    bones: [
      ...boat.bones,
      part('chest_bottom', [-2, -5, -6], [0, 0, 0], [12, 8, 12], [0, 76]),
      part('chest_lid', [-2, -9, -6], [0, 0, 0], [12, 4, 12], [0, 59]),
      part('chest_lock', [-1, -6, -1], [0, 0, 0], [2, 4, 1], [0, 59])
    ]
  }
}

// a boat's variant: its wood, in the order the game numbers them
const BOAT_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'darkoak', 'mangrove', 'bamboo', 'cherry', 'paleoak', 'poplar']

function boatRenderController (entity) {
  const woods = BOAT_WOODS.filter(wood => entity.textures?.[wood])
  return {
    arrays: { textures: { 'Array.woods': woods.map(wood => 'Texture.' + wood) } },
    geometry: 'Geometry.default',
    materials: [{ '*': 'Material.default' }],
    textures: ['Array.woods[query.variant]']
  }
}

function addBoats (data) {
  const boat = boatGeometry()
  data.geometry['geometry.boat'] ??= boat
  data.geometry['geometry.chest_boat'] ??= chestBoatGeometry(boat)
  for (const id of ['minecraft:boat', 'minecraft:chest_boat']) {
    const entity = data.entities[id]
    if (!entity || entity.render_controllers) continue
    const name = 'controller.render.' + id.replace('minecraft:', '') + '.wood'
    data.render_controllers[name] = boatRenderController(entity)
    entity.render_controllers = [name]
  }
}

// ---- textures ----------------------------------------------------------------------------------------------------

// a player whose skin cannot be drawn is Steve, or Alex with slim arms (skin.js)
const PLAYER_TEXTURES = ['textures/entity/steve', 'textures/entity/alex']

// the file of a texture by its path in the packs ('textures/entity/cow/cow_v2', or as items_textures.json names them:
// 'items/bed_red', 'blocks/wool_colored_red'), wherever minecraft-assets keeps the version's top-level folder of it (or
// the file itself, of one at the top: 'textures/flame_atlas')
function textureSource (assets, texture) {
  const [entry, ...rest] = texture.replace(/^textures\//, '').split('/')
  if (!entry) return null
  const file = rest.length ? path.join(assets.pathOf(entry), ...rest) + '.png' : assets.pathOf(entry + '.png')
  return fs.existsSync(file) ? file : null
}

// ---- particles ---------------------------------------------------------------------------------------------------

// The version's particle effects: particles.json of its minecraft-assets ({ particles: { identifier: effect as the
// packs have it }, files, missing }), {} for a version without
function particleEffects (assets) {
  let exported = assets.particles
  if (exported === undefined && assets.pathOf) {
    // (a minecraft-assets that does not read it yet)
    const file = assets.pathOf('particles.json')
    exported = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  }
  return JSON.parse(JSON.stringify(exported?.particles ?? {}))
}

// the textures an effect is drawn with: its texture, unless it is one of the atlases the game builds as it runs
// (atlas.terrain, atlas.items: the particles of blocks and items)
function particleTextures (effect) {
  const texture = (effect.particle_effect ?? effect).description?.basic_render_parameters?.texture
  return typeof texture === 'string' && !texture.startsWith('atlas.') ? [texture] : []
}

// ---- a version ---------------------------------------------------------------------------------------------------

/**
 * A version's entity assets, as the page loads them, and the texture files they name.
 * assets: the version's minecraft-assets (entities, itemsArray, pathOf); later: the entities.json of the later
 * versions, nearest first ([{ version, entities: () => entities.json }]), to borrow the render controllers the
 * version lacks from.
 * -> { data, textures: store file -> its source, missing: textures not found, borrowed }
 */
function entityAssets (assets, { later = [] } = {}) {
  const exported = assets.entities
  const data = exported
    ? JSON.parse(JSON.stringify({
      entities: exported.entities ?? {},
      geometry: exported.geometry ?? {},
      render_controllers: exported.render_controllers ?? {},
      animations: exported.animations ?? {},
      animation_controllers: exported.animation_controllers ?? {},
      materials: exported.materials ?? {},
      attachables: exported.attachables ?? {}
    }))
    : { entities: {}, geometry: {}, render_controllers: {}, animations: {}, animation_controllers: {}, materials: {}, attachables: {} }
  const borrowed = [...borrowRenderControllers(data, later), ...borrowAttachables(data, later, p => !!textureSource(assets, p))]
  addBoats(data)

  // items' icons (dropped items, the items page): what items_textures.json says of each, but its source (see
  // bedrock/itemIcon.js); an item with no icon is kept, empty, so that it is known to have none
  data.items = {}
  for (const entry of assets.itemsArray ?? []) {
    const item = {}
    for (const key of ['texture', 'overlay', 'tint', 'variants', 'auxIcons']) if (entry[key]) item[key] = entry[key]
    data.items[entry.name] = item
  }

  const paths = new Set(PLAYER_TEXTURES)
  // (not atlas.*: atlases the game builds as it runs, such as a shield's banner patterns, which are not drawn)
  for (const e of [...Object.values(data.entities), ...Object.values(data.attachables)]) {
    for (const p of Object.values(e.textures ?? {})) if (typeof p === 'string' && !p.startsWith('atlas.')) paths.add(p)
  }
  for (const item of Object.values(data.items)) {
    const icons = [item, ...Object.values(item.auxIcons ?? {})]
    for (const p of [...icons.flatMap(icon => [icon.texture, icon.overlay]), ...Object.values(item.variants ?? {})]) if (typeof p === 'string') paths.add(p)
  }

  data.particles = particleEffects(assets)
  for (const effect of Object.values(data.particles)) for (const p of particleTextures(effect)) paths.add(p)

  data.textureFiles = {}
  const textures = new Map()
  const missing = []
  for (const p of [...paths].sort()) {
    const source = textureSource(assets, p)
    if (!source) {
      missing.push(p)
      continue
    }
    const file = `${STORE}/${sha1(fs.readFileSync(source)).slice(0, 16)}.png`
    data.textureFiles[p] = file
    textures.set(file, source)
  }
  return { data, textures, missing, borrowed }
}

// ---- the files ---------------------------------------------------------------------------------------------------

const hashes = new Map() // file -> sha1 of its content, of the files read or written in this process

function contentHash (file) {
  if (!hashes.has(file)) hashes.set(file, fs.existsSync(file) ? sha1(fs.readFileSync(file)) : null)
  return hashes.get(file)
}

function readIndex (publicPath) {
  const file = path.join(publicPath, 'entities', 'index.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
}

/**
 * Writes a version's entity assets (entityAssets()) into publicPath: its textures into the store, its file, unless a
 * version already has one that came out the same, and its entry of the index. -> the file it uses (bedrock_<v>)
 */
function writeEntityAssets (publicPath, version, { data, textures }) {
  const dir = path.join(publicPath, 'entities')
  const store = path.join(publicPath, 'textures', STORE)
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(store, { recursive: true })
  for (const [file, source] of textures) {
    const target = path.join(publicPath, 'textures', file)
    if (!fs.existsSync(target)) fs.copyFileSync(source, target)
  }

  const fileOf = name => path.join(dir, name + '.json')
  const index = readIndex(publicPath)
  const json = JSON.stringify(data)
  const hash = sha1(json)
  let file = [...new Set(Object.values(index))].sort(compareVersions).find(name => contentHash(fileOf(name)) === hash)
  if (!file) {
    file = version
    // the versions that share the file this version had keep what it holds, under the first of their names
    const sharing = Object.keys(index).filter(v => v !== version && index[v] === version).sort(compareVersions)
    if (sharing.length && contentHash(fileOf(version))) {
      fs.renameSync(fileOf(version), fileOf(sharing[0]))
      hashes.set(fileOf(sharing[0]), hashes.get(fileOf(version)))
      for (const v of sharing) index[v] = sharing[0]
    }
    fs.writeFileSync(fileOf(version), json)
    hashes.set(fileOf(version), hash)
  }
  const before = index[version]
  index[version] = file
  // the file it had, when no version names it any more
  if (before && before !== file && !Object.values(index).includes(before)) {
    fs.rmSync(fileOf(before), { force: true })
    hashes.delete(fileOf(before))
  }
  const sorted = Object.fromEntries(Object.keys(index).sort(compareVersions).map(v => [v, index[v]]))
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(sorted, null, 2) + '\n')
  return file
}

// Removes the store's textures that no version's file names any more
function pruneTextureStore (publicPath) {
  const store = path.join(publicPath, 'textures', STORE)
  if (!fs.existsSync(store)) return 0
  const named = new Set()
  for (const file of new Set(Object.values(readIndex(publicPath)))) {
    const p = path.join(publicPath, 'entities', file + '.json')
    if (!fs.existsSync(p)) continue
    for (const texture of Object.values(JSON.parse(fs.readFileSync(p, 'utf8')).textureFiles ?? {})) named.add(path.basename(texture))
  }
  let removed = 0
  for (const f of fs.readdirSync(store)) {
    if (named.has(f)) continue
    fs.rmSync(path.join(store, f))
    removed++
  }
  return removed
}

module.exports = { entityAssets, writeEntityAssets, pruneTextureStore, readIndex, textureSource, compareVersions, STORE }
