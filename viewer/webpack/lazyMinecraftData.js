// Makes a webpack config load minecraft-data one version at a time (see viewer/lib/mcData.js).
//
//   const { lazyMinecraftData } = require('prismarine-viewer/viewer/webpack/lazyMinecraftData')
//   module.exports = lazyMinecraftData({ entry: ..., output: ... })
//
// The data files are copied beside the bundle (mc-data/<edition>/<folder>/<file>.json) and fetched for the version
// asked for: await require('prismarine-viewer/viewer/lib/mcData').preload(version) before anything reads
// minecraft-data of that version. The viewer's worker does so itself.
//
// options:
//   keys      the files of a version to keep (default WORKER_KEYS, what meshing a world reads); the others read as
//             undefined, and never reach the bundle
//   versions  (type, version) => boolean, the versions to keep (default: all)
const fs = require('fs')
const path = require('path')

// minecraft-data's data.js, known by the data beside it rather than by its folder's name (a checkout may be
// node-minecraft-data)
const isDataJs = resource => /[\\/]data\.js$/.test(resource) &&
  fs.existsSync(path.join(path.dirname(resource), 'minecraft-data', 'data', 'dataPaths.json'))

// blocks, their states (bedrock) and shapes, biomes and the version: what prismarine-registry, prismarine-block and
// prismarine-chunk read to hold a world
const WORKER_KEYS = ['blocks', 'blockStates', 'blockCollisionShapes', 'biomes', 'version']

function lazyMinecraftData (config, { keys = WORKER_KEYS, versions } = {}) {
  config.module = config.module ?? {}
  config.module.rules = [
    ...(config.module.rules ?? []),
    {
      test: isDataJs,
      use: [{ loader: path.join(__dirname, 'lazyDataLoader.js'), options: { keys, versions } }]
    },
    {
      // only validators read the schemas
      test: /[\\/]minecraft-data[\\/]schemas[\\/][^\\/]*\.json$/,
      use: [path.join(__dirname, 'emptyJsonLoader.js')]
    },
    {
      // the data files the table fetches, copied as files: parsed into modules, the hundreds of megabytes of them
      // would take webpack gigabytes of memory
      test: /\.json$/,
      resourceQuery: /mc-data/,
      type: 'asset/resource',
      use: [path.join(__dirname, 'minifyJsonLoader.js')],
      generator: { filename: pathData => 'mc-data/' + pathData.filename.replace(/\\/g, '/').split('minecraft-data/data/').pop().replace(/\?.*$/, '') }
    }
  ]
  return config
}

module.exports = { lazyMinecraftData, WORKER_KEYS }
