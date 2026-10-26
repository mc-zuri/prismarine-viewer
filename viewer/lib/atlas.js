const fs = require('fs')
const { Canvas, Image } = require('canvas')
const path = require('path')

function nextPowerOfTwo (n) {
  if (n === 0) return 1
  n--
  n |= n >> 1
  n |= n >> 2
  n |= n >> 4
  n |= n >> 8
  n |= n >> 16
  return n + 1
}

function readTexture (basePath, name) {
  if (name === 'missing_texture.png') {
    // grab ./missing_texture.png
    basePath = __dirname
  }
  return fs.readFileSync(path.join(basePath, name), 'base64')
}

function loadImage (basePath, name) {
  const img = new Image()
  img.src = 'data:image/png;base64,' + readTexture(basePath, name)
  return img
}

// An animated texture is a vertical strip of square frames described by a
// .mcmeta next to it. Frame order and per-frame durations are baked into the
// atlas as repeated tiles, so the shader only needs a frame count, one frame
// time (in ticks) and the UV step between frames. "interpolate" is ignored.
function readAnimation (basePath, name, img) {
  const mcmetaPath = path.join(basePath, name + '.mcmeta')
  if (img.height <= img.width || !fs.existsSync(mcmetaPath)) return null
  const { animation } = JSON.parse(fs.readFileSync(mcmetaPath, 'utf8'))
  if (!animation) return null
  const frametime = animation.frametime || 1
  const frameCount = Math.floor(img.height / img.width)
  const frames = animation.frames || [...Array(frameCount).keys()]
  return {
    frametime,
    frameHeight: img.width,
    frames: frames.flatMap(f => typeof f === 'number' ? [f] : Array(Math.max(1, Math.round(f.time / frametime))).fill(f.index))
  }
}

// A gutter round each tile (each frame of an animated one) of its own edge
// pixels repeated, so that a sample taken just outside it (at the edge of a
// face, or by antialiasing) takes the tile's own colour rather than its
// neighbour's in the atlas, which would line every block's edges.
const PAD = 2

function drawPadded (g, img, sx, sy, w, h, dx, dy) {
  g.drawImage(img, sx, sy, w, h, dx, dy, w, h)
  g.drawImage(img, sx, sy, w, 1, dx, dy - PAD, w, PAD)
  g.drawImage(img, sx, sy + h - 1, w, 1, dx, dy + h, w, PAD)
  g.drawImage(img, sx, sy, 1, h, dx - PAD, dy, PAD, h)
  g.drawImage(img, sx + w - 1, sy, 1, h, dx + w, dy, PAD, h)
  for (const [cx, cy, tx, ty] of [[0, 0, -PAD, -PAD], [w - 1, 0, w, -PAD], [0, h - 1, -PAD, h], [w - 1, h - 1, w, h]]) {
    g.drawImage(img, sx + cx, sy + cy, 1, 1, dx + tx, dy + ty, PAD, PAD)
  }
}

// Tiles keep their native resolution (some are 32x32 since 26.1), so nothing
// here assumes a single atlas-wide tile size. Each entry carries its own
// u/v/su/sv extents (inside its gutter), and an animated entry additionally
// carries its frame count, frame time and per-frame UV step, since that step
// now varies per texture rather than being uniform across the atlas.
function makeTextureAtlas (mcAssets) {
  const blocksTexturePath = path.join(mcAssets.directory, '/blocks')
  const textureFiles = fs.readdirSync(blocksTexturePath).filter(file => file.endsWith('.png'))
  textureFiles.unshift('missing_texture.png')

  // An animated texture reserves a vertical run of frames; a plain one that is
  // taller than wide contributes only its first frame, as model UV space maps
  // to a single frame either way.
  const tiles = textureFiles.map(file => {
    const img = loadImage(blocksTexturePath, file)
    const animation = readAnimation(blocksTexturePath, file, img)
    const frames = animation ? animation.frames : [0]
    const frameHeight = animation ? animation.frameHeight : Math.min(img.width, img.height)
    return { name: file.split('.')[0], img, animation, frames, frameHeight, w: img.width + 2 * PAD, h: (frameHeight + 2 * PAD) * frames.length }
  })

  // shelf-pack: sort by height, lay out rows, then round the atlas up to a power of two
  const totalArea = tiles.reduce((a, t) => a + t.w * t.h, 0)
  const maxWidth = Math.max(...tiles.map(t => t.w))
  const width = nextPowerOfTwo(Math.max(maxWidth, Math.ceil(Math.sqrt(totalArea))))
  tiles.sort((a, b) => b.h - a.h)

  let shelfX = 0
  let shelfY = 0
  let shelfH = 0
  let packedHeight = 0
  for (const tile of tiles) {
    if (shelfX + tile.w > width) {
      shelfX = 0
      shelfY += shelfH
      shelfH = 0
    }
    tile.x = shelfX
    tile.y = shelfY
    shelfX += tile.w
    shelfH = Math.max(shelfH, tile.h)
    packedHeight = Math.max(packedHeight, shelfY + tile.h)
  }
  const height = nextPowerOfTwo(packedHeight)

  const canvas = new Canvas(width, height, 'png')
  const g = canvas.getContext('2d')
  // (the gutters are single pixels stretched: kept sharp)
  g.imageSmoothingEnabled = false

  const texturesIndex = {}

  for (const tile of tiles) {
    const w = tile.img.width
    const step = tile.frameHeight + 2 * PAD
    texturesIndex[tile.name] = { u: (tile.x + PAD) / width, v: (tile.y + PAD) / height, su: w / width, sv: tile.frameHeight / height }
    if (tile.animation) {
      texturesIndex[tile.name].frames = tile.frames.length
      texturesIndex[tile.name].frametime = tile.animation.frametime
      texturesIndex[tile.name].framestep = step / height
    }
    tile.frames.forEach((frame, i) => {
      drawPadded(g, tile.img, 0, frame * tile.frameHeight, w, tile.frameHeight, tile.x + PAD, tile.y + i * step + PAD)
    })
  }

  return { image: canvas.toBuffer(), canvas, json: { width, height, textures: texturesIndex } }
}

module.exports = {
  makeTextureAtlas
}
