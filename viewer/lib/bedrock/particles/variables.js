// The variables the game gives an effect it spawns (besides the emitter's and particles' own, emitter.js), which the
// vanilla effects read: the viewer sets them all, from what it knows of the spawn, else to a value that shows the
// effect as the game would show it in a common case. The caller's own (spawn's `variables`) go over them.
//
//  - direction.x/y/z, direction_x/y/z: the spawn's direction (up without one): bubbles, crits, portals, conduits
//  - color.r/g/b/a: white (potions, spells, dust, leaves are drawn in their colour)
//  - aabb.x/y/z (half the width, the height, half the width), aabb_dimension_x/y and aabb_dimension.x/y (the width
//    and the height): the box of the entity it is on, else a block's
//  - emitter_texture_coordinate.u/v and emitter_texture_size.u/v (and the older emittertexturecoord,
//    emittertexturesize, texture_coord), surface_particle_texture_coordinate/size, dig_particle_texture_coordinate/size,
//    ground_particle_texture_coordinate/size: the cell of the block atlas (atlas.terrain) the particles of a block are
//    cut from: the cell the system was given (its `atlasCell`), else the whole texture
//  - surface_particle_tint, dig_particle_color, ground_particle_color (.r/g/b/a): white
//  - actor.direction_x/y/z, actor.speed: the dragon's breath, along the spawn's direction (+z without one), at 0.3 a tick
//  - cloud_lifetime, cloud_radius, particle_multiplier: a dragon breath cloud of 3 seconds and 3 blocks
//  - ground_particle_amount, ground_particle_initial_speed: a breeze's ground particles, 3 at 2.5 blocks a second
//  - note_color.r/g/b: a note block's lowest note (F#)
//  - plume_height (a geyser's) 5; particlecount, emitter_particles_count 10; velocity_scalar 1; rotation 0;
//    velocity.x/y/z, acceleration.x/y/z 0
// (particle_count is left to the effects, which have defaults of their own for it.)

const rgba = (name, [r, g, b, a] = [1, 1, 1, 1]) => ({ [name + '.r']: r, [name + '.g']: g, [name + '.b']: b, [name + '.a']: a })
const uv = (name, u, v) => ({ [name + '.u']: u, [name + '.v']: v })

/**
 * The game's variables for a spawn: direction (a unit THREE.Vector3, or null), box ({ width, height } of the entity it
 * is on, or null), cell ({ u, v, su, sv }: a block's cell of atlas.terrain, 0 to 1, or null)
 */
function gameVariables ({ direction = null, box = null, cell = null } = {}) {
  const d = direction ?? { x: 0, y: 1, z: 0 }
  const forward = direction ?? { x: 0, y: 0, z: 1 }
  const { width, height } = box ?? { width: 1, height: 1 }
  const at = cell ?? { u: 0, v: 0, su: 1, sv: 1 }
  const cells = {}
  for (const [coordinate, size] of [['emitter_texture_coordinate', 'emitter_texture_size'], ['emittertexturecoord', 'emittertexturesize'],
    ['surface_particle_texture_coordinate', 'surface_particle_texture_size'], ['dig_particle_texture_coordinate', 'dig_particle_texture_size'],
    ['ground_particle_texture_coordinate', 'ground_particle_texture_size'], ['texture_coord', null]]) {
    Object.assign(cells, uv(coordinate, at.u, at.v), size ? uv(size, at.su, at.sv) : {})
  }
  return {
    'direction.x': d.x,
    'direction.y': d.y,
    'direction.z': d.z,
    direction_x: d.x,
    direction_y: d.y,
    direction_z: d.z,
    ...rgba('color'),
    'aabb.x': width / 2,
    'aabb.y': height,
    'aabb.z': width / 2,
    aabb_dimension_x: width,
    aabb_dimension_y: height,
    'aabb_dimension.x': width,
    'aabb_dimension.y': height,
    ...cells,
    // (set, so that the effects that default them when they are not keep these)
    surface_particle_texture_coordinate: 1,
    surface_particle_texture_size: 1,
    surface_particle_tint: 1,
    ...rgba('surface_particle_tint'),
    ...rgba('dig_particle_color'),
    ...rgba('ground_particle_color'),
    'actor.direction_x': forward.x,
    'actor.direction_y': forward.y,
    'actor.direction_z': forward.z,
    'actor.speed': 0.3,
    cloud_lifetime: 3,
    cloud_radius: 3,
    particle_multiplier: 4,
    ground_particle_amount: 3,
    ground_particle_initial_speed: 2.5,
    'note_color.r': 0.35,
    'note_color.g': 0.91,
    'note_color.b': 0,
    plume_height: 5,
    particlecount: 10,
    emitter_particles_count: 10,
    velocity_scalar: 1,
    rotation: 0,
    'velocity.x': 0,
    'velocity.y': 0,
    'velocity.z': 0,
    'acceleration.x': 0,
    'acceleration.y': 0,
    'acceleration.z': 0
  }
}

module.exports = { gameVariables }
