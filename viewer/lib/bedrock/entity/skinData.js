// A Bedrock player's skin on its way from the bot (player_list, player_skin) to the page, once per player: its RGBA
// pixels and geometry deflated (a 64x64 skin is 16 KiB of pixels, a few KiB deflated; a persona's geometry tens of
// KiB of JSON), socket.io carrying them as binary.
//
//   bot side:  encodeSkin(record.skin_data) -> { key, width, height, armSize, resourcePatch, data, geometry, encoding }
//   page side: await decodeSkin(payload)   -> { image: { width, height, data }, resourcePatch, geometryData, armSize }
//              (what skin.js draws a player with)
/* global Blob, Response, DecompressionStream */
let zlib = {}
try {
  zlib = require('zlib')
} catch {}

// bytes of a Buffer, an ArrayBuffer (a browser's socket.io), a typed array or a { type: 'Buffer', data } object
function bytes (value) {
  if (!value) return null
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (Array.isArray(value.data)) return Uint8Array.from(value.data)
  if (Array.isArray(value)) return Uint8Array.from(value)
  return null
}

// FNV-1a over the bytes: a skin's key, the same for the same skin
function fnv (hash, data) {
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash
}

const utf8 = text => new TextEncoder().encode(text)

/** A skin as player_list and player_skin give it (skin_data) -> what the page needs of it, or null for none. */
function encodeSkin (skin) {
  const image = skin?.skin_data
  const rgba = bytes(image?.data)
  if (!rgba || !image.width || !image.height) return null
  const geometry = typeof skin.geometry_data === 'string' && skin.geometry_data ? utf8(skin.geometry_data) : null
  const resourcePatch = typeof skin.skin_resource_pack === 'string' ? skin.skin_resource_pack : ''
  let key = fnv(2166136261, rgba)
  if (geometry) key = fnv(key, geometry)
  key = fnv(key, utf8(resourcePatch))
  const deflate = typeof zlib.deflateSync === 'function'
  const pack = data => data && (deflate ? zlib.deflateSync(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength))
  return {
    key: `${image.width}x${image.height}-${key.toString(16)}`,
    width: image.width,
    height: image.height,
    armSize: skin.arm_size === 'slim' ? 'slim' : 'wide',
    resourcePatch,
    data: pack(rgba),
    geometry: pack(geometry),
    encoding: deflate ? 'deflate' : 'raw'
  }
}

async function inflate (data, encoding) {
  if (encoding !== 'deflate') return data
  if (typeof zlib.inflateSync === 'function') return bytes(zlib.inflateSync(data))
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** What encodeSkin() made -> the skin skin.js draws a player with. */
async function decodeSkin (payload) {
  const data = await inflate(bytes(payload.data), payload.encoding)
  const geometry = payload.geometry ? await inflate(bytes(payload.geometry), payload.encoding) : null
  return {
    image: { width: payload.width, height: payload.height, data },
    resourcePatch: payload.resourcePatch,
    geometryData: geometry ? new TextDecoder().decode(geometry) : '',
    armSize: payload.armSize
  }
}

module.exports = { encodeSkin, decodeSkin, bytes }
