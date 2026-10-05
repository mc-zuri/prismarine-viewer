/* global document, window, fetch, Image */
// Every item icon of a Bedrock version, as minecraft-assets exports it (items_textures.json), drawn as the viewer draws
// it (viewer/lib/bedrock/itemIcon.js), as the game shows it in the inventory: the texture the stack's aux value picks,
// its overlay over it, each multiplied by its colour (a leather helmet's dye, a spawn egg's colours); each aux variant
// of an item beside it. What may be wrong is marked:
//   no icon    the item has none
//   no file    its texture or overlay is not in the export
//   undyed     an icon the game dyes (its dyed part grey, what the dye leaves alone faint) that nothing colours
//   grey       a block icon all grey and drawn as it is: some the game colours (leaves, grass), most not (stone)
// "check every version" checks every version minecraft-assets has at once (itemCheck.js: by the server, or written
// with the site: build-site.js).
//
//   items.html?version=1.26.51&filter=leather&show=problems
const { iconsOf, isComposed, composeIcon, isDyeMask, isGrey } = require('../../../viewer/lib/bedrock/itemIcon')

const $ = id => document.getElementById(id)
const params = new URLSearchParams(window.location.search)
const ui = { version: $('version'), filter: $('filter'), show: $('show'), size: $('size'), background: $('background'), check: $('check'), status: $('status'), grid: $('grid'), info: $('info'), report: $('report') }

const FLAGS = {
  'no icon': { kind: 'bad', about: 'the item has no icon in the export' },
  'no file': { kind: 'bad', about: 'its texture or overlay is not a file of the export' },
  undyed: { kind: 'check', about: 'an icon the game dyes (its dyed part grey, what the dye leaves alone faint: alpha 1-8) that nothing colours' },
  grey: { kind: 'check', about: 'a block icon all grey, drawn as it is: the game colours some (leaves, grass in the inventory), most not (stone)' },
  coloured: { kind: 'coloured', about: 'drawn with an overlay or a colour' }
}

function compareVersions (a, b) {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}

function setParam (name, value) {
  if (value) params.set(name, value)
  else params.delete(name)
  window.history.replaceState(null, '', '?' + params)
}

// the URL of a version's file, where versions.json says the version keeps it (an entry the same as an earlier
// version's is kept once, in that version's folder)
const fileUrl = (version, file) => `bedrock-assets/${state.index[version]?.paths?.[file.split('/')[0]] ?? version}/${file}`

const pictures = new Map()
// a texture's RGBA pixels, null when the export has no such file
function picture (version, texture) {
  const key = version + '/' + texture
  if (!pictures.has(key)) {
    pictures.set(key, new Promise(resolve => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const g = canvas.getContext('2d')
        g.drawImage(image, 0, 0)
        resolve(g.getImageData(0, 0, image.width, image.height))
      }
      image.onerror = () => resolve(null)
      image.src = fileUrl(version, texture + '.png')
    }))
  }
  return pictures.get(key)
}

// An icon as it is drawn, and what may be wrong with it: { label, name, aux, icon, pixels, flags }
async function look ({ name, aux, icon }) {
  const shown = { label: aux === null ? name : `${name}:${aux}`, name, aux, icon, pixels: null, flags: [] }
  if (!icon) {
    shown.flags.push('no icon')
    return shown
  }
  const base = await picture(state.version, icon.texture)
  const overlay = icon.overlay ? await picture(state.version, icon.overlay) : null
  if (!base || (icon.overlay && !overlay)) {
    shown.flags.push('no file')
    return shown
  }
  shown.pixels = composeIcon(base, overlay, icon.tint)
  if (isComposed(icon)) shown.flags.push('coloured')
  else if (isDyeMask(base)) shown.flags.push('undyed')
  else if (icon.texture.startsWith('blocks/') && isGrey(base)) shown.flags.push('grey')
  return shown
}

// pixels drawn into a canvas of size x size, kept square and whole
function paint (canvas, pixels, size) {
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, size, size)
  if (!pixels) {
    // (a cross where it has none)
    g.strokeStyle = '#d04040'
    g.lineWidth = Math.max(2, size / 16)
    g.beginPath()
    g.moveTo(size * 0.2, size * 0.2)
    g.lineTo(size * 0.8, size * 0.8)
    g.moveTo(size * 0.8, size * 0.2)
    g.lineTo(size * 0.2, size * 0.8)
    g.stroke()
    return
  }
  const source = document.createElement('canvas')
  source.width = pixels.width
  source.height = pixels.height
  source.getContext('2d').putImageData(new window.ImageData(pixels.data, pixels.width, pixels.height), 0, 0)
  const scale = size / Math.max(pixels.width, pixels.height)
  g.imageSmoothingEnabled = false
  g.drawImage(source, (size - pixels.width * scale) / 2, (size - pixels.height * scale) / 2, pixels.width * scale, pixels.height * scale)
}

// ---- a version -----------------------------------------------------------------------------------------------------

const state = { index: {}, version: null, entries: [], byName: {}, meta: null, shown: [], chosen: null }

async function loadVersion () {
  const version = ui.version.value
  state.version = version
  setParam('version', version)
  ui.status.textContent = `${version}: loading...`
  ui.info.textContent = ''
  const [entries, meta] = await Promise.all([
    fetch(fileUrl(version, 'items_textures.json')).then(r => r.json()),
    fetch(fileUrl(version, 'meta.json')).then(r => r.ok ? r.json() : null).catch(() => null)
  ])
  if (state.version !== version) return
  state.entries = entries
  state.byName = Object.fromEntries(entries.map(e => [e.name, e]))
  state.meta = meta
  const icons = iconsOf(entries)
  let done = 0
  const shown = await Promise.all(icons.map(i => look(i).then(s => {
    if (++done % 200 === 0) ui.status.textContent = `${version}: ${done} / ${icons.length} icons`
    return s
  })))
  if (state.version !== version) return
  state.shown = shown
  summarize()
  render()
}

function summarize () {
  const count = flag => state.shown.filter(s => s.flags.includes(flag))
  const names = list => list.length ? ` (${list.slice(0, 8).map(s => s.label).join(', ')}${list.length > 8 ? ', ...' : ''})` : ''
  const variants = state.shown.filter(s => s.aux !== null).length
  const [none, file, undyed, grey, coloured] = ['no icon', 'no file', 'undyed', 'grey', 'coloured'].map(count)
  const source = state.meta?.source ? `; from ${state.meta.source.kind} ${state.meta.source.build}` : ''
  ui.status.textContent = `${state.version}: ${state.entries.length} items and ${variants} aux variants, ${coloured.length} coloured; ` +
    `no icon ${none.length}${names(none)}, no file ${file.length}${names(file)}, undyed ${undyed.length}${names(undyed)}, grey ${grey.length}${source}`
  const problems = none.length + file.length + undyed.length
  ui.show.querySelector('option[value=problems]').textContent = `problems (${problems})`
  ui.show.querySelector('option[value=coloured]').textContent = `coloured, overlay or dye (${coloured.length})`
  ui.show.querySelector('option[value=grey]').textContent = `grey block icons (${grey.length})`
}

function matches (s) {
  const show = ui.show.value
  if (show === 'problems' && !s.flags.some(f => FLAGS[f].kind === 'bad' || f === 'undyed')) return false
  if (show === 'coloured' && !s.flags.includes('coloured')) return false
  if (show === 'grey' && !s.flags.includes('grey')) return false
  if (show === 'variants') {
    const e = state.byName[s.name]
    if (!e.variants && !e.auxIcons) return false
  }
  const words = ui.filter.value.toLowerCase().split(/\s+/).filter(Boolean)
  const text = [s.label, s.icon?.texture, s.icon?.overlay].filter(Boolean).join(' ').toLowerCase()
  return words.every(w => text.includes(w))
}

function render () {
  const size = Number(ui.size.value)
  document.documentElement.style.setProperty('--cell', size + 'px')
  ui.grid.textContent = ''
  const list = state.shown.filter(matches)
  for (const s of list) {
    const cell = document.createElement('div')
    cell.className = 'cell'
    const worst = s.flags.map(f => FLAGS[f].kind).find(k => k === 'bad') ?? s.flags.map(f => FLAGS[f].kind).find(k => k === 'check')
    if (worst) cell.classList.add(worst)
    if (state.chosen === s) cell.classList.add('chosen')
    cell.title = [s.label, s.icon?.texture, ...s.flags].filter(Boolean).join('\n')
    const canvas = document.createElement('canvas')
    paint(canvas, s.pixels, size)
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = s.label
    cell.append(canvas, name)
    for (const f of s.flags) {
      const flag = document.createElement('span')
      flag.className = 'flag ' + FLAGS[f].kind
      flag.textContent = f
      cell.appendChild(flag)
    }
    cell.addEventListener('click', () => {
      state.chosen = s
      for (const c of ui.grid.querySelectorAll('.chosen')) c.classList.remove('chosen')
      cell.classList.add('chosen')
      showInfo(s)
    })
    ui.grid.appendChild(cell)
  }
  if (!list.length) ui.grid.textContent = 'none'
}

function showInfo (s) {
  const entry = state.byName[s.name]
  const flattened = s.aux !== null ? entry.flattened?.[s.aux] : null
  ui.info.textContent = ''
  const canvas = document.createElement('canvas')
  paint(canvas, s.pixels, 128)
  const text = [
    `${s.label}${flattened ? ` (the item ${flattened} since the flattening)` : ''}`,
    `drawn: ${JSON.stringify(s.icon)}`,
    ...s.flags.map(f => `${f}: ${FLAGS[f].about}`),
    '',
    `items_textures.json: ${JSON.stringify(entry, null, 1)}`
  ].join('\n')
  ui.info.append(canvas, text)
}

// ---- every version -------------------------------------------------------------------------------------------------

async function checkAll () {
  ui.report.textContent = 'checking every version (the first time, a minute or so)...'
  const results = await fetch('bedrock-items-check.json').then(r => r.json())
  const table = document.createElement('table')
  const row = (cells, tag = 'td') => {
    const tr = document.createElement('tr')
    for (const [text, cls, title] of cells) {
      const td = document.createElement(tag)
      td.textContent = text
      if (cls) td.className = cls
      if (title) td.title = title
      tr.appendChild(td)
    }
    return tr
  }
  table.appendChild(row([['version'], ['items'], ['aux variants'], ['coloured'], ['no icon'], ['no file'], ['undyed'], ['grey'], ['what is wrong']].map(([t]) => [t]), 'th'))
  let faults = 0
  for (const r of results.sort((a, b) => compareVersions(b.version, a.version))) {
    const n = (list, kind) => [String(list.length), list.length ? kind : '', list.join(' ')]
    const wrong = [...r.noIcon.map(x => 'no icon: ' + x), ...r.missingFiles.map(x => 'no file: ' + x), ...r.undyed.map(x => 'undyed: ' + x)]
    faults += r.noIcon.length + r.missingFiles.length + r.undyed.length
    const tr = row([[r.version], [String(r.items)], [String(r.variants)], [String(r.coloured.length), '', r.coloured.join(' ')],
      n(r.noIcon, 'bad'), n(r.missingFiles, 'bad'), n(r.undyed, 'check'), [String(r.grey.length), '', r.grey.join(' ')], [wrong.join(', '), 'names']])
    tr.addEventListener('click', () => {
      ui.version.value = r.version
      run(loadVersion)
      window.scrollTo(0, 0)
    })
    table.appendChild(tr)
  }
  ui.report.textContent = `${results.length} versions, ${faults} icons missing or undyed (click a version to see it; hover a count for its items)`
  const close = document.createElement('button')
  close.textContent = 'close'
  close.style.marginLeft = '10px'
  close.addEventListener('click', () => { ui.report.textContent = '' })
  ui.report.append(close, table)
}

// ---- the page ------------------------------------------------------------------------------------------------------

let queue = Promise.resolve()
const run = fn => { queue = queue.then(fn).catch(err => { ui.status.textContent = String(err?.stack ?? err) }) }

async function main () {
  const index = state.index = await fetch('bedrock-assets/versions.json').then(r => r.json())
  const viewerVersions = await fetch('worldBounds.json').then(r => r.json()).then(b => new Set(Object.keys(b))).catch(() => new Set())
  for (const version of Object.keys(index).sort(compareVersions).reverse()) {
    const option = document.createElement('option')
    option.value = version
    option.textContent = version + (viewerVersions.size && !viewerVersions.has('bedrock_' + version) ? ' (no world in the viewer)' : '')
    ui.version.appendChild(option)
  }
  if (index[params.get('version')]) ui.version.value = params.get('version')
  ui.filter.value = params.get('filter') ?? ''
  if (params.get('show')) ui.show.value = params.get('show')
  ui.version.addEventListener('change', () => run(loadVersion))
  ui.filter.addEventListener('input', () => { setParam('filter', ui.filter.value); render() })
  ui.show.addEventListener('change', () => { setParam('show', ui.show.value === 'all' ? '' : ui.show.value); render() })
  ui.size.addEventListener('change', render)
  ui.background.addEventListener('change', () => {
    const value = ui.background.value
    document.body.classList.toggle('checker', value === 'checker')
    if (value !== 'checker') document.documentElement.style.setProperty('--slot', value)
  })
  ui.check.addEventListener('click', () => run(checkAll))
  run(loadVersion)
  if (params.get('check')) run(checkAll)
}

main()
