const path = require('path')
const { makeTextureAtlas } = require('./lib/atlas')
const { prepareBlocksStates } = require('./lib/modelsBuilder')
const mcAssets = require('minecraft-assets')
const Chunks = require('prismarine-chunk')
const fs = require('fs-extra')

const { supportedVersions, bedrockSupportedVersions } = require('./lib/version')
const { entityAssets, writeEntityAssets, pruneTextureStore, readIndex, compareVersions } = require('./lib/bedrock/entity/prerender')

// Bedrock versions are built where minecraft-assets has their assets
const bedrockWithAssets = new Set((mcAssets.bedrockVersions ?? []).map(v => 'bedrock_' + v))
const versions = [...supportedVersions, ...bedrockSupportedVersions.filter(v => bedrockWithAssets.has(v))]

// World bounds come from prismarine-chunk, which is a build-time dependency here.
// Emitting them lets the browser fetch the answer instead of bundling
// prismarine-chunk (and all of minecraft-data behind it) into index.js.
const publicPath = path.resolve(__dirname, '../public')
fs.mkdirSync(publicPath, { recursive: true })
fs.writeFileSync(path.resolve(publicPath, 'worldBounds.json'), JSON.stringify(
  Object.fromEntries(versions.map(version => {
    const chunk = new (Chunks(version))({})
    return [version, { minY: chunk.minY ?? 0, worldHeight: chunk.worldHeight ?? 256 }]
  }))
))

const texturesPath = path.resolve(__dirname, '../public/textures')
const blockStatesPath = path.resolve(__dirname, '../public/blocksStates')
fs.mkdirSync(texturesPath, { recursive: true })
fs.mkdirSync(blockStatesPath, { recursive: true })

// Bedrock: the version's client entities, item icons and particle effects for its entity runtime
// (lib/bedrock/entity/prerender.js), with the render controllers and attachables it lacks borrowed from a later
// version's. Its items' textures are named as the runtime names them (items/apple, blocks/stone).
function bedrockEntities (version, assets) {
  const bare = version.slice('bedrock_'.length)
  const later = (mcAssets.bedrockVersions ?? []).filter(v => compareVersions(v, bare) > 0).sort(compareVersions)
    .map(v => ({ version: 'bedrock_' + v, entities: () => mcAssets('bedrock_' + v)?.entities }))
  const view = Object.create(assets)
  view.itemsArray = (assets.itemsArray ?? []).map(item => ({ ...item, texture: item.texture && item.texture.replace(/^minecraft:/, '').replace(/^block\//, 'blocks/') }))
  const result = entityAssets(view, { later })
  const file = writeEntityAssets(publicPath, version, result)
  const { data, missing, borrowed } = result
  console.log(`Generated entities/${file}.json for ${version}: ${Object.keys(data.entities).length} entities, ` +
    `${Object.keys(data.items).length} items, ${Object.keys(data.particles).length} particle effects, ` +
    `${Object.keys(data.textureFiles).length} textures` +
    `${missing.length ? `, ${missing.length} not found (${missing.slice(0, 4).join(' ')})` : ''}` +
    `${borrowed.length ? `, borrowed: ${borrowed.join(' ')}` : ''}`)
}

let bedrockBuilt = false
for (const version of versions) {
  const atlasFile = path.resolve(texturesPath, version + '.png')
  const blockStatesFile = path.resolve(blockStatesPath, version + '.json')
  const entityFile = version.startsWith('bedrock_') && readIndex(publicPath)[version]
  const entitiesBuilt = !version.startsWith('bedrock_') || (entityFile && fs.existsSync(path.resolve(publicPath, 'entities', entityFile + '.json')))
  if (fs.existsSync(atlasFile) && fs.existsSync(blockStatesFile) && entitiesBuilt && !process.argv.includes('-f')) {
    console.log(version + ' already built, skipping...')
    continue
  }
  const assets = mcAssets(version)
  const atlas = makeTextureAtlas(assets)
  fs.writeFileSync(atlasFile, atlas.canvas.toBuffer('image/png'))
  console.log('Generated textures/' + version + '.png')

  const blocksStates = JSON.stringify(prepareBlocksStates(assets, atlas))
  fs.writeFileSync(blockStatesFile, blocksStates)

  fs.copySync(assets.directory, path.resolve(texturesPath, version), { overwrite: true })

  if (version.startsWith('bedrock_')) {
    bedrockEntities(version, assets)
    bedrockBuilt = true
  }
}

// (the texture store's files no version names any more)
if (bedrockBuilt) {
  const removed = pruneTextureStore(publicPath)
  if (removed) console.log(`Removed ${removed} textures no version names from textures/bedrock`)
}
