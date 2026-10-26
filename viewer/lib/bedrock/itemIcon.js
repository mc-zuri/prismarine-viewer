// A Bedrock item's icon, as the game draws it in the inventory and on the ground, from what minecraft-assets'
// items_textures.json says of the item (kept in the version's entity assets, see entity/prerender.js):
//   texture     the icon: a texture under items/ or blocks/ (items/apple, blocks/wool_colored_red)
//   overlay     drawn over it
//   tint        { base, overlay }: the colours texture and overlay are multiplied by (a leather helmet undyed is
//               #a06540); one it names no colour for is drawn as it is
//   variants    { aux: texture }: the icon of a stack of that aux value (a bed's colour, a potion's effect)
//   auxIcons    { aux: { texture, overlay, tint } }: the icon of a stack of that aux value that is coloured
// overlay and tint are those of the item's own icon, not of its variants.

/** The icon of a stack of `name` with aux value `aux`: { texture, overlay?, tint? }, null when the item has none */
function itemIcon (items, name, aux = 0) {
  const entry = items?.[name]
  if (!entry) return null
  const key = String(aux ?? 0)
  const coloured = entry.auxIcons?.[key]
  if (coloured?.texture) return coloured
  const variant = entry.variants?.[key]
  if (variant) return { texture: variant }
  if (!entry.texture) return null
  const icon = { texture: entry.texture }
  if (entry.overlay) icon.overlay = entry.overlay
  if (entry.tint) icon.tint = entry.tint
  return icon
}

/** whether drawing the icon takes more than its texture: an overlay, or a colour */
function isComposed (icon) {
  return !!(icon?.overlay || icon?.tint?.base || icon?.tint?.overlay)
}

// '#a06540' -> [160, 101, 64]
function rgbOf (color) {
  const n = parseInt(String(color).replace(/^#/, ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// the height of a texture's first frame: an animated one is a strip of square frames
const frameHeight = ({ width, height }) => height > width && height % width === 0 ? width : height

/**
 * The icon's pixels: the first frame of its texture multiplied by the base colour, and over it the overlay (stretched to
 * its size) multiplied by the overlay colour. base, overlay: RGBA pictures { width, height, data }.
 * -> { width, height, data: Uint8ClampedArray }
 */
function composeIcon (base, overlay = null, tint = {}) {
  const width = base.width
  const height = frameHeight(base)
  const baseTint = tint?.base ? rgbOf(tint.base) : null
  const overlayTint = tint?.overlay ? rgbOf(tint.overlay) : null
  const overHeight = overlay && frameHeight(overlay)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      let [r, g, b] = [base.data[i], base.data[i + 1], base.data[i + 2]]
      let a = base.data[i + 3] / 255
      if (baseTint) [r, g, b] = [r * baseTint[0] / 255, g * baseTint[1] / 255, b * baseTint[2] / 255]
      if (overlay) {
        const j = (Math.floor(y * overHeight / height) * overlay.width + Math.floor(x * overlay.width / width)) * 4
        let [or, og, ob] = [overlay.data[j], overlay.data[j + 1], overlay.data[j + 2]]
        const oa = overlay.data[j + 3] / 255
        if (overlayTint) [or, og, ob] = [or * overlayTint[0] / 255, og * overlayTint[1] / 255, ob * overlayTint[2] / 255]
        // (the overlay over the base, as a painter lays it)
        const out = oa + a * (1 - oa)
        if (out > 0) {
          r = (or * oa + r * a * (1 - oa)) / out
          g = (og * oa + g * a * (1 - oa)) / out
          b = (ob * oa + b * a * (1 - oa)) / out
        }
        a = out
      }
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = Math.round(a * 255)
    }
  }
  return { width, height, data }
}

/**
 * Every icon of a version's items (items_textures.json entries), as the items page lists them: each item's own, then
 * one for each aux value it has a variant of. -> [{ name, aux (null: the item's own), icon (itemIcon(), or null) }]
 */
function iconsOf (entries) {
  const items = Object.fromEntries(entries.map(e => [e.name, e]))
  const out = []
  for (const e of entries) {
    out.push({ name: e.name, aux: null, icon: itemIcon(items, e.name) })
    const auxes = new Set([...Object.keys(e.variants ?? {}), ...Object.keys(e.auxIcons ?? {})].map(Number))
    for (const aux of [...auxes].sort((a, b) => a - b)) out.push({ name: e.name, aux, icon: itemIcon(items, e.name, aux) })
  }
  return out
}

// Whether an icon is one Bedrock dyes: its dyed part opaque and grey (to be multiplied by the dye), what the dye leaves
// alone barely there (alpha 1-8), which drawn as it is all but vanishes. Drawn with no colour or overlay, such an icon
// is one the game dyes that nothing colours (a leather helmet, a firework star). (Faint pixels on a coloured icon, a
// honeycomb's, are only faint.)
function isDyeMask (picture) {
  let faint = 0
  let opaque = 0
  let grey = 0
  for (let i = 0; i < picture.width * frameHeight(picture) * 4; i += 4) {
    const a = picture.data[i + 3]
    if (a > 0 && a <= 8) faint++
    if (a !== 255) continue
    opaque++
    const [r, g, b] = [picture.data[i], picture.data[i + 1], picture.data[i + 2]]
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 12) grey++
  }
  return faint >= 4 && opaque > 0 && grey / opaque >= 0.9
}

// whether every pixel of an icon that shows is grey: an icon the game may colour (leaves, grass in the inventory)
function isGrey (picture) {
  let shown = 0
  for (let i = 0; i < picture.width * frameHeight(picture) * 4; i += 4) {
    if (picture.data[i + 3] < 128) continue
    shown++
    const [r, g, b] = [picture.data[i], picture.data[i + 1], picture.data[i + 2]]
    if (Math.max(r, g, b) - Math.min(r, g, b) > 12) return false
  }
  return shown > 0
}

module.exports = { itemIcon, isComposed, composeIcon, iconsOf, isDyeMask, isGrey, rgbOf }
