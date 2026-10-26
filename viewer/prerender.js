const path = require('path')
const { makeTextureAtlas } = require('./lib/atlas')
const { prepareBlocksStates } = require('./lib/modelsBuilder')
const mcAssets = require('minecraft-assets')
const Chunks = require('prismarine-chunk')
const fs = require('fs-extra')

const { supportedVersions, bedrockSupportedVersions } = require('./lib/version')

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

for (const version of versions) {
  const atlasFile = path.resolve(texturesPath, version + '.png')
  const blockStatesFile = path.resolve(blockStatesPath, version + '.json')
  if (fs.existsSync(atlasFile) && fs.existsSync(blockStatesFile) && !process.argv.includes('-f')) {
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
}
