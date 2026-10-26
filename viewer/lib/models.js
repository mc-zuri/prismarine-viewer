const { Vec3 } = require('vec3')

const tints = require('minecraft-data')('1.16.2').tints

for (const key of Object.keys(tints)) {
  tints[key] = prepareTints(tints[key])
}

function prepareTints (tints) {
  const map = new Map()
  const defaultValue = tintToGl(tints.default)
  for (let { keys, color } of tints.data) {
    color = tintToGl(color)
    for (const key of keys) {
      map.set(`${key}`, color)
    }
  }
  return new Proxy(map, {
    get: (target, key) => {
      return target.has(key) ? target.get(key) : defaultValue
    }
  })
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

// Bedrock has a block for flowing water and lava besides the still one; both are the same liquid
function liquidOf (block) {
  if (!block) return null
  if (block.name === 'water' || block.name === 'flowing_water') return 'water'
  if (block.name === 'lava' || block.name === 'flowing_lava') return 'lava'
  return null
}

// the liquid at a position: its block, or the water a Bedrock block stands in (its second layer); else its block
function liquidAt (world, pos) {
  const block = world.getBlock(pos)
  if (!block || liquidOf(block)) return block
  const layer = world.getBlock(pos, 1)
  return liquidOf(layer) ? layer : world.getBlock(pos)
}

function getLiquidRenderHeight (world, block, type) {
  if (liquidOf(block) !== type) return 1 / 9
  if (block.metadata === 0) { // source block
    const blockAbove = liquidAt(world, block.position.offset(0, 1, 0))
    if (liquidOf(blockAbove) === type) return 1
    return 8 / 9
  }
  return ((block.metadata >= 8 ? 8 : 7 - block.metadata) + 1) / 9
}

function renderLiquid (world, cursor, texture, type, biome, water, attr) {
  const heights = []
  for (let z = -1; z <= 1; z++) {
    for (let x = -1; x <= 1; x++) {
      heights.push(getLiquidRenderHeight(world, liquidAt(world, cursor.offset(x, 0, z)), type))
    }
  }
  const cornerHeights = [
    Math.max(Math.max(heights[0], heights[1]), Math.max(heights[3], heights[4])),
    Math.max(Math.max(heights[1], heights[2]), Math.max(heights[4], heights[5])),
    Math.max(Math.max(heights[3], heights[4]), Math.max(heights[6], heights[7])),
    Math.max(Math.max(heights[4], heights[5]), Math.max(heights[7], heights[8]))
  ]

  for (const face in elemFaces) {
    const { dir, corners } = elemFaces[face]
    const isUp = dir[1] === 1

    if (liquidOf(liquidAt(world, cursor.offset(...dir))) === type) continue
    const neighbor = world.getBlock(cursor.offset(...dir))
    if (!neighbor) continue
    if ((neighbor.isCube && !isUp) || neighbor.material === 'plant' || neighbor.getProperties().waterlogged) continue
    if (neighbor.position.y < (world.minY ?? 0)) continue

    let tint = [1, 1, 1]
    if (water) {
      let m = 1 // Fake lighting to improve lisibility
      if (Math.abs(dir[0]) > 0) m = 0.6
      else if (Math.abs(dir[2]) > 0) m = 0.8
      tint = tints.water[biome]
      tint = [tint[0] * m, tint[1] * m, tint[2] * m]
    }

    const u = texture.u
    const v = texture.v
    const su = texture.su
    const sv = texture.sv

    for (const pos of corners) {
      const height = cornerHeights[pos[2] * 2 + pos[0]]
      attr.t_positions.push(
        (pos[0] ? 1 : 0) + (cursor.x & 15) - 8,
        (pos[1] ? height : 0) + (cursor.y & 15) - 8,
        (pos[2] ? 1 : 0) + (cursor.z & 15) - 8)
      attr.t_normals.push(...dir)
      attr.t_uvs.push(pos[3] * su + u, pos[4] * sv * (pos[1] ? 1 : height) + v)
      attr.t_animations.push(texture.frames || 1, texture.frametime || 1, texture.framestep || 0)
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

// a direction turned by a variant's rotation (a multiple of 90 degrees), back to whole numbers
function roundDir (dir) {
  return dir.map(v => Math.round(v) + 0)
}

function renderElement (world, cursor, element, doAO, attr, globalMatrix, globalShift, block, biome) {
  const cullIfIdentical = block.name.indexOf('glass') >= 0

  for (const face in element.faces) {
    const eFace = element.faces[face]
    const { corners, mask1, mask2 } = elemFaces[face]
    // (a turn of 90 or 270 degrees leaves components like -1.8e-16, which would floor into the next block)
    const dir = roundDir(matmul3(globalMatrix, elemFaces[face].dir))

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
        if (block.name === 'redstone_wire') {
          tint = tints.redstone[`${block.getProperties().power}`]
        } else if (block.name === 'birch_leaves' ||
          block.name === 'spruce_leaves' ||
          block.name === 'lily_pad') {
          tint = tints.constant[block.name]
        } else if (block.name.includes('leaves') || block.name === 'vine') {
          tint = tints.foliage[biome]
        } else {
          tint = tints.grass[biome]
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
      attr.uvs.push(baseu * su + u, basev * sv + v)
      attr.animations.push(eFace.texture.frames || 1, eFace.texture.frametime || 1, eFace.texture.framestep || 0)

      let light = 1
      if (doAO) {
        const dx = pos[0] * 2 - 1
        const dy = pos[1] * 2 - 1
        const dz = pos[2] * 2 - 1
        const cornerDir = roundDir(matmul3(globalMatrix, [dx, dy, dz]))
        const side1Dir = roundDir(matmul3(globalMatrix, [dx * mask1[0], dy * mask1[1], dz * mask1[2]]))
        const side2Dir = roundDir(matmul3(globalMatrix, [dx * mask2[0], dy * mask2[1], dz * mask2[2]]))
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

  const cursor = new Vec3(0, 0, 0)
  for (cursor.y = sy; cursor.y < sy + 16; cursor.y++) {
    for (cursor.z = sz; cursor.z < sz + 16; cursor.z++) {
      for (cursor.x = sx; cursor.x < sx + 16; cursor.x++) {
        const block = world.getBlock(cursor)
        const biome = block.biome.name
        if (block.variant === undefined) {
          block.variant = getModelVariants(block, blocksStates)
        }
        const positionKind = keyedByPosition(block, blocksStates)
        const variants = positionKind
          ? getModelVariants(block, blocksStates, positionStates(world, cursor, block, positionKind))
          : block.variant

        for (const variant of variants) {
          if (!variant || !variant.model) continue

          const liquid = liquidOf(block)
          if (liquid) {
            renderLiquid(world, cursor, variant.model.textures.particle, liquid, biome, liquid === 'water', attr)
          } else {
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

            for (const element of variant.model.elements) {
              renderElement(world, cursor, element, variant.model.ao, attr, globalMatrix, globalShift, block, biome)
            }
          }
        }

        // the water a Bedrock block stands in (seagrass, kelp, a waterlogged stair), in its second layer
        if (!liquidOf(block)) {
          const layer = world.getBlock(cursor, 1)
          const liquid = liquidOf(layer)
          if (liquid) {
            if (layer.variant === undefined) layer.variant = getModelVariants(layer, blocksStates)
            const model = layer.variant[0]?.model
            if (model) renderLiquid(world, cursor, model.textures.particle, liquid, biome, liquid === 'water', attr)
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

// Bedrock before 1.26.50 keeps no connection of a fence, pane or bars and no corner of a stair in its state, and no
// version keeps a redstone dust's connections: the client works them out from the neighbours. Their blockstates are
// keyed by the states 1.26.50 has for them (minecraft:connection_<side>, minecraft:corner; a dust's connections none,
// side or up), which a block whose state lacks them takes from its neighbours here. A blockstate keyed by
// block_entity.<tag> (a Bedrock bed's colour, a head's rotation) takes them from the block's block entity.
const SIDES = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' }
const COUNTER_CLOCKWISE = { north: 'west', west: 'south', south: 'east', east: 'north' }
const STAIR_FACING = ['east', 'west', 'south', 'north'] // by weirdo_direction
const positionKeys = new WeakMap() // blockStates -> block name -> 'connection' | 'redstone' | 'corner' | 'block_entity' | null

function keyedByPosition (block, blockStates) {
  if (!positionKeys.has(blockStates)) positionKeys.set(blockStates, {})
  const byName = positionKeys.get(blockStates)
  if (!(block.name in byName)) {
    const text = JSON.stringify(blockStates[block.name] ?? null)
    byName[block.name] = text.includes('block_entity.')
      ? 'block_entity'
      : text.includes('"minecraft:connection_')
        ? (block.name === 'redstone_wire' ? 'redstone' : 'connection')
        : text.includes('minecraft:corner=') ? 'corner' : null
  }
  const kind = byName[block.name]
  const props = block.getProperties()
  if (kind === 'block_entity') return kind
  if ((kind === 'connection' || kind === 'redstone') && !('minecraft:connection_north' in props)) return kind
  if (kind === 'corner' && !('minecraft:corner' in props) && props.weirdo_direction !== undefined) return kind
  return null
}

const kindOf = name => /fence_gate$/.test(name) ? 'gate' : /fence$/.test(name) ? 'fence' : /(pane|bars)$/.test(name) ? 'pane' : /wall$/.test(name) ? 'wall' : null

// whether a fence, pane or bars connects to a neighbour: one of its own kind, a fence to a fence gate, a pane to glass
// and walls, any of them to a solid block
function connects (block, other) {
  if (!other) return false
  const kind = kindOf(block.name)
  const otherKind = kindOf(other.name)
  if (kind === 'fence' && otherKind === 'fence') return (block.name === 'nether_brick_fence') === (other.name === 'nether_brick_fence')
  if (kind === 'fence' && otherKind === 'gate') return true
  if (kind === 'pane' && (otherKind === 'pane' || otherKind === 'wall' || /glass$/.test(other.name))) return true
  return !!other.isCube && !other.transparent
}

function stairOf (block) {
  if (!block || !/stairs$/.test(block.name)) return null
  const props = block.getProperties()
  return props.weirdo_direction === undefined ? null : { facing: STAIR_FACING[props.weirdo_direction], half: props.upside_down_bit }
}

// a stair's corner: outer where the stair in front of it turns across it, inner where the one behind it does
function stairCorner (world, cursor, block) {
  const stair = stairOf(block)
  const at = side => stairOf(world.getBlock(cursor.offset(SIDES[side][0], 0, SIDES[side][1])))
  const axis = side => side === 'north' || side === 'south' ? 'z' : 'x'
  const same = other => other && other.facing === stair.facing && other.half === stair.half
  const across = other => other && other.half === stair.half && axis(other.facing) !== axis(stair.facing)
  const front = at(stair.facing)
  if (across(front) && !same(at(OPPOSITE[front.facing]))) return front.facing === COUNTER_CLOCKWISE[stair.facing] ? 'outer_left' : 'outer_right'
  const back = at(OPPOSITE[stair.facing])
  if (across(back) && !same(at(back.facing))) return back.facing === COUNTER_CLOCKWISE[stair.facing] ? 'inner_left' : 'inner_right'
  return 'none'
}

// the blocks redstone dust turns to: dust, and what gives or takes a signal (a repeater along its axis)
const REDSTONE = /^(redstone_wire|(unlit_)?redstone_torch|redstone_block|lever|.*_button|.*pressure_plate|daylight_detector.*|target|trapped_chest|tripwire_hook|lectern|detector_rail|(un)?powered_comparator|.*sculk_sensor)$/
const REPEATER_AXIS = ['z', 'x', 'z', 'x'] // by direction

function takesRedstone (block, side) {
  if (!block) return false
  if (/^(un)?powered_repeater$/.test(block.name)) {
    const props = block.getProperties()
    const facing = props['minecraft:cardinal_direction']
    const axis = facing ? (facing === 'north' || facing === 'south' ? 'z' : 'x') : REPEATER_AXIS[props.direction]
    return axis === (side === 'north' || side === 'south' ? 'z' : 'x')
  }
  return REDSTONE.test(block.name)
}

// a dust's connection to a side: to what takes redstone there, to dust a step down there (the side not solid), or a
// step up the block there (the block above the dust not solid)
function dustConnection (world, cursor, side) {
  const [dx, dz] = SIDES[side]
  const next = world.getBlock(cursor.offset(dx, 0, dz))
  if (takesRedstone(next, side)) return 'side'
  const solid = block => !!block && !!block.isCube && !block.transparent
  if (solid(next)) {
    return !solid(world.getBlock(cursor.offset(0, 1, 0))) && world.getBlock(cursor.offset(dx, 1, dz))?.name === 'redstone_wire' ? 'up' : 'none'
  }
  return world.getBlock(cursor.offset(dx, -1, dz))?.name === 'redstone_wire' ? 'side' : 'none'
}

// the tags of a block's block entity, as block_entity.<tag>
function blockEntityStates (world, cursor) {
  const out = {}
  const tag = world.getBlockEntity?.(cursor)
  for (const [key, { value } = {}] of Object.entries(tag?.value ?? {})) {
    if (typeof value === 'number' || typeof value === 'string') out['block_entity.' + key] = String(value)
  }
  return out
}

function positionStates (world, cursor, block, kind) {
  if (kind === 'block_entity') return blockEntityStates(world, cursor)
  if (kind === 'corner') return { 'minecraft:corner': stairCorner(world, cursor, block) }
  const out = {}
  for (const [side, [dx, dz]] of Object.entries(SIDES)) {
    out['minecraft:connection_' + side] = kind === 'redstone'
      ? dustConnection(world, cursor, side)
      : connects(block, world.getBlock(cursor.offset(dx, 0, dz))) ? '1' : '0'
  }
  return out
}

// extra: properties the block has at its position besides its state's (from its neighbours, its block entity)
function matchProperties (block, properties, extra) {
  if (!properties) { return true }

  properties = parseProperties(properties)
  const blockProps = extra ? { ...block.getProperties(), ...extra } : block.getProperties()
  if (properties.OR) {
    return properties.OR.some((or) => matchProperties(block, or, extra))
  }
  for (const prop in blockProps) {
    if (typeof properties[prop] === 'string' && !properties[prop].split('|').some((value) => value === blockProps[prop] + '')) {
      return false
    }
  }
  return true
}

function getModelVariants (block, blockStates, extra) {
  // the air blocks render nothing. Enumerate them - a substring/suffix test also matches e.g. "*_stairs".
  if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') return []
  const state = blockStates[block.name] ?? blockStates.missing_texture
  if (!state) return []
  if (state.variants) {
    for (const [properties, variant] of Object.entries(state.variants)) {
      if (!matchProperties(block, properties, extra)) continue
      if (variant instanceof Array) return [variant[0]]
      return [variant]
    }
  }
  if (state.multipart) {
    const parts = state.multipart.filter(multipart => matchProperties(block, multipart.when, extra))
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

module.exports = { getSectionGeometry }
