// Writes the preview pages as a static site (what GitHub Pages serves: .github/workflows/bedrock-preview-pages.yml),
// the files server.js serves, written out:
//   - the viewer's assets (public/ of the repository, built by npm install) and the pages (public/ here, built by
//     webpack -c examples/bedrock_preview/webpack.config.js), the pages' files over the viewer's, as the server has them
//   - bedrock-assets/: what the items page reads of minecraft-assets' Bedrock export: versions.json, and of each version
//     its items_textures.json, meta.json and the textures its item icons name, each in the version's folder that
//     versions.json says holds it (the page finds them there)
//   - bedrock-items-check.json: every version's item icons checked (itemCheck.js), which the server works out
// The replay has no recordings there: it reads them through the server.
//
//   node examples/bedrock_preview/build-site.js <out directory>
//   $BEDROCK_ASSETS: another export than minecraft-assets' data/bedrock
const fs = require('fs')
const path = require('path')
const { checkExport, bedrockExport } = require('./itemCheck')
const { iconsOf } = require('../../viewer/lib/bedrock/itemIcon')

const out = path.resolve(process.argv[2] ?? '_site')
const viewerPublic = path.join(__dirname, '../../public')
const pagesPublic = path.join(__dirname, 'public')

function copyTree (from, to, skip = () => false) {
  let files = 0
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (skip(source)) continue
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true })
      files += copyTree(source, target, skip)
    } else {
      fs.copyFileSync(source, target)
      files++
    }
  }
  return files
}

// the items page's files of the export: versions.json, and each version's items_textures.json, meta.json and icons
function copyItemAssets (exp, to) {
  const copied = new Set()
  const copy = (version, file) => {
    const source = exp.fileOf(version, file)
    if (copied.has(source) || !fs.existsSync(source)) return
    copied.add(source)
    const target = path.join(to, path.relative(exp.dir, source))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
  fs.mkdirSync(to, { recursive: true })
  fs.copyFileSync(path.join(exp.dir, 'versions.json'), path.join(to, 'versions.json'))
  for (const version of exp.versions) {
    copy(version, 'items_textures.json')
    copy(version, 'meta.json')
    const entries = JSON.parse(fs.readFileSync(exp.fileOf(version, 'items_textures.json'), 'utf8'))
    for (const { icon } of iconsOf(entries)) {
      for (const texture of [icon?.texture, icon?.overlay]) if (texture) copy(version, texture + '.png')
    }
  }
  return copied.size
}

async function main () {
  if (!fs.existsSync(path.join(viewerPublic, 'worker.js'))) throw new Error('no viewer build in public/: npm install builds it')
  if (!fs.existsSync(path.join(pagesPublic, 'items.js'))) throw new Error('no pages built: npx webpack -c examples/bedrock_preview/webpack.config.js')
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  // (the viewer's own page and the version list of its builds are not the site's)
  const viewerFiles = copyTree(viewerPublic, out, file => ['index.html', 'prerender.json'].includes(path.relative(viewerPublic, file)))
  const pageFiles = copyTree(pagesPublic, out)
  const exp = bedrockExport()
  const assetFiles = copyItemAssets(exp, path.join(out, 'bedrock-assets'))
  const check = await checkExport(null, exp)
  fs.writeFileSync(path.join(out, 'bedrock-items-check.json'), JSON.stringify(check))
  // (served as they are: no Jekyll)
  fs.writeFileSync(path.join(out, '.nojekyll'), '')
  console.log(`${out}: ${viewerFiles} files of the viewer, ${pageFiles} of the pages, ${assetFiles} of minecraft-assets' Bedrock export (${exp.versions.length} versions), the items checked`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
