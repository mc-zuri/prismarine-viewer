/**
 * @jest-environment node
 */
/* eslint-env jest */

// The bundles npm install builds into public/
const fs = require('fs')
const path = require('path')
const { WORKER_KEYS } = require('../viewer/webpack/lazyMinecraftData')

const publicPath = path.join(__dirname, '../public')

function listFiles (dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}

describe('bundles', () => {
  test('the worker holds no minecraft-data of a version', () => {
    // three megabytes of code would be fine; one version's blocks alone are half of one
    expect(fs.statSync(path.join(publicPath, 'worker.js')).size).toBeLessThan(2 * 1024 * 1024)
  })

  test('the page holds no minecraft-data at all', () => {
    // (a field of protocolVersions.json, which minecraft-data loads whatever the version)
    expect(fs.readFileSync(path.join(publicPath, 'index.js'), 'utf8')).not.toMatch(/usesNetty/)
  })

  test('the data files are the files the worker reads, and no other', () => {
    const files = listFiles(path.join(publicPath, 'mc-data'))
    expect(files.length).toBeGreaterThan(100)
    expect(files.every(file => file.endsWith('.json'))).toBe(true)
    const names = new Set(files.map(file => path.basename(file, '.json')))
    expect([...names].sort()).toEqual([...WORKER_KEYS].sort())
  })
})
