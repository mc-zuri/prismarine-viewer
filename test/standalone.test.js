/* eslint-env jest */
/* global page */

// The built viewer (public/, as npm install leaves it) in a browser, showing a world made here: needs no server.
const path = require('path')
const http = require('http')
const { Vec3 } = require('vec3')
const { loadImage, createCanvas } = require('canvas')
const { getPort } = require('./common/util')
const { WORKER_KEYS } = require('../viewer/webpack/lazyMinecraftData')

const version = '1.16.4'
const TIMEOUT = 2 * 60 * 1000

// the share of a screenshot's pixels that are not the sky
async function drawnShare (png) {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const g = canvas.getContext('2d')
  g.drawImage(image, 0, 0)
  const { data } = g.getImageData(0, 0, image.width, image.height)
  const sky = [data[0], data[1], data[2]]
  let drawn = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== sky[0] || data[i + 1] !== sky[1] || data[i + 2] !== sky[2]) drawn++
  }
  return drawn / (data.length / 4)
}

describe('standalone viewer ' + version, () => {
  let viewer
  let port
  const requests = []
  const errors = []

  beforeAll(async () => {
    const World = require('prismarine-world')(version)
    const Chunk = require('prismarine-chunk')(version)
    const stone = require('minecraft-data')(version).blocksByName.stone.defaultState
    // flat stone up to y = 4: the camera looks down on it from the corner of the sky
    const world = new World(() => {
      const chunk = new Chunk()
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 16; x++) {
          for (let z = 0; z < 16; z++) chunk.setBlockStateId(new Vec3(x, y, z), stone)
        }
      }
      return chunk
    })
    // every path asked of the server: the page does not report what its workers ask for
    const emit = http.Server.prototype.emit
    jest.spyOn(http.Server.prototype, 'emit').mockImplementation(function (event, request, ...args) {
      if (event === 'request') requests.push(request.url.split('?')[0])
      return emit.call(this, event, request, ...args)
    })
    port = await getPort()
    viewer = require('../').standalone({ version, world, center: new Vec3(0, 5, 0), viewDistance: 1, port })
    page.on('pageerror', err => errors.push(String(err)))
    // (the page has no favicon)
    page.on('response', response => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`)
    })
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text())
    })
  }, TIMEOUT)

  afterAll(() => {
    viewer.close()
    jest.restoreAllMocks()
  })

  it('draws the world, with the minecraft-data of its version alone', async () => {
    await page.goto(`http://localhost:${port}`)
    let share = 0
    for (let i = 0; i < 100 && share < 0.1; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      share = await drawnShare(await page.screenshot({ path: path.join(__dirname, 'test_standalone.png') }))
    }
    expect(errors).toEqual([])
    expect(share).toBeGreaterThan(0.1)

    // the files of the version the worker reads, wherever minecraft-data keeps them, and no other
    const dataPaths = require('minecraft-data/minecraft-data/data/dataPaths.json').pc[version]
    const wanted = WORKER_KEYS.filter(key => dataPaths[key]).map(key => `/mc-data/${dataPaths[key]}/${key}.json`)
    const asked = [...new Set(requests.filter(url => url.startsWith('/mc-data/')))]
    expect(asked.sort()).toEqual(wanted.sort())
  }, TIMEOUT)
})
