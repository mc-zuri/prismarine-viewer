const { Vec3 } = require('vec3')
const { prepareModel } = require('./prepareModel')
const { connectedProperties } = require('./bedrockStates')

// Tint colours come with the blocksStates (__tints, see modelsBuilder.js): per group (grass, foliage, water,
// redstone, constant) the colour of each key (a biome name, a redstone power, a block name) and a default.
const preparedTints = new WeakMap()

function getTints (blocksStates) {
  let tints = preparedTints.get(blocksStates)
  if (!tints) {
    tints = {}
    for (const [group, value] of Object.entries(blocksStates.__tints ?? {})) tints[group] = prepareTints(value)
    preparedTints.set(blocksStates, tints)
  }
  return tints
}

function prepareTints (tints) {
  const map = new Map()
  for (const { keys, color } of tints.data) {
    const gl = tintToGl(color)
    for (const key of keys) {
      map.set(`${key}`, gl)
    }
  }
  return { map, default: tintToGl(tints.default) }
}

const NO_TINT = [1, 1, 1]

// A face's UVs keep a hair inside its texels: a pixel on the edge of a face would otherwise sample the next texture of
// the atlas (a transparent one lets what is behind show through: a dotted line between blocks). 1/32768 of the atlas,
// 1/16 of a texel of a 2048 one, and at most a quarter of the face's own extent.
const UV_INSET = 1 / 32768

// where a corner's fraction (0 to 1) of a face's extent (size, negative when its texture runs backwards) lies
function insetUv (fraction, size) {
  const inset = Math.sign(size) * Math.min(UV_INSET, Math.abs(size) / 4)
  return inset + fraction * (size - 2 * inset)
}

// the colour of a key in a tint group; white where the blocksStates carry no tints
function tintOf (tints, group, key) {
  const tint = tints[group]
  if (!tint) return NO_TINT
  return tint.map.get(`${key}`) ?? tint.default
}

const constantTints = new Map()

// Bedrock: the colour of a block's tinted faces, by the tint method the game draws it with (blocks_render.json):
// a group of the tints by biome (grass, foliage, birch, evergreen, dry, water), redstone dust by its power, a stem
// by its growth, or a constant colour ('#208030', lily pads). A block of several kinds before the flattening (old
// leaves: birch, spruce...) names its method by one of its states: { property, values: { value: method }, default }
function bedrockTint (method, block, biome, tints) {
  if (typeof method === 'object') {
    method = method.values?.[block.getProperties()[method.property]] ?? method.default
    if (!method) return NO_TINT
  }
  if (method[0] === '#') {
    if (!constantTints.has(method)) constantTints.set(method, tintToGl(parseInt(method.slice(1, 7), 16)))
    return constantTints.get(method)
  }
  if (method === 'redstone') return tintOf(tints, 'redstone', block.getProperties().redstone_signal ?? 0)
  if (method === 'stem') {
    const growth = +(block.getProperties().growth ?? 7)
    if (tints.stem) return tintOf(tints, 'stem', growth)
    return [growth * 32 / 255, (255 - growth * 8) / 255, growth * 4 / 255]
  }
  return tintOf(tints, method, biome)
}

function tintToGl (tint) {
  const r = (tint >> 16) & 0xff
  const g = (tint >> 8) & 0xff
  const b = tint & 0xff
  return [r / 255, g / 255, b / 255]
}

const elemFaces = {
  up: {
    dir: [0, 1, 0],
    mask1: [1, 1, 0],
    mask2: [0, 1, 1],
    corners: [
      [0, 1, 1, 0, 1],
      [1, 1, 1, 1, 1],
      [0, 1, 0, 0, 0],
      [1, 1, 0, 1, 0]
    ]
  },
  down: {
    dir: [0, -1, 0],
    mask1: [1, 1, 0],
    mask2: [0, 1, 1],
    corners: [
      [1, 0, 1, 0, 1],
      [0, 0, 1, 1, 1],
      [1, 0, 0, 0, 0],
      [0, 0, 0, 1, 0]
    ]
  },
  east: {
    dir: [1, 0, 0],
    mask1: [1, 1, 0],
    mask2: [1, 0, 1],
    corners: [
      [1, 1, 1, 0, 0],
      [1, 0, 1, 0, 1],
      [1, 1, 0, 1, 0],
      [1, 0, 0, 1, 1]
    ]
  },
  west: {
    dir: [-1, 0, 0],
    mask1: [1, 1, 0],
    mask2: [1, 0, 1],
    corners: [
      [0, 1, 0, 0, 0],
      [0, 0, 0, 0, 1],
      [0, 1, 1, 1, 0],
      [0, 0, 1, 1, 1]
    ]
  },
  north: {
    dir: [0, 0, -1],
    mask1: [1, 0, 1],
    mask2: [0, 1, 1],
    corners: [
      [1, 0, 0, 0, 1],
      [0, 0, 0, 1, 1],
      [1, 1, 0, 0, 0],
      [0, 1, 0, 1, 0]
    ]
  },
  south: {
    dir: [0, 0, 1],
    mask1: [1, 0, 1],
    mask2: [0, 1, 1],
    corners: [
      [0, 0, 1, 0, 1],
      [1, 0, 1, 1, 1],
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0]
    ]
  }
}

// The liquid of type `type` at a block: the block itself, or (Bedrock) the liquid in its liquid layer, as the water
// around seagrass and of waterlogged blocks
function liquidOf (block, type) {
  if (!block) return null
  if (block.type === type) return block
  if (block.liquidLayer && block.liquidLayer.type === type) return block.liquidLayer
  return null
}

function getLiquidRenderHeight (world, block, type) {
  const liquid = liquidOf(block, type)
  if (!liquid) return 1 / 9
  if (liquid.metadata === 0) { // source block
    const blockAbove = world.getBlock(block.position.offset(0, 1, 0))
    if (liquidOf(blockAbove, type)) return 1
    return 8 / 9
  }
  return ((liquid.metadata >= 8 ? 8 : 7 - liquid.metadata) + 1) / 9
}

// flowTexture: the flowing texture, where the model names one (textures.flow), drawn on the sides, and on the top
// wherever the surface slopes, turned to run downhill as the game does; its frames span two blocks
function renderLiquid (world, cursor, texture, type, biome, water, attr, tints, flowTexture) {
  const heights = []
  for (let z = -1; z <= 1; z++) {
    for (let x = -1; x <= 1; x++) {
      heights.push(getLiquidRenderHeight(world, world.getBlock(cursor.offset(x, 0, z)), type))
    }
  }
  const cornerHeights = [
    Math.max(Math.max(heights[0], heights[1]), Math.max(heights[3], heights[4])),
    Math.max(Math.max(heights[1], heights[2]), Math.max(heights[4], heights[5])),
    Math.max(Math.max(heights[3], heights[4]), Math.max(heights[6], heights[7])),
    Math.max(Math.max(heights[4], heights[5]), Math.max(heights[7], heights[8]))
  ]

  // top-face texture coordinates per corner (x, z): still, or the flow turned downhill
  let topUv = null
  if (flowTexture) {
    const [h00, h10, h01, h11] = cornerHeights // index z * 2 + x
    const flowX = (h00 + h01) - (h10 + h11)
    const flowZ = (h00 + h10) - (h01 + h11)
    if (Math.abs(flowX) > 1e-4 || Math.abs(flowZ) > 1e-4) {
      const angle = Math.atan2(flowZ, flowX) - Math.PI / 2
      const s = Math.sin(angle) * 0.25
      const c = Math.cos(angle) * 0.25
      topUv = {
        '0,0': [0.5 - c - s, 0.5 - c + s],
        '0,1': [0.5 - c + s, 0.5 + c + s],
        '1,1': [0.5 + c + s, 0.5 + c - s],
        '1,0': [0.5 + c - s, 0.5 - c - s]
      }
    }
  }

  for (const face in elemFaces) {
    const { dir, corners } = elemFaces[face]
    const isUp = dir[1] === 1

    const neighbor = world.getBlock(cursor.offset(...dir))
    if (!neighbor) continue
    if (liquidOf(neighbor, type)) continue
    if ((neighbor.isCube && !isUp) || neighbor.material === 'plant' || neighbor.getProperties().waterlogged) continue
    if (neighbor.position.y < (world.minY ?? 0)) continue

    let tint = [1, 1, 1]
    if (water) {
      let m = 1 // Fake lighting to improve lisibility
      if (Math.abs(dir[0]) > 0) m = 0.6
      else if (Math.abs(dir[2]) > 0) m = 0.8
      tint = tintOf(tints, 'water', biome)
      tint = [tint[0] * m, tint[1] * m, tint[2] * m]
    }

    const faceTexture = flowTexture && (!isUp || topUv) ? flowTexture : texture
    const scale = faceTexture === flowTexture ? 0.5 : 1
    const u = faceTexture.u
    const v = faceTexture.v
    const su = faceTexture.su * scale
    const sv = faceTexture.sv * scale

    for (const pos of corners) {
      const height = cornerHeights[pos[2] * 2 + pos[0]]
      attr.t_positions.push(
        (pos[0] ? 1 : 0) + (cursor.x & 15) - 8,
        (pos[1] ? height : 0) + (cursor.y & 15) - 8,
        (pos[2] ? 1 : 0) + (cursor.z & 15) - 8)
      attr.t_normals.push(...dir)
      if (isUp && topUv) {
        const [tu, tv] = topUv[`${pos[0]},${pos[2]}`]
        attr.t_uvs.push(insetUv(tu, faceTexture.su) + u, insetUv(tv, faceTexture.sv) + v)
      } else {
        attr.t_uvs.push(insetUv(pos[3], su) + u, insetUv(pos[4] * (pos[1] ? 1 : height), sv) + v)
      }
      attr.t_animations.push(faceTexture.frames || 1, faceTexture.frametime || 1, faceTexture.framestep || 0)
      attr.t_colors.push(tint[0], tint[1], tint[2])
    }
  }
}

function vecadd3 (a, b) {
  if (!b) return a
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function vecsub3 (a, b) {
  if (!b) return a
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function matmul3 (matrix, vector) {
  if (!matrix) return vector
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2]
  ]
}

function matmulmat3 (a, b) {
  const te = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]

  const a11 = a[0][0]; const a12 = a[1][0]; const a13 = a[2][0]
  const a21 = a[0][1]; const a22 = a[1][1]; const a23 = a[2][1]
  const a31 = a[0][2]; const a32 = a[1][2]; const a33 = a[2][2]

  const b11 = b[0][0]; const b12 = b[1][0]; const b13 = b[2][0]
  const b21 = b[0][1]; const b22 = b[1][1]; const b23 = b[2][1]
  const b31 = b[0][2]; const b32 = b[1][2]; const b33 = b[2][2]

  te[0][0] = a11 * b11 + a12 * b21 + a13 * b31
  te[1][0] = a11 * b12 + a12 * b22 + a13 * b32
  te[2][0] = a11 * b13 + a12 * b23 + a13 * b33

  te[0][1] = a21 * b11 + a22 * b21 + a23 * b31
  te[1][1] = a21 * b12 + a22 * b22 + a23 * b32
  te[2][1] = a21 * b13 + a22 * b23 + a23 * b33

  te[0][2] = a31 * b11 + a32 * b21 + a33 * b31
  te[1][2] = a31 * b12 + a32 * b22 + a33 * b32
  te[2][2] = a31 * b13 + a32 * b23 + a33 * b33

  return te
}

function buildRotationMatrix (axis, degree) {
  const radians = degree / 180 * Math.PI
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  const axis0 = { x: 0, y: 1, z: 2 }[axis]
  const axis1 = (axis0 + 1) % 3
  const axis2 = (axis0 + 2) % 3

  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]

  matrix[axis0][axis0] = 1
  matrix[axis1][axis1] = cos
  matrix[axis1][axis2] = -sin
  matrix[axis2][axis1] = +sin
  matrix[axis2][axis2] = cos

  return matrix
}

function renderElement (world, cursor, element, doAO, attr, globalMatrix, globalShift, block, biome, tints) {
  const cullIfIdentical = block.name.indexOf('glass') >= 0

  for (const face in element.faces) {
    const eFace = element.faces[face]
    const { corners, mask1, mask2 } = elemFaces[face]
    // (variants turn by quarter turns: whole numbers, but for the float error of cos and sin, which would put the
    // neighbour one block off once floored)
    const dir = matmul3(globalMatrix, elemFaces[face].dir).map(Math.round)

    if (eFace.cullface) {
      const neighbor = world.getBlock(cursor.plus(new Vec3(...dir)))
      if (!neighbor) continue
      if (cullIfIdentical && neighbor.type === block.type) continue
      if (!neighbor.transparent && neighbor.isCube) continue
      if (neighbor.position.y < (world.minY ?? 0)) continue
    }

    const minx = element.from[0]
    const miny = element.from[1]
    const minz = element.from[2]
    const maxx = element.to[0]
    const maxy = element.to[1]
    const maxz = element.to[2]

    const u = eFace.texture.u
    const v = eFace.texture.v
    const su = eFace.texture.su
    const sv = eFace.texture.sv

    const ndx = Math.floor(attr.positions.length / 3)

    let tint = [1, 1, 1]
    if (eFace.tintindex !== undefined) {
      if (eFace.tintindex === 0) {
        if ('tint' in block) {
          // Bedrock: the tint method its assets give the block
          if (block.tint) tint = bedrockTint(block.tint, block, biome, tints)
        } else if (block.name === 'redstone_wire') {
          tint = tintOf(tints, 'redstone', block.getProperties().power)
        } else if (block.name === 'birch_leaves' ||
          block.name === 'spruce_leaves' ||
          block.name === 'lily_pad') {
          tint = tintOf(tints, 'constant', block.name)
        } else if (block.name.includes('leaves') || block.name === 'vine') {
          tint = tintOf(tints, 'foliage', biome)
        } else {
          tint = tintOf(tints, 'grass', biome)
        }
      }
    }

    // UV rotation
    const r = eFace.rotation || 0
    const uvcs = Math.cos(r * Math.PI / 180)
    const uvsn = -Math.sin(r * Math.PI / 180)

    let localMatrix = null
    let localShift = null

    if (element.rotation) {
      localMatrix = buildRotationMatrix(
        element.rotation.axis,
        element.rotation.angle
      )

      if (element.rotation.rescale) {
        // stretch the two turned axes back to the size of the block, as the game does for cross plants and sloped
        // rails: R * diag(scale)
        const axis = { x: 0, y: 1, z: 2 }[element.rotation.axis]
        const scale = 1 / Math.cos(element.rotation.angle / 180 * Math.PI)
        localMatrix = localMatrix.map(row => row.map((v, j) => j === axis ? v : v * scale))
      }

      localShift = vecsub3(
        element.rotation.origin,
        matmul3(
          localMatrix,
          element.rotation.origin
        )
      )
    }

    const aos = []
    for (const pos of corners) {
      let vertex = [
        (pos[0] ? maxx : minx),
        (pos[1] ? maxy : miny),
        (pos[2] ? maxz : minz)
      ]

      vertex = vecadd3(matmul3(localMatrix, vertex), localShift)
      vertex = vecadd3(matmul3(globalMatrix, vertex), globalShift)
      vertex = vertex.map(v => v / 16)

      attr.positions.push(
        vertex[0] + (cursor.x & 15) - 8,
        vertex[1] + (cursor.y & 15) - 8,
        vertex[2] + (cursor.z & 15) - 8
      )

      attr.normals.push(...dir)

      const baseu = (pos[3] - 0.5) * uvcs - (pos[4] - 0.5) * uvsn + 0.5
      const basev = (pos[3] - 0.5) * uvsn + (pos[4] - 0.5) * uvcs + 0.5
      attr.uvs.push(insetUv(baseu, su) + u, insetUv(basev, sv) + v)
      attr.animations.push(eFace.texture.frames || 1, eFace.texture.frametime || 1, eFace.texture.framestep || 0)

      let light = 1
      if (doAO) {
        const dx = pos[0] * 2 - 1
        const dy = pos[1] * 2 - 1
        const dz = pos[2] * 2 - 1
        const cornerDir = matmul3(globalMatrix, [dx, dy, dz]).map(Math.round)
        const side1Dir = matmul3(globalMatrix, [dx * mask1[0], dy * mask1[1], dz * mask1[2]]).map(Math.round)
        const side2Dir = matmul3(globalMatrix, [dx * mask2[0], dy * mask2[1], dz * mask2[2]]).map(Math.round)
        const side1 = world.getBlock(cursor.offset(...side1Dir))
        const side2 = world.getBlock(cursor.offset(...side2Dir))
        const corner = world.getBlock(cursor.offset(...cornerDir))

        const side1Block = (side1 && side1.isCube) ? 1 : 0
        const side2Block = (side2 && side2.isCube) ? 1 : 0
        const cornerBlock = (corner && corner.isCube) ? 1 : 0

        // TODO: correctly interpolate ao light based on pos (evaluate once for each corner of the block)

        const ao = (side1Block && side2Block) ? 0 : (3 - (side1Block + side2Block + cornerBlock))
        light = (ao + 1) / 4
        aos.push(ao)
      }

      attr.colors.push(tint[0] * light, tint[1] * light, tint[2] * light)
    }

    if (doAO && aos[0] + aos[3] >= aos[1] + aos[2]) {
      attr.indices.push(
        ndx, ndx + 3, ndx + 2,
        ndx, ndx + 1, ndx + 3
      )
    } else {
      attr.indices.push(
        ndx, ndx + 1, ndx + 2,
        ndx + 2, ndx + 1, ndx + 3
      )
    }
  }
}

// A variant's model: [geometry, texture set] of the blocksStates' __models (modelsBuilder.js), resolved against the
// atlas the first time it is drawn; or the model itself, for blocksStates whose models are resolved already.
const resolvedModels = new WeakMap()

function variantModel (variant, blocksStates) {
  if (!Array.isArray(variant.model)) return variant.model
  let resolved = resolvedModels.get(blocksStates)
  if (!resolved) {
    resolved = new Map()
    resolvedModels.set(blocksStates, resolved)
  }
  const [geometry, textureSet] = variant.model
  const key = geometry + ',' + textureSet
  let model = resolved.get(key)
  if (!model) {
    const { geometries, textureSets, textures } = blocksStates.__models
    model = JSON.parse(JSON.stringify({ ...geometries[geometry], textures: textureSets[textureSet] }))
    prepareModel(model, textures)
    resolved.set(key, model)
  }
  return model
}

function getSectionGeometry (sx, sy, sz, world, blocksStates) {
  const attr = {
    sx: sx + 8,
    sy: sy + 8,
    sz: sz + 8,
    positions: [],
    normals: [],
    colors: [],
    uvs: [],
    animations: [],
    t_positions: [],
    t_normals: [],
    t_colors: [],
    t_uvs: [],
    t_animations: [],
    indices: []
  }

  const tints = getTints(blocksStates)
  const cursor = new Vec3(0, 0, 0)
  for (cursor.y = sy; cursor.y < sy + 16; cursor.y++) {
    for (cursor.z = sz; cursor.z < sz + 16; cursor.z++) {
      for (cursor.x = sx; cursor.x < sx + 16; cursor.x++) {
        const block = world.getBlock(cursor)
        const biome = block.biome.name
        // (before the neighbours are read: a neighbour of the same state is the same block object)
        const liquidLayer = block.liquidLayer
        let variants
        if (block.connect) {
          // Bedrock: shaped by its neighbours, which its state does not say
          const props = { ...block.getProperties(), ...connectedProperties(world, cursor, block) }
          variants = getModelVariants({ name: block.name, getProperties: () => props }, blocksStates)
        } else {
          if (block.variant === undefined) {
            block.variant = getModelVariants(block, blocksStates)
          }
          variants = block.variant
        }

        if (liquidLayer) {
          // the liquid in the block
          if (liquidLayer.variant === undefined) liquidLayer.variant = getModelVariants(liquidLayer, blocksStates)
          const variant = liquidLayer.variant[0]
          if (variant && variant.model) {
            const model = variantModel(variant, blocksStates)
            renderLiquid(world, cursor, model.textures.particle, liquidLayer.type, biome, liquidLayer.liquid === 'water', attr, tints, model.textures.flow)
          }
        }

        for (const variant of variants) {
          if (!variant || !variant.model) continue
          const model = variantModel(variant, blocksStates)
          const liquid = block.liquid ?? (block.name === 'water' ? 'water' : block.name === 'lava' ? 'lava' : null)

          if (liquid) {
            renderLiquid(world, cursor, model.textures.particle, block.type, biome, liquid === 'water', attr, tints, model.textures.flow)
          }
          if (!liquid || model.elements.length) {
            let globalMatrix = null
            let globalShift = null

            for (const axis of ['x', 'y', 'z']) {
              if (axis in variant) {
                if (!globalMatrix) globalMatrix = buildRotationMatrix(axis, -variant[axis])
                else globalMatrix = matmulmat3(globalMatrix, buildRotationMatrix(axis, -variant[axis]))
              }
            }

            if (globalMatrix) {
              globalShift = [8, 8, 8]
              globalShift = vecsub3(globalShift, matmul3(globalMatrix, globalShift))
            }

            for (const element of model.elements) {
              renderElement(world, cursor, element, model.ao, attr, globalMatrix, globalShift, block, biome, tints)
            }
          }
        }
      }
    }
  }

  let ndx = attr.positions.length / 3
  for (let i = 0; i < attr.t_positions.length / 12; i++) {
    attr.indices.push(
      ndx, ndx + 1, ndx + 2,
      ndx + 2, ndx + 1, ndx + 3,
      // back face
      ndx, ndx + 2, ndx + 1,
      ndx + 2, ndx + 3, ndx + 1
    )
    ndx += 4
  }

  attr.positions.push(...attr.t_positions)
  attr.normals.push(...attr.t_normals)
  attr.colors.push(...attr.t_colors)
  attr.uvs.push(...attr.t_uvs)
  attr.animations.push(...attr.t_animations)

  delete attr.t_positions
  delete attr.t_normals
  delete attr.t_colors
  delete attr.t_uvs
  delete attr.t_animations

  attr.positions = new Float32Array(attr.positions)
  attr.normals = new Float32Array(attr.normals)
  attr.colors = new Float32Array(attr.colors)
  attr.uvs = new Float32Array(attr.uvs)
  attr.animations = new Float32Array(attr.animations)
  // typed, so the worker can transfer it instead of copying it
  const IndexArray = attr.positions.length / 3 > 65535 ? Uint32Array : Uint16Array
  attr.indices = new IndexArray(attr.indices)

  return attr
}

function parseProperties (properties) {
  if (typeof properties === 'object') { return properties }

  const json = {}
  for (const prop of properties.split(',')) {
    const [key, value] = prop.split('=')
    json[key] = value
  }
  return json
}

function matchProperties (block, properties) {
  if (!properties) { return true }

  properties = parseProperties(properties)
  const blockProps = block.getProperties()
  if (properties.OR) {
    return properties.OR.some((or) => matchProperties(block, or))
  }
  for (const prop in blockProps) {
    if (typeof properties[prop] === 'string' && !properties[prop].split('|').some((value) => value === blockProps[prop] + '')) {
      return false
    }
  }
  return true
}

function getModelVariants (block, blockStates) {
  // the air blocks render nothing. Enumerate them - a substring/suffix test also matches e.g. "*_stairs".
  if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') return []
  const state = blockStates[block.name] ?? blockStates.missing_texture
  if (!state) return []
  if (state.variants) {
    for (const [properties, variant] of Object.entries(state.variants)) {
      if (!matchProperties(block, properties)) continue
      if (variant instanceof Array) return [variant[0]]
      return [variant]
    }
  }
  if (state.multipart) {
    const parts = state.multipart.filter(multipart => matchProperties(block, multipart.when))
    let variants = []
    for (const part of parts) {
      if (part.apply instanceof Array) {
        variants = [...variants, ...part.apply]
      } else {
        variants = [...variants, part.apply]
      }
    }

    return variants
  }

  return []
}

module.exports = { getSectionGeometry, buildRotationMatrix, matmulmat3, matmul3 }
