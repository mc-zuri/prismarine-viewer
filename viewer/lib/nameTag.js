const THREE = require('three')
const { createCanvas } = require('canvas')
const { loadImage } = require('./utils')
const { supportedVersions } = require('./version')

// The name over an entity, as the game draws it: in its font, on a translucent black box, turned to the camera, and
// seen faintly through what hides it (a sneaking entity's only where it is not hidden). The glyphs are the font's own
// (font/ascii.png of the newest Java version: Bedrock's Mojangles is the same font) where it has them; other
// characters are the browser's text, in the nearest font it has. A name's picture is drawn once, at two pixels to the
// font's pixel so that up close they stay square, and shared by every entity of that name.

const PIXEL = 0.025 // a font pixel, in blocks
const TEXELS = 2 // a picture's pixels to a font pixel
const LINE = 10 // a line and its box, in font pixels: the glyphs' 8 and one above and below
const OTHER_FONT = `${8 * TEXELS}px Mojangles, Minecraft, sans-serif`
const FAINT = 0x20 / 0xff // the text seen through what hides it
const BOX = 0.25 // the box's opacity

// § formatting: colours, bold and reset (the other styles are drawn plain). Bedrock has colours of its own, two of
// them in place of Java's strikethrough (m) and underline (n).
const colours = (codes, hex) => Object.fromEntries([...codes].map((code, i) => [code, '#' + hex.split(' ')[i]]))
const COLOURS = colours('0123456789abcdef', '000000 0000aa 00aa00 00aaaa aa0000 aa00aa ffaa00 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff')
const BEDROCK_COLOURS = colours('ghijmnpqstuv', 'ddd605 e3d4d1 cecaca 443a3b 971607 b4684d deb12d 47a036 2cbaa8 21497b 9a5cc6 eb7114')

let font = null
// the font's glyphs: { image, cell (its pixels to a glyph), advance: { code: font pixels } }, or null without it
function loadFont () {
  font ??= new Promise(resolve => {
    loadImage(`textures/${supportedVersions[supportedVersions.length - 1]}/font/ascii.png`, image => {
      const cell = image.width / 16
      const canvas = createCanvas(image.width, image.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const { data } = ctx.getImageData(0, 0, image.width, image.height)
      // a glyph is as wide as its last column with a pixel, and a pixel apart from the next
      const advance = {}
      for (let code = 33; code < 127; code++) {
        const x0 = (code % 16) * cell
        const y0 = Math.floor(code / 16) * cell
        let width = 0
        for (let y = 0; y < cell; y++) {
          for (let x = width; x < cell; x++) if (data[((y0 + y) * image.width + x0 + x) * 4 + 3]) width = x + 1
        }
        if (width) advance[code] = width * 8 / cell + 1
      }
      resolve({ image: canvas, cell, advance })
    }, () => resolve(null))
  })
  return font
}

// a name's lines of characters: [[{ char, colour, bold }]]
function parse (text, bedrock) {
  const lines = [[]]
  let colour = COLOURS.f
  let bold = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '§' && i + 1 < text.length) {
      const code = text[++i].toLowerCase()
      const set = COLOURS[code] ?? (bedrock ? BEDROCK_COLOURS[code] : undefined)
      if (set) {
        colour = set
        bold = false
      } else if (code === 'l') {
        bold = true
      } else if (code === 'r') {
        colour = COLOURS.f
        bold = false
      }
      continue
    }
    if (char === '\n') lines.push([])
    else lines[lines.length - 1].push({ char, colour, bold })
  }
  return lines
}

let measure = null
// how far a character moves the next, in font pixels
function advanceOf (glyphs, char, bold) {
  let advance = glyphs?.advance[char.charCodeAt(0)]
  if (advance === undefined) {
    if (char === ' ') {
      advance = 4
    } else {
      measure ??= createCanvas(1, 1).getContext('2d')
      measure.font = OTHER_FONT
      advance = Math.ceil(measure.measureText(char).width / TEXELS) + 1
    }
  }
  return advance + (bold ? 1 : 0)
}

// a name's picture: white (or coloured) glyphs on nothing, its lines centred; and the box behind each line, in font
// pixels from the picture's centre
function draw (text, bedrock, glyphs) {
  const lines = parse(text, bedrock).map(chars => {
    const placed = []
    let x = 0
    for (const c of chars) {
      placed.push({ ...c, x })
      x += advanceOf(glyphs, c.char, c.bold)
    }
    return { chars: placed, width: x }
  })
  const width = Math.max(1, ...lines.map(l => l.width)) + 1
  const height = lines.length * LINE
  const canvas = createCanvas(width * TEXELS, height * TEXELS)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.font = OTHER_FONT
  ctx.textBaseline = 'alphabetic'
  const boxes = []
  lines.forEach((line, row) => {
    const left = Math.floor((width - 1 - line.width) / 2)
    const top = row * LINE
    boxes.push([left - width / 2, height / 2 - top, left + line.width + 1 - width / 2, height / 2 - top - LINE])
    for (const c of line.chars) {
      const x = (left + 1 + c.x) * TEXELS
      const y = (top + 1) * TEXELS
      const code = c.char.charCodeAt(0)
      for (const dx of c.bold ? [0, TEXELS] : [0]) {
        if (glyphs?.advance[code] !== undefined) {
          const { cell } = glyphs
          ctx.drawImage(glyphs.image, (code % 16) * cell, Math.floor(code / 16) * cell, cell, cell, x + dx, y, 8 * TEXELS, 8 * TEXELS)
        } else if (c.char !== ' ') {
          ctx.fillStyle = '#ffffff'
          ctx.fillText(c.char, x + dx, y + 7 * TEXELS)
        }
      }
    }
    // the colours over the white glyphs, a run at a time
    ctx.globalCompositeOperation = 'source-atop'
    for (const c of line.chars) {
      if (c.colour === COLOURS.f) continue
      ctx.fillStyle = c.colour
      ctx.fillRect((left + 1 + c.x) * TEXELS, top * TEXELS, advanceOf(glyphs, c.char, c.bold) * TEXELS, LINE * TEXELS)
    }
    ctx.globalCompositeOperation = 'source-over'
  })
  return { canvas, width, height, boxes }
}

// the pictures of the names shown, by edition and text, while an entity shows them
const pictures = new Map()

function pictureOf (text, bedrock, glyphs) {
  const key = (bedrock ? 'b' : 'j') + text
  let picture = pictures.get(key)
  if (!picture) {
    const { canvas, width, height, boxes } = draw(text, bedrock, glyphs)
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    const material = (opacity, depthTest) => new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity, depthTest, depthWrite: false })
    picture = {
      key,
      users: 0,
      width,
      height,
      boxes,
      texture,
      faint: material(FAINT, false),
      faintHidden: material(FAINT, true),
      solid: material(1, true)
    }
    pictures.set(key, picture)
  }
  picture.users++
  return picture
}

function release (picture) {
  if (--picture.users > 0) return
  pictures.delete(picture.key)
  picture.texture.dispose()
  picture.faint.dispose()
  picture.faintHidden.dispose()
  picture.solid.dispose()
}

const box = (depthTest) => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: BOX, depthTest, depthWrite: false })
const BOX_SEEN = box(false)
const BOX_HIDDEN = box(true)

// its meshes face the camera, at the tag's place, whatever turns the entity under it
const place = new THREE.Vector3()
const turn = new THREE.Quaternion()
const size = new THREE.Vector3(PIXEL, PIXEL, PIXEL)
const unused = new THREE.Vector3()
function faceCamera (renderer, scene, camera) {
  place.setFromMatrixPosition(this.parent.matrixWorld)
  camera.matrixWorld.decompose(unused, turn, unused)
  this.matrixWorld.compose(place, turn, size)
}

function quads (rects) {
  const positions = []
  const uvs = []
  const index = []
  for (const [x0, y0, x1, y1, u0 = 0, v0 = 0, u1 = 0, v1 = 0] of rects) {
    const n = positions.length / 3
    positions.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0)
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1)
    index.push(n, n + 2, n + 1, n, n + 3, n + 2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(index)
  return geometry
}

/**
 * A name tag: an object to add to an entity's mesh, whose name it shows over the entity (its top at height + 0.5).
 * The text may hold § codes and line breaks. bedrock: Bedrock's § colours. Until the font has loaded it shows nothing.
 *   tag.setName(text)        another name ('' or null: none)
 *   tag.setHeight(height)    the entity's height, in blocks
 *   tag.setSneaking(bool)    a sneaking entity's name is not seen through walls
 *   tag.dispose()
 */
function createNameTag ({ name = '', height = 1.8, bedrock = false } = {}) {
  const tag = new THREE.Object3D()
  tag.name = 'nameTag'
  const state = { name: null, picture: null, sneaking: false, disposed: false, meshes: [] }

  const meshOf = (geometry, material, order) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder = order
    mesh.onBeforeRender = faceCamera
    tag.add(mesh)
    state.meshes.push(mesh)
    return mesh
  }

  const clear = () => {
    for (const mesh of state.meshes) {
      tag.remove(mesh)
      mesh.geometry.dispose()
    }
    state.meshes = []
    if (state.picture) release(state.picture)
    state.picture = null
  }

  const show = (glyphs) => {
    clear()
    if (!state.name || state.disposed) return
    const picture = pictureOf(state.name, bedrock, glyphs)
    state.picture = picture
    const { width: w, height: h } = picture
    // (the picture's lines start a pixel in, past their boxes' edge)
    const text = quads([[-w / 2, h / 2, w / 2, -h / 2, 0, 1, 1, 0]])
    state.back = meshOf(quads(picture.boxes), BOX_SEEN, 10)
    state.faint = meshOf(text, picture.faint, 11)
    state.solid = meshOf(text.clone(), picture.solid, 12)
    // its top at the tag's place
    for (const mesh of state.meshes) mesh.geometry.translate(0, -h / 2, 0)
    sneak()
  }

  // sneaking, Java shows the name faintly; Bedrock as before; neither through what hides it
  const sneak = () => {
    if (!state.picture) return
    state.back.material = state.sneaking ? BOX_HIDDEN : BOX_SEEN
    state.faint.material = state.sneaking ? state.picture.faintHidden : state.picture.faint
    state.faint.visible = !(state.sneaking && bedrock)
    state.solid.visible = !state.sneaking || bedrock
  }

  tag.setName = (text) => {
    text = text ? String(text) : ''
    if (text === state.name) return
    state.name = text
    loadFont().then(glyphs => { if (state.name === text) show(glyphs) })
  }
  tag.setHeight = (h) => { tag.position.y = h + 0.5 }
  tag.setSneaking = (sneaking) => {
    if (state.sneaking === !!sneaking) return
    state.sneaking = !!sneaking
    sneak()
  }
  tag.dispose = () => {
    state.disposed = true
    clear()
  }
  tag.setHeight(height)
  tag.setName(name)
  return tag
}

module.exports = { createNameTag, parse, loadFont }
