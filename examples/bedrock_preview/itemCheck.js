// The item icons of minecraft-assets' Bedrock export, every version, checked as the items page shows them:
//   noIcon        items with no icon at all
//   missingFiles  icons (an item's own or an aux variant's: name:aux) naming a texture or overlay the export lacks
//   undyed        icons the game dyes (bedrock/itemIcon.js isDyeMask) that nothing colours: no colour or overlay
//   coloured      icons drawn with an overlay or a colour
//   grey          block icons all grey and drawn as they are: some the game colours (leaves, grass), most it does not
//                 (stone): to look at, not a fault
// The pictures are read with canvas (a dev dependency of the viewer); without it only the files are checked.
//
//   node examples/bedrock_preview/itemCheck.js [versions...] [--json]
//   $BEDROCK_ASSETS: another export to check (an extractor's --out) than minecraft-assets' data/bedrock
const fs = require('fs')
const path = require('path')
const { iconsOf, isComposed, isDyeMask, isGrey } = require('../../viewer/lib/bedrock/itemIcon')

const DATA = process.env.BEDROCK_ASSETS ?? path.join(path.dirname(require.resolve('minecraft-assets/package.json')), 'minecraft-assets/data/bedrock')

// the export: its versions.json, and the file of a version's entry, wherever versions.json says it is kept
function bedrockExport (dir = DATA) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'versions.json'), 'utf8'))
  const fileOf = (version, file) => {
    const parts = file.split('/')
    return path.join(dir, index[version]?.paths?.[parts[0]] ?? version, ...parts)
  }
  return { dir, index, versions: Object.keys(index), fileOf }
}

let canvas
try {
  canvas = require('canvas')
} catch {}

const pictures = new Map()
// a PNG's RGBA pixels, null without canvas (or for a file it cannot read)
function picture (file) {
  if (!canvas) return Promise.resolve(null)
  if (!pictures.has(file)) {
    pictures.set(file, canvas.loadImage(fs.readFileSync(file)).then(image => {
      const c = canvas.createCanvas(image.width, image.height)
      c.getContext('2d').drawImage(image, 0, 0)
      return c.getContext('2d').getImageData(0, 0, image.width, image.height)
    }, () => null))
  }
  return pictures.get(file)
}

async function checkVersion (exp, version) {
  const entries = JSON.parse(fs.readFileSync(exp.fileOf(version, 'items_textures.json'), 'utf8'))
  const out = { version, items: entries.length, variants: 0, noIcon: [], missingFiles: [], undyed: [], coloured: [], grey: [] }
  for (const { name, aux, icon } of iconsOf(entries)) {
    const label = aux === null ? name : `${name}:${aux}`
    if (aux !== null) out.variants++
    if (!icon) {
      out.noIcon.push(label)
      continue
    }
    const files = [icon.texture, icon.overlay].filter(Boolean).map(t => exp.fileOf(version, t + '.png'))
    if (files.some(f => !fs.existsSync(f))) {
      out.missingFiles.push(label)
      continue
    }
    if (isComposed(icon)) {
      out.coloured.push(label)
      continue
    }
    const pixels = await picture(files[0])
    if (!pixels) continue
    if (isDyeMask(pixels)) out.undyed.push(label)
    else if (icon.texture.startsWith('blocks/') && isGrey(pixels)) out.grey.push(label)
  }
  return out
}

const cache = new Map()
// the check of every version (or of those named), each redone only when its items_textures.json changed
async function checkExport (versions = null, exp = bedrockExport()) {
  const results = []
  for (const version of versions ?? exp.versions) {
    if (!exp.index[version]) continue
    const file = exp.fileOf(version, 'items_textures.json')
    const key = `${version}|${file}|${fs.statSync(file).mtimeMs}`
    if (!cache.has(key)) cache.set(key, checkVersion(exp, version))
    results.push(await cache.get(key))
  }
  return results
}

module.exports = { checkExport, bedrockExport }

if (require.main === module) {
  const args = process.argv.slice(2)
  const versions = args.filter(a => !a.startsWith('--'))
  checkExport(versions.length ? versions : null).then(results => {
    if (args.includes('--json')) return console.log(JSON.stringify(results, null, 1))
    for (const r of results) {
      const list = (names, n = 6) => names.length ? ` (${names.slice(0, n).join(' ')}${names.length > n ? ' ...' : ''})` : ''
      console.log(`${r.version.padEnd(9)} items ${r.items}, variants ${r.variants}, coloured ${r.coloured.length}; no icon ${r.noIcon.length}${list(r.noIcon)}, ` +
        `files missing ${r.missingFiles.length}${list(r.missingFiles)}, undyed ${r.undyed.length}${list(r.undyed)}, grey ${r.grey.length}`)
    }
    if (!canvas) console.log('(no canvas: the pictures were not looked at)')
  })
}
