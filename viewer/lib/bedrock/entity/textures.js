// Entity textures: of an image file (a pack's texture, by its path under public/) or of RGBA pixels (a player's skin),
// drawn as the game draws them: nearest pixels, rows from the top (the models' UVs are), repeating (UV animations
// scroll).
const THREE = require('three')
const { loadImage } = globalThis.isElectron ? require('../../utils.electron.js') : require('../../utils')

function setUp (texture) {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

// it carries userData.ready until its image has loaded
function imageTexture (url) {
  const texture = setUp(new THREE.Texture())
  texture.userData = texture.userData ?? {} // three r128 textures have none
  texture.userData.ready = new Promise((resolve, reject) => {
    loadImage(url, image => {
      texture.image = image
      texture.needsUpdate = true
      texture.userData.loaded = true
      resolve(texture)
    }, () => reject(new Error(`no texture ${url}`)))
  })
  return texture
}

function pixelTexture (width, height, rgba) {
  const texture = setUp(new THREE.DataTexture(new Uint8Array(rgba), width, height, THREE.RGBAFormat))
  texture.needsUpdate = true
  return texture
}

module.exports = { imageTexture, pixelTexture }
