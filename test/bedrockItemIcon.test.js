/* eslint-env jest */
const { itemIcon, isComposed, composeIcon, isDyeMask, iconsOf } = require('../viewer/lib/bedrock/itemIcon')

// a picture of RGBA pixels, row by row
const picture = (width, height, pixels) => ({ width, height, data: Uint8ClampedArray.from(pixels.flat()) })
const pixel = (p, x, y = 0) => [...p.data.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)]

describe('an item\'s icon', () => {
  const items = {
    bed: { texture: 'items/bed_white', variants: { 14: 'items/bed_red' } },
    leather_helmet: { texture: 'items/leather_helmet', overlay: 'items/leather_helmet_overlay', tint: { base: '#a06540' } },
    banner: { texture: 'items/banner', tint: { base: '#1d1d21' }, variants: { 1: 'items/banner' }, auxIcons: { 1: { texture: 'items/banner', tint: { base: '#b02e26' } } } },
    camera: {}
  }

  test('the stack\'s aux value picks a variant, a coloured one first; else the item\'s own, with its overlay and colour', () => {
    expect(itemIcon(items, 'bed', 14)).toEqual({ texture: 'items/bed_red' })
    expect(itemIcon(items, 'bed', 3)).toEqual({ texture: 'items/bed_white' })
    expect(itemIcon(items, 'leather_helmet')).toEqual({ texture: 'items/leather_helmet', overlay: 'items/leather_helmet_overlay', tint: { base: '#a06540' } })
    expect(itemIcon(items, 'banner', 1)).toEqual({ texture: 'items/banner', tint: { base: '#b02e26' } })
    expect(itemIcon(items, 'banner', 0).tint.base).toBe('#1d1d21')
    expect(isComposed(itemIcon(items, 'leather_helmet'))).toBe(true)
    expect(isComposed(itemIcon(items, 'bed', 14))).toBe(false)
  })

  test('an item with no icon, or not known, has none', () => {
    expect(itemIcon(items, 'camera')).toBeNull()
    expect(itemIcon(items, 'nothing')).toBeNull()
    expect(itemIcon(undefined, 'bed')).toBeNull()
  })

  test('drawn as the game dyes it: the base multiplied by its colour, the overlay over it as it is', () => {
    // a helmet as Bedrock marks it: the dyed part opaque grey, the undyed part (alpha 3) brown; and its overlay, the
    // undyed part made opaque
    const base = picture(3, 1, [[255, 255, 255, 255], [80, 50, 20, 3], [0, 0, 0, 0]])
    const overlay = picture(3, 1, [[0, 0, 0, 0], [80, 50, 20, 255], [0, 0, 0, 0]])
    const icon = composeIcon(base, overlay, { base: '#a06540' })
    expect([icon.width, icon.height]).toEqual([3, 1])
    expect(pixel(icon, 0)).toEqual([160, 101, 64, 255])
    expect(pixel(icon, 1)).toEqual([80, 50, 20, 255])
    expect(pixel(icon, 2)[3]).toBe(0)
  })

  test('an overlay coloured over a base drawn as it is, stretched to its size; an animated texture\'s first frame', () => {
    // a 2 x 4 strip of two square frames, and a 1 x 1 overlay half seen through
    const base = picture(2, 4, [[10, 10, 10, 255], [10, 10, 10, 255], [10, 10, 10, 255], [10, 10, 10, 255], [99, 99, 99, 255], [99, 99, 99, 255], [99, 99, 99, 255], [99, 99, 99, 255]])
    const overlay = picture(1, 1, [[255, 255, 255, 128]])
    const icon = composeIcon(base, overlay, { overlay: '#ff0000' })
    expect([icon.width, icon.height]).toEqual([2, 2])
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const [r, g, b, a] = pixel(icon, x, y)
        expect([Math.abs(r - 133) <= 1, Math.abs(g - 5) <= 1, Math.abs(b - 5) <= 1, a]).toEqual([true, true, true, 255])
      }
    }
  })
})

describe('what the items page checks', () => {
  test('an icon Bedrock dyes: its opaque part grey, what the dye leaves alone faint; faint pixels on a coloured one are not', () => {
    const grey = [150, 150, 150, 255]
    const faint = [90, 60, 30, 3]
    expect(isDyeMask(picture(4, 2, [grey, grey, grey, grey, faint, faint, faint, faint]))).toBe(true)
    // (a honeycomb: coloured, a few faint pixels round it)
    expect(isDyeMask(picture(4, 2, [[230, 150, 20, 255], grey, [230, 150, 20, 255], [230, 150, 20, 255], faint, faint, faint, faint]))).toBe(false)
    expect(isDyeMask(picture(4, 1, [grey, grey, grey, grey]))).toBe(false)
  })

  test('every icon of a version\'s items: each item\'s own, then its aux variants\'', () => {
    const icons = iconsOf([{ name: 'bed', texture: 'items/bed_white', variants: { 14: 'items/bed_red', 1: 'items/bed_orange' } }, { name: 'camera', texture: null }])
    expect(icons.map(i => [i.name, i.aux, i.icon?.texture ?? null])).toEqual([
      ['bed', null, 'items/bed_white'], ['bed', 1, 'items/bed_orange'], ['bed', 14, 'items/bed_red'], ['camera', null, null]
    ])
  })
})
