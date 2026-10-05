// Builds the blocksStates file of a version from its minecraft-assets: the blockstates, with each variant's model
// given as [geometry, texture set], indexes into the tables of __models:
//   geometries   { elements, ao }: the model's elements, faces naming their texture by variable (#side) or by name
//   textureSets  { variable: texture name }
//   textures     texture name -> its place on the atlas (atlas.js)
// Many blocks share a geometry (every slab, every stairs) and many states a texture set, so the file holds each once;
// the mesher resolves a pair the first time it draws it (models.js).
const { cleanupBlockName, unwrapTexture, defaultUv } = require('./prepareModel')
const { buildRotationMatrix, matmulmat3, matmul3 } = require('./models')

function getModel (name, blocksModels) {
  name = cleanupBlockName(name)
  const data = blocksModels[name]
  if (!data) {
    return null
  }

  let model = { textures: {}, elements: [], ao: true }

  if (data.parent) {
    model = getModel(data.parent, blocksModels) ?? model
  }
  if (data.textures) {
    Object.assign(model.textures, JSON.parse(JSON.stringify(data.textures)))
  }
  if (data.elements) {
    model.elements = JSON.parse(JSON.stringify(data.elements))
  }
  if (data.ambientocclusion !== undefined) {
    model.ao = data.ambientocclusion
  }
  return model
}

// variable -> texture name, following #references; a texture the atlas lacks is missing_texture
function resolveTextureNames (textures, atlasTextures) {
  const names = {}
  for (const variable in textures) {
    let root = unwrapTexture(textures[variable])
    const seen = new Set()
    while (typeof root === 'string' && root.charAt(0) === '#' && !seen.has(root)) {
      seen.add(root)
      root = unwrapTexture(textures[root.substr(1)])
    }
    const name = typeof root === 'string' ? cleanupBlockName(root) : undefined
    names[variable] = name && name in atlasTextures ? name : 'missing_texture'
  }
  return names
}

const FACES = ['down', 'up', 'north', 'south', 'west', 'east']
const DIRECTIONS = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] }
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }

// the rotation the mesher gives a variant (models.js getSectionGeometry)
function variantMatrix (variant) {
  let matrix = null
  for (const axis of ['x', 'y', 'z']) {
    if (axis in variant) {
      const m = buildRotationMatrix(axis, -variant[axis])
      matrix = matrix ? matmulmat3(matrix, m) : m
    }
  }
  return matrix
}

const round = v => Math.round(v * 1e6) / 1e6
const turnPoint = (matrix, p) => matmul3(matrix, p.map(c => c - 8)).map(c => round(c + 8))
const directionOf = v => FACES.find(f => DIRECTIONS[f].every((c, i) => c === Math.round(v[i])))
const sameUv = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

// A variant with uvlock keeps its textures as they lie in the world, however its model turns: the elements are
// turned here instead of by the mesher, and their faces take the UV of where they end up. A face whose UV the model
// sets to something else than that of its box keeps it, turned with the face.
function bakeRotation (elements, matrix) {
  return elements.map(element => {
    const a = turnPoint(matrix, element.from)
    const b = turnPoint(matrix, element.to)
    const baked = {
      ...element,
      from: [0, 1, 2].map(i => Math.min(a[i], b[i])),
      to: [0, 1, 2].map(i => Math.max(a[i], b[i])),
      faces: {}
    }
    for (const [name, face] of Object.entries(element.faces)) {
      const turned = { ...face }
      if (face.uv && sameUv(face.uv, defaultUv(name, element.from, element.to))) delete turned.uv
      baked.faces[directionOf(matmul3(matrix, DIRECTIONS[name]))] = turned
    }
    if (element.rotation) {
      // a rotation about an axis, seen turned, is the same rotation about the turned axis
      const axis = matmul3(matrix, AXES[element.rotation.axis]).map(Math.round)
      const i = axis.findIndex(c => c !== 0)
      baked.rotation = {
        ...element.rotation,
        origin: turnPoint(matrix, element.rotation.origin),
        axis: 'xyz'[i],
        angle: element.rotation.angle * axis[i]
      }
    }
    return baked
  })
}

function prepareBlocksStates (mcAssets, atlas) {
  const blocksStates = mcAssets.blocksStates
  mcAssets.blocksStates.missing_texture = {
    variants: {
      normal: {
        model: 'missing_texture'
      }
    }
  }
  mcAssets.blocksModels.missing_texture = {
    parent: 'block/cube_all',
    textures: {
      all: 'blocks/missing_texture'
    }
  }

  const geometries = []
  const textureSets = []
  const index = new Map()
  const intern = (list, value) => {
    const key = (list === geometries ? 'g' : 't') + JSON.stringify(value)
    if (!index.has(key)) {
      index.set(key, list.length)
      list.push(value)
    }
    return index.get(key)
  }
  const missing = new Set()

  function prepareVariant (variant) {
    let model = getModel(variant.model, mcAssets.blocksModels)
    if (!model) {
      missing.add(variant.model)
      model = getModel('missing_texture', mcAssets.blocksModels)
    }
    let elements = model.elements
    const matrix = variant.uvlock ? variantMatrix(variant) : null
    if (matrix) {
      elements = bakeRotation(elements, matrix)
      delete variant.x
      delete variant.y
      delete variant.z
    }
    delete variant.uvlock
    variant.model = [
      intern(geometries, { elements, ao: model.ao }),
      intern(textureSets, resolveTextureNames(model.textures, atlas.json.textures))
    ]
  }

  for (const block of Object.values(blocksStates)) {
    if (!block) continue
    if (block.variants) {
      for (const variant of Object.values(block.variants)) {
        for (const v of [].concat(variant)) prepareVariant(v)
      }
    }
    if (block.multipart) {
      for (const part of block.multipart) {
        for (const v of [].concat(part.apply)) prepareVariant(v)
      }
    }
  }
  if (missing.size) console.warn(`${mcAssets.version}: no model ${[...missing].join(', ')}, drawn as missing_texture`)

  blocksStates.__models = { geometries, textureSets, textures: atlas.json.textures }
  // The colours tinted faces take (grass, leaves, water, redstone dust), for the mesher. Java's have been the same
  // tables since 1.16; later versions of minecraft-data lack the constants (birch, spruce, lily pad).
  blocksStates.__tints = mcAssets.tints ?? require('minecraft-data')('1.16.2').tints
  return blocksStates
}

module.exports = { prepareBlocksStates, getModel, bakeRotation, variantMatrix }
