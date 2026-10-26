// A player's skin as the game sends it (player_list, player_skin) -> the texture and geometry overrides
// BedrockEntity draws minecraft:player with. The skin's image is RGBA rows; its resource patch names the geometry
// ({ "geometry": { "default": "geometry.humanoid.customSlim" } }), which is the skin's own geometry data (1.8 or
// 1.12+, persona skins with poly meshes) or one the pack has. A skin that cannot be drawn whole is the pack's Steve,
// or Alex for slim arms: no image, a geometry not found, or one with no head (bedrock-protocol's default persona,
// whose head the game puts together from persona pieces it does not send).
const { geometryEntries, resolveGeometry } = require('./geometryFormat')
const { pixelTexture } = require('./textures')

const STEVE = { textures: { default: 'textures/entity/steve' }, geometry: { default: 'geometry.humanoid.custom' } }
const ALEX = { textures: { default: 'textures/entity/alex' }, geometry: { default: 'geometry.humanoid.customSlim' } }

const parse = (text) => {
  if (!text || typeof text !== 'string') return null
  try { return JSON.parse(text) } catch { return null }
}

// whether a geometry draws a head: a bone named head (or one under it) with cubes or a mesh
function hasHead (geometry) {
  const children = new Map()
  for (const b of geometry.bones) {
    const parent = b.parent?.toLowerCase()
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(b)
  }
  const drawn = (b) => b.cubes?.length || b.poly_mesh || (children.get(b.name.toLowerCase()) ?? []).some(drawn)
  return geometry.bones.some(b => b.name.toLowerCase() === 'head' && drawn(b))
}

// skin: { image: { width, height, data }, resourcePatch, geometryData, armSize } -> { textures, geometry, own }
function skinOverrides (assets, skin) {
  const fallback = { ...(skin?.armSize === 'slim' ? ALEX : STEVE), own: false }
  const image = skin?.image
  const data = image?.data && new Uint8Array(image.data.buffer ?? image.data, image.data.byteOffset ?? 0, image.data.byteLength ?? image.data.length)
  if (!data || !image.width || !image.height || data.length < image.width * image.height * 4) return fallback
  if (!data.some((v, i) => i % 4 === 3 && v > 0)) return fallback

  const name = parse(skin.resourcePatch)?.geometry?.default
  if (!name) return fallback
  const defs = new Map(geometryEntries(parse(skin.geometryData)).map(e => [e.id, e]))
  let geometry = null
  try {
    geometry = resolveGeometry(name, defs, id => assets.geometry[id] ?? null)
  } catch {
    return fallback
  }
  if (!geometry?.bones?.length || !hasHead(geometry)) return fallback
  // a skin image wider or taller than its geometry says is the same layout at a higher resolution
  return { textures: { default: pixelTexture(image.width, image.height, data) }, geometry: { default: geometry }, own: true }
}

module.exports = { skinOverrides, hasHead, STEVE, ALEX }
