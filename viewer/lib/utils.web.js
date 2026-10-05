/* global XMLHttpRequest, document, Image */
const THREE = require('three')

const textureCache = {}
function loadTexture (texture, cb) {
  if (!textureCache[texture]) {
    // textures.minecraft.net sends no CORS headers: player skins go through the
    // server's proxy route (lib/mineflayer.js)
    const url = texture.replace(/^https?:\/\/textures\.minecraft\.net\/texture\//, 'texture/')
    textureCache[texture] = new Promise(resolve => new THREE.TextureLoader().load(url, resolve, undefined, () => {}))
  }
  textureCache[texture].then(cb)
}

const pixelCache = {}
function loadPixels (texture, cb) {
  if (!pixelCache[texture]) {
    pixelCache[texture] = new Promise(resolve => new THREE.TextureLoader().load(texture, ({ image }) => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      canvas.getContext('2d').drawImage(image, 0, 0)
      resolve(canvas.getContext('2d').getImageData(0, 0, image.width, image.height))
    }))
  }
  pixelCache[texture].then(cb)
}

// onError: called instead of throwing when the file cannot be had
function loadJSON (url, callback, onError) {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.responseType = 'json'
  xhr.onload = function () {
    const status = xhr.status
    if (status === 200) {
      callback(xhr.response)
    } else if (onError) {
      onError(new Error(url + ' not found'))
    } else {
      throw new Error(url + ' not found')
    }
  }
  if (onError) xhr.onerror = () => onError(new Error(url + ' not found'))
  xhr.send()
}

// the image itself, for code that makes its own textures of it
function loadImage (url, onLoad, onError) {
  const image = new Image()
  image.onload = () => onLoad(image)
  image.onerror = () => onError(new Error(url + ' not found'))
  image.src = url
}

module.exports = { loadTexture, loadPixels, loadJSON, loadImage }
