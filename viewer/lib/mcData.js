// minecraft-data one version at a time, for bundles.
//
// minecraft-data's data.js requires every file of every version, so a bundler packs them all. A bundle built with
// viewer/webpack/lazyMinecraftData.js has that module replaced by createLazyData(): the same table of versions, whose
// files are fetched when a version is first asked for (preload) and read synchronously from then on, as
// minecraft-data expects. Where data.js is the real one (Node, or a bundle built without the helper) preload has
// nothing to do.

const NOT_LOADED = 'MC_DATA_NOT_LOADED'

// paths: { pc|bedrock: { version: { key: folder } } }, as minecraft-data's dataPaths.json, with the keys to keep
// files: { '<folder>/<key>': () => Promise<json> }, one loader per data file: versions that share a file share it
function createLazyData ({ paths, files }) {
  const loaded = {}
  const pending = {}

  function load (id) {
    if (!pending[id]) {
      pending[id] = files[id]().then(json => { loaded[id] = json })
      // a failed fetch may be tried again
      pending[id].catch(() => { delete pending[id] })
    }
    return pending[id]
  }

  const data = {}
  for (const [type, versions] of Object.entries(paths)) {
    data[type] = {}
    for (const [version, keys] of Object.entries(versions)) {
      const entry = {}
      for (const [key, folder] of Object.entries(keys)) {
        const id = `${folder}/${key}`
        Object.defineProperty(entry, key, {
          enumerable: true,
          get () {
            // minecraft-data keeps what it first reads of a version: an undefined here would stay
            if (!(id in loaded)) {
              throw Object.assign(new Error(`minecraft-data of ${type} ${version} is not loaded: await preload('${type === 'pc' ? '' : type + '_'}${version}') first`), { code: NOT_LOADED, type, version })
            }
            return loaded[id]
          }
        })
      }
      data[type][version] = entry
    }
  }

  Object.defineProperty(data, '__lazy', {
    value: {
      loadVersion (type, version) {
        const keys = paths[type]?.[version]
        if (!keys) return Promise.reject(new Error(`minecraft-data has no ${type} ${version}`))
        return Promise.all(Object.entries(keys).map(([key, folder]) => load(`${folder}/${key}`)))
      }
    }
  })
  return data
}

// Resolves once require('minecraft-data')(version) can be called. version: as minecraft-data takes it ('1.21.4',
// 'bedrock_1.26.51'); it finds the data of the version itself.
function preload (version) {
  const lazy = require('minecraft-data/data.js').__lazy
  if (!lazy) return Promise.resolve()
  try {
    require('minecraft-data')(version)
    return Promise.resolve()
  } catch (err) {
    if (err.code !== NOT_LOADED) return Promise.reject(err)
    return lazy.loadVersion(err.type, err.version)
  }
}

module.exports = { createLazyData, preload, NOT_LOADED }
