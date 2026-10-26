// Webpack loader for minecraft-data's data.js (see ./lazyMinecraftData.js): drops its source, which requires every
// file of every version, and writes the table viewer/lib/mcData.js serves instead, with a loader per data file that
// fetches it. The files are copied beside the bundle (mc-data/pc/1.21.4/blocks.json), minified, once however many
// versions share them; webpack never parses them into modules.
const fs = require('fs')
const path = require('path')

// What a table holds of minecraft-data's data directory:
//   paths  { pc|bedrock: { version: { key: folder } } }, dataPaths.json cut down to the keys and versions kept
//   files  the data files those name, as '<folder>/<key>'
function listDataFiles (dataDir, { keys, versions }) {
  const dataPaths = JSON.parse(fs.readFileSync(path.join(dataDir, 'dataPaths.json'), 'utf8'))
  const paths = {}
  const files = new Set()
  for (const [type, typeVersions] of Object.entries(dataPaths)) {
    paths[type] = {}
    for (const [version, folders] of Object.entries(typeVersions)) {
      if (versions && !versions(type, version)) continue
      const kept = {}
      for (const key of keys) {
        const folder = folders[key]
        if (!folder || !fs.existsSync(path.join(dataDir, folder, key + '.json'))) continue
        kept[key] = folder
        files.add(`${folder}/${key}`)
      }
      if (Object.keys(kept).length) paths[type][version] = kept
    }
  }
  return { paths, files: [...files].sort() }
}

module.exports = function lazyDataLoader () {
  const dataDir = path.join(this.context, 'minecraft-data', 'data')
  this.addDependency(path.join(dataDir, 'dataPaths.json'))
  const { paths, files } = listDataFiles(dataDir, this.getOptions())

  // (the ?mc-data query makes them assets: see lazyMinecraftData.js)
  const loaders = files.map(id =>
    `  ${JSON.stringify(id)}: () => fetchJson(require(${JSON.stringify('./minecraft-data/data/' + id + '.json?mc-data')}))`)
  const runtime = path.join(__dirname, '..', 'lib', 'mcData.js')
  return [
    `const paths = ${JSON.stringify(paths)}`,
    "const fetchJson = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json() })",
    `const files = {\n${loaders.join(',\n')}\n}`,
    `module.exports = require(${JSON.stringify(runtime)}).createLazyData({ paths, files })`
  ].join('\n') + '\n'
}

module.exports.listDataFiles = listDataFiles
