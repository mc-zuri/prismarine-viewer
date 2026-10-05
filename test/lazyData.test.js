/**
 * @jest-environment node
 */
/* eslint-env jest */

// minecraft-data as a bundle built with lazyMinecraftData has it: data.js replaced by the table of
// viewer/lib/mcData.js. The loaders read the data files from disk here, where a bundle fetches chunks.
const mockLoads = []
jest.mock('minecraft-data/data.js', () => {
  const fs = require('fs')
  const path = require('path')
  const { createLazyData } = require('../viewer/lib/mcData')
  const { listDataFiles } = require('../viewer/webpack/lazyDataLoader')
  const { WORKER_KEYS } = require('../viewer/webpack/lazyMinecraftData')
  const dataDir = path.join(path.dirname(require.resolve('minecraft-data/package.json')), 'minecraft-data', 'data')
  const { paths, files } = listDataFiles(dataDir, { keys: WORKER_KEYS })
  return createLazyData({
    paths,
    files: Object.fromEntries(files.map(id => [id, async () => {
      mockLoads.push(id)
      return JSON.parse(fs.readFileSync(path.join(dataDir, id + '.json'), 'utf8'))
    }]))
  })
})

const { Vec3 } = require('vec3')
const mcData = require('minecraft-data')
const { preload } = require('../viewer/lib/mcData')
const { WORKER_KEYS } = require('../viewer/webpack/lazyMinecraftData')
const dataPaths = require('minecraft-data/minecraft-data/data/dataPaths.json')

const filesOf = (type, version) => WORKER_KEYS.filter(key => dataPaths[type][version][key]).map(key => `${dataPaths[type][version][key]}/${key}`).sort()

describe('lazy minecraft-data', () => {
  test('a version cannot be read before it is loaded', () => {
    expect(() => mcData('1.16.4')).toThrow(/not loaded/)
    expect(mockLoads).toEqual([])
  })

  test('preload fetches the files of the version, once', async () => {
    await preload('1.16.4')
    expect([...mockLoads].sort()).toEqual(filesOf('pc', '1.16.4'))
    expect(mcData('1.16.4').blocksByName.stone.name).toBe('stone')
    // a file the table does not keep
    expect(mcData('1.16.4').recipes).toBeUndefined()

    const loads = mockLoads.length
    await preload('1.16.4')
    expect(mockLoads.length).toBe(loads)
  })

  test('a version that shares files with one loaded fetches only its own', async () => {
    const before = new Set(mockLoads)
    await preload('1.16.5')
    const fetched = mockLoads.filter(id => !before.has(id))
    expect(fetched.sort()).toEqual(filesOf('pc', '1.16.5').filter(id => !before.has(id)))
    expect(fetched.length).toBeLessThan(filesOf('pc', '1.16.5').length)
  })

  test('the worker\'s world works on the files kept', async () => {
    const { World } = require('../viewer/lib/world')
    for (const version of ['1.8.8', '1.16.4', '1.21.4']) {
      await preload(version)
      const world = new World(version)
      const Chunk = require('prismarine-chunk')(version)
      const column = new Chunk()
      const stone = mcData(version).blocksByName.stone
      column.setBlockType(new Vec3(1, 2, 3), stone.id)
      world.addColumn(0, 0, column.toJson())
      const block = world.getBlock(new Vec3(1, 2, 3))
      expect(block.name).toBe('stone')
      expect(block.isCube).toBe(true)
      expect(block.biome).toBeDefined()
      expect(world.getBlock(new Vec3(1, 3, 3)).name).toBe('air')
    }
  })

  test('a version minecraft-data does not know resolves, for the caller to report', async () => {
    await expect(preload('0.0.1')).resolves.toBeUndefined()
  })
})
