// A Bedrock version's entity assets on the page: entities/<file>.json under public/ (built by prerender.js in this
// folder) and the textures it names, which are files of the texture store (textures/bedrock/<sha1>.png), loaded the
// first time an entity draws with them. entities/index.json names each built version's file: versions whose assets
// came out the same share one.
//
//   const assets = await loadEntityAssets('bedrock_1.26.51')
//   if (assets.has('minecraft:cow')) scene.add(assets.create('minecraft:cow').object)
//   scene.add(assets.player(skin).object)
//   assets.items.bed                     // a dropped item's icon: { texture, variants (by the stack's aux value) }
//   assets.particles['minecraft:heart_particle']   // a particle effect (bedrock/particles draws them)
//   assets.textureUrl('items/bed_red')   // the store file of a texture the assets name
const { BedrockEntity } = require('./model')
const { skinOverrides } = require('./skin')
const { imageTexture, pixelTexture } = require('./textures')
const { loadJSON } = globalThis.isElectron ? require('../../utils.electron.js') : require('../../utils')
const { nearestBedrockVersion } = require('../../version')

const INDEX = 'entities/index.json'

class EntityAssets {
  constructor (data, base = '') {
    Object.assign(this, data)
    // (a file built before they were)
    this.particles = this.particles ?? {}
    this.base = base
    this.textures = new Map()
  }

  has (identifier) {
    return Object.hasOwn(this.entities, identifier)
  }

  create (identifier, overrides) {
    return new BedrockEntity(this, identifier, overrides)
  }

  // a player drawn with its own skin (skin.js), or the pack's Steve or Alex; model.ownSkin says which
  player (skin) {
    const { own, ...overrides } = skinOverrides(this, skin)
    const model = this.create('minecraft:player', overrides)
    model.ownSkin = own
    return model
  }

  // the URL of a texture by its path in the packs ('textures/entity/cow/cow_v2', 'items/bed_red'), null when the
  // version has no such file
  textureUrl (path) {
    const file = this.textureFiles?.[path]
    return file ? this.base + 'textures/' + file : null
  }

  // a texture by its path in the packs, null when the version has no such file; it carries userData.ready until its
  // image has loaded
  texture (path) {
    if (this.textures.has(path)) return this.textures.get(path)
    const url = this.textureUrl(path)
    const texture = url ? imageTexture(url) : null
    this.textures.set(path, texture)
    return texture
  }
}

const loadJson = url => new Promise(resolve => loadJSON(url, resolve, () => resolve(null)))

const indexes = new Map()
// the file of a version's entity assets ('bedrock_1.19.20' for bedrock_1.19.21, whose came out the same), null for a
// version not built
async function entityAssetFile (version, base = '') {
  if (!indexes.has(base)) indexes.set(base, loadJson(base + INDEX))
  const index = await indexes.get(base)
  if (!index) return null
  // a version built without entities of its own takes those of the nearest that has them, as its blocks do
  const nearest = nearestBedrockVersion(version, Object.keys(index))
  return nearest ? index[nearest] : null
}

const loading = new Map()
// a version's assets (shared), or null when it has none
function loadEntityAssets (version, base = '') {
  const key = base + '\n' + version
  if (!loading.has(key)) {
    loading.set(key, entityAssetFile(version, base).then(async file => {
      const data = file && await loadJson(`${base}entities/${file}.json`)
      return data ? new EntityAssets(data, base) : null
    }))
  }
  return loading.get(key)
}

module.exports = { loadEntityAssets, entityAssetFile, EntityAssets, imageTexture, pixelTexture, INDEX }
