/* global document, window, Image */
// What the gameplay page shows over the world: the hotbar (each slot's icon as the game draws it in the inventory, from
// the version's entity assets, or its name), the chat (what the server says, and a line to type in), the stats and
// the debug screen (F3), and a line of help or of the last problem.
const { itemIcon, composeIcon } = require('../../../../viewer/lib/bedrock/itemIcon')
const { loadEntityAssets } = require('../../../../viewer/lib/bedrock/entity/assets')

const ICON_SIZE = 32
const CHAT_LINES = 40

// an image's RGBA pixels, null when it cannot be loaded
function pixelsOf (url) {
  return new Promise(resolve => {
    if (!url) return resolve(null)
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
    image.src = url
  })
}

function createHud ({ hotbar, log, say, stats, debug, info }) {
  let assets = null
  const icons = new Map()

  // a slot's icon in a canvas, or null when the version has none for the item (or its assets are still loading)
  function icon (name, aux) {
    if (!assets) return Promise.resolve(null)
    const key = `${name}:${aux}`
    if (!icons.has(key)) {
      icons.set(key, (async () => {
        const found = itemIcon(assets?.items, name, aux)
        if (!found) return null
        const base = await pixelsOf(assets.textureUrl(found.texture))
        const overlay = found.overlay ? await pixelsOf(assets.textureUrl(found.overlay)) : null
        if (!base) return null
        const pixels = composeIcon(base, overlay, found.tint)
        const source = document.createElement('canvas')
        source.width = pixels.width
        source.height = pixels.height
        source.getContext('2d').putImageData(new window.ImageData(pixels.data, pixels.width, pixels.height), 0, 0)
        const canvas = document.createElement('canvas')
        canvas.width = ICON_SIZE
        canvas.height = ICON_SIZE
        const g = canvas.getContext('2d')
        g.imageSmoothingEnabled = false
        const scale = ICON_SIZE / Math.max(pixels.width, pixels.height)
        g.drawImage(source, (ICON_SIZE - pixels.width * scale) / 2, (ICON_SIZE - pixels.height * scale) / 2, pixels.width * scale, pixels.height * scale)
        return canvas
      })())
    }
    return icons.get(key)
  }

  return {
    // the version whose item icons the hotbar shows
    async setVersion (version) {
      icons.clear()
      assets = null
      assets = await loadEntityAssets(version).catch(() => null)
    },

    hotbar (slots, selected) {
      hotbar.replaceChildren()
      for (let i = 0; i < 9; i++) {
        const slot = document.createElement('div')
        slot.className = 'slot' + (i === selected ? ' selected' : '')
        const item = slots[i]
        if (item) {
          slot.title = item.name
          slot.textContent = item.name.replace(/_/g, ' ')
          icon(item.name, item.metadata ?? 0).then(canvas => {
            // (the copy: the same item may be in two slots)
            if (!canvas) return
            const copy = document.createElement('canvas')
            copy.width = canvas.width
            copy.height = canvas.height
            copy.getContext('2d').drawImage(canvas, 0, 0)
            slot.replaceChildren(copy)
          })
        }
        hotbar.appendChild(slot)
      }
    },

    log (text) {
      for (const line of String(text).split('\n')) {
        const div = document.createElement('div')
        div.textContent = line
        log.appendChild(div)
      }
      while (log.children.length > CHAT_LINES) log.firstChild.remove()
    },

    // the chat line: opened with what to start with, closed with null
    typing (start) {
      if (start === null) {
        say.style.display = 'none'
        say.blur()
        return
      }
      say.style.display = 'block'
      say.value = start
      say.focus()
    },

    stats (text) {
      stats.textContent = text
    },
    debug (text) {
      debug.textContent = text
    },
    info (text) {
      info.textContent = text
    },
    clear () {
      hotbar.replaceChildren()
      log.replaceChildren()
      stats.textContent = ''
      debug.textContent = ''
    }
  }
}

module.exports = { createHud }
