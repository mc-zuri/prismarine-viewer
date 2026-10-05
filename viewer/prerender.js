// Builds the assets the viewer loads for each supported version into public/:
//   textures/<version>.png, blocksStates/<version>.json, textures/<version>/ (the version's minecraft-assets files,
//   for entities and items; Java only) and worldBounds.json
// Bedrock versions (bedrock_<version>) are built from their minecraft-assets the same way, where minecraft-assets has
// them. Their entities and items are drawn with the game's own client entities and item icons instead, and their
// particles with its particle effects: those are entities/<file>.json, found through entities/index.json, and their
// textures are in one store for every version, textures/bedrock/<sha1>.png (lib/bedrock/entity/prerender.js).
//
// node viewer/prerender.js [-f] [--versions 1.16.4,bedrock_1.26.51]
//   --versions  only these, of the supported versions; or $PRISMARINE_VIEWER_VERSIONS (as npm install builds), where
//               java, bedrock and bedrock-latest (the newest Bedrock version of each major) stand for those
//   -f          again, the versions already built too
const path = require('path')
const { makeTextureAtlas } = require('./lib/atlas')
const { prepareBlocksStates, getModel } = require('./lib/modelsBuilder')
const { cleanupBlockName } = require('./lib/prepareModel')
const mcAssets = require('minecraft-assets')
const Chunks = require('prismarine-chunk')
const fs = require('fs-extra')

const { entityAssets, writeEntityAssets, pruneTextureStore, readIndex, compareVersions } = require('./lib/bedrock/entity/prerender')

const { supportedVersions, bedrockSupportedVersions, nearestBedrockVersion } = require('./lib/version')

// bump when what a version's files hold changes, so that those built before are built again
const FORMAT = 4

function arg (name) {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? undefined : process.argv[i + 1]
}

// the Bedrock versions minecraft-assets has assets for
const bedrockWithAssets = new Set((mcAssets.bedrockVersions ?? []).map(v => 'bedrock_' + v))
const buildable = [...supportedVersions, ...bedrockSupportedVersions.filter(v => bedrockWithAssets.has(v))]

// java, bedrock, bedrock-latest: the buildable versions of each
function versionsNamed (list) {
  const bedrock = buildable.filter(v => v.startsWith('bedrock_'))
  const latest = {}
  for (const v of bedrock) latest[v.split('.').slice(0, 2).join('.')] = v
  const groups = { java: buildable.filter(v => !v.startsWith('bedrock_')), bedrock, 'bedrock-latest': Object.values(latest) }
  return [...new Set(list.split(',').map(v => v.trim()).filter(Boolean).flatMap(v => groups[v] ?? [v]))]
}

const force = process.argv.includes('-f')
const asked = arg('versions') ?? process.env.PRISMARINE_VIEWER_VERSIONS
const versions = asked ? versionsNamed(asked) : buildable
for (const version of versions) {
  if (!buildable.includes(version)) {
    throw new Error(`${version} cannot be built: not a supported version${bedrockSupportedVersions.includes(version) ? ' with Bedrock assets in minecraft-assets' : ''}`)
  }
}

const publicPath = path.resolve(__dirname, '../public')
fs.mkdirSync(publicPath, { recursive: true })

const texturesPath = path.resolve(publicPath, 'textures')
const blockStatesPath = path.resolve(publicPath, 'blocksStates')
fs.mkdirSync(texturesPath, { recursive: true })
fs.mkdirSync(blockStatesPath, { recursive: true })

// the versions built so far, and in which format
const builtPath = path.resolve(publicPath, 'prerender.json')
let built = fs.existsSync(builtPath) ? JSON.parse(fs.readFileSync(builtPath, 'utf8')) : {}
if (built.format !== FORMAT) built = { format: FORMAT, versions: [] }

// Bedrock: the textures of the liquids, which the game draws see-through by the biome's water transparency rather
// than by their pixels (their default biome's, as the viewer has one atlas)
function liquidTextures (assets) {
  const translucent = {}
  const opacity = assets.blocksRender.liquid?.water?.opacity
  if (opacity === undefined) return translucent
  for (const [name, render] of Object.entries(assets.blocksRender.blocks ?? {})) {
    if (render.liquid !== 'water') continue
    for (const variant of Object.values(assets.blocksStates[name]?.variants ?? {})) {
      for (const v of [].concat(variant)) {
        const model = getModel(v.model, assets.blocksModels)
        for (const texture of Object.values(model?.textures ?? {})) {
          if (typeof texture === 'string' && texture[0] !== '#') translucent[cleanupBlockName(texture)] = opacity
        }
      }
    }
  }
  return translucent
}

// Bedrock: the version's client entities and item icons, with the render controllers and attachables it lacks borrowed
// from a later version's
function bedrockEntities (version, assets) {
  const bare = version.slice('bedrock_'.length)
  const later = (mcAssets.bedrockVersions ?? []).filter(v => compareVersions(v, bare) > 0).sort(compareVersions)
    .map(v => ({ version: 'bedrock_' + v, entities: () => mcAssets('bedrock_' + v)?.entities }))
  const result = entityAssets(assets, { later })
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
  const files = [path.resolve(texturesPath, version + '.png'), path.resolve(blockStatesPath, version + '.json')]
  if (version.startsWith('bedrock_')) {
    const entities = readIndex(publicPath)[version]
    files.push(entities && path.resolve(publicPath, 'entities', entities + '.json'))
  }
  if (!force && built.versions.includes(version) && files.every(file => file && fs.existsSync(file))) {
    console.log(`${version} is already built, skipping...`)
    continue
  }
  const bedrock = version.startsWith('bedrock_')
  const assets = mcAssets(version)
  const atlas = makeTextureAtlas(assets, bedrock ? { translucent: liquidTextures(assets) } : {})
  fs.writeFileSync(files[0], atlas.canvas.toBuffer('image/png'))
  console.log('Generated textures/' + version + '.png')

  const blocksStates = prepareBlocksStates(assets, atlas)
  if (bedrock) {
    // how the game draws each block, beyond its model (tint, liquid, the shapes its neighbours make)
    blocksStates.__bedrock = { blocks: assets.blocksRender.blocks ?? {} }
  }
  fs.writeFileSync(files[1], JSON.stringify(blocksStates))

  if (bedrock) {
    bedrockEntities(version, assets)
    bedrockBuilt = true
  } else {
    fs.copySync(assets.directory, path.resolve(texturesPath, version), { overwrite: true })
  }

  if (!built.versions.includes(version)) built.versions.push(version)
  fs.writeFileSync(builtPath, JSON.stringify(built))
}

// World bounds come from prismarine-chunk, which is a build-time dependency here.
// Emitting them lets the browser fetch the answer instead of bundling
// prismarine-chunk (and all of minecraft-data behind it) into index.js.
// A Bedrock version without textures and blocksStates of its own is drawn with
// those of the nearest one built (files).
const builtBedrock = bedrockSupportedVersions.filter(v => built.versions.includes(v) &&
  fs.existsSync(path.resolve(texturesPath, v + '.png')) && fs.existsSync(path.resolve(blockStatesPath, v + '.json')))
fs.writeFileSync(path.resolve(publicPath, 'worldBounds.json'), JSON.stringify(
  Object.fromEntries([...supportedVersions, ...bedrockSupportedVersions].flatMap(version => {
    try {
      const chunk = new (Chunks(version))()
      const bounds = { minY: chunk.minY ?? 0, worldHeight: chunk.worldHeight ?? 256 }
      const files = version.startsWith('bedrock_') && nearestBedrockVersion(version, builtBedrock)
      if (files && files !== version) bounds.files = files
      return [[version, bounds]]
    } catch (err) {
      // (a Bedrock version minecraft-data or prismarine-chunk does not know)
      console.warn(`no world bounds for ${version}: ${err.message}`)
      return []
    }
  }))
))

// the textures of the store that no Bedrock version names any more
if (bedrockBuilt) {
  const removed = pruneTextureStore(publicPath)
  if (removed) console.log(`Removed ${removed} textures no version uses from textures/bedrock/`)
}
