// A Bedrock particle effect (a pack's particles/<name>.json: { format_version, particle_effect: { description,
// curves, events, components } }) compiled once: its Molang into closures (molang.js), its components into what an
// emitter (emitter.js) runs. The format is the game's, as Snowstorm edits it.
//
// The components it runs:
//  - emitter: emitter_local_space, emitter_initialization, emitter_rate_instant / steady / manual,
//    emitter_lifetime_once / looping / expression, emitter_lifetime_events, emitter_shape_point / sphere / box / disc /
//    custom / entity_aabb
//  - particle: particle_initial_speed, particle_initial_spin, particle_initialization, particle_motion_dynamic,
//    particle_motion_parametric, particle_motion_collision (against a ground plane the caller gives),
//    particle_lifetime_expression, particle_lifetime_events, particle_kill_plane, particle_expire_if_in_blocks /
//    not_in_blocks (with blocks the caller looks up), particle_appearance_billboard, particle_appearance_tinting,
//    particle_appearance_lighting
// Any other is listed in `unsupported`, and left out.
const { compile } = require('../entity/molang')
const { compileCurve } = require('./curves')

const COMPONENTS = new Set([
  'emitter_local_space', 'emitter_initialization', 'emitter_rate_instant', 'emitter_rate_steady', 'emitter_rate_manual',
  'emitter_lifetime_once', 'emitter_lifetime_looping', 'emitter_lifetime_expression', 'emitter_lifetime_events',
  'emitter_shape_point', 'emitter_shape_sphere', 'emitter_shape_box', 'emitter_shape_disc', 'emitter_shape_custom',
  'emitter_shape_entity_aabb', 'particle_initial_speed', 'particle_initial_spin', 'particle_initialization',
  'particle_motion_dynamic', 'particle_motion_parametric', 'particle_motion_collision', 'particle_lifetime_expression',
  'particle_lifetime_events', 'particle_kill_plane', 'particle_expire_if_in_blocks', 'particle_expire_if_not_in_blocks',
  'particle_appearance_billboard', 'particle_appearance_tinting', 'particle_appearance_lighting'
])

// the materials of the game's particles; another draws as particles_alpha
const MATERIALS = new Set(['particles_alpha', 'particles_blend', 'particles_add', 'particles_opaque'])

const FACING = new Set(['rotate_xyz', 'rotate_y', 'lookat_xyz', 'lookat_y', 'lookat_direction', 'direction_x', 'direction_y',
  'direction_z', 'emitter_transform_xy', 'emitter_transform_xz', 'emitter_transform_yz'])

// newer packs give Molang of a version of its own: { expression, version }; as plain Molang
function plain (value) {
  if (Array.isArray(value)) return value.map(plain)
  if (!value || typeof value !== 'object') return value
  const keys = Object.keys(value)
  if (keys.length === 2 && 'expression' in value && 'version' in value) return value.expression
  return Object.fromEntries(keys.map(k => [k, plain(value[k])]))
}

const expr = (e, fallback = 0) => compile(e ?? fallback)
// [x, y, z] of Molang, one expression for all three, or null
function vec3 (spec, fallback = null) {
  if (spec == null) return fallback
  if (Array.isArray(spec)) return [0, 1, 2].map(i => compile(spec[i] ?? 0))
  const f = compile(spec)
  return [f, f, f]
}
function vec2 (spec, fallback) {
  if (spec == null) return fallback
  if (Array.isArray(spec)) return [compile(spec[0] ?? 0), compile(spec[1] ?? spec[0] ?? 0)]
  const f = compile(spec)
  return [f, f]
}
// an event name, or several
const names = e => [e].flat().filter(n => typeof n === 'string')
const yes = v => v === true || v === 'true' || v === 1

// a colour: '#AARRGGBB', '#RRGGBB', or [r, g, b, a?] of Molang -> four closures
function color (spec) {
  if (typeof spec === 'string' && spec.startsWith('#')) {
    let hex = spec.slice(1)
    if (hex.length === 6) hex = 'ff' + hex
    const n = parseInt(hex, 16)
    const c = Number.isFinite(n) ? [(n >>> 16) & 255, (n >>> 8) & 255, n & 255, (n >>> 24) & 255].map(v => v / 255) : [1, 1, 1, 1]
    return c.map(v => compile(v))
  }
  if (Array.isArray(spec)) return [0, 1, 2, 3].map(i => compile(spec[i] ?? 1))
  if (spec && typeof spec === 'object') return ['r', 'g', 'b', 'a'].map(k => compile(spec[k] ?? 1))
  return [1, 1, 1, 1].map(v => compile(v))
}

// particle_appearance_tinting: a colour, or a gradient over an interpolant ({ "0.0": colour, ... } or a list, spread
// evenly from 0 to 1) -> { color } | { stops: [{ at, color }], interpolant }
function tinting (c) {
  const spec = c?.color
  if (spec && typeof spec === 'object' && !Array.isArray(spec) && spec.gradient) {
    const g = spec.gradient
    const stops = Array.isArray(g)
      ? g.map((col, i) => ({ at: g.length > 1 ? i / (g.length - 1) : 0, color: color(col) }))
      : Object.entries(g).map(([at, col]) => ({ at: Number(at), color: color(col) })).filter(s => Number.isFinite(s.at))
    stops.sort((a, b) => a.at - b.at)
    return stops.length ? { stops, interpolant: expr(spec.interpolant) } : null
  }
  return { color: color(spec) }
}

function shape (kind, c) {
  const s = { kind, offset: vec3(c.offset), surface: yes(c.surface_only) }
  const dir = c.direction ?? 'outwards'
  s.direction = dir === 'inwards' || dir === 'outwards' ? dir : vec3(dir, null) ?? 'outwards'
  if (kind === 'sphere' || kind === 'disc') s.radius = expr(c.radius, 1)
  if (kind === 'box') s.half = vec3(c.half_dimensions, [0, 0, 0].map(v => compile(v)))
  if (kind === 'disc') {
    const normal = c.plane_normal ?? 'y'
    s.normal = typeof normal === 'string' ? vec3({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[normal.toLowerCase()] ?? [0, 1, 0]) : vec3(normal)
  }
  return s
}

function billboard (c) {
  const uv = c.uv ?? {}
  const book = uv.flipbook
  const tw = Number(uv.texture_width ?? 1) || 1
  const th = Number(uv.texture_height ?? 1) || 1
  const direction = c.direction ?? {}
  return {
    size: vec2(c.size, [compile(0.1), compile(0.1)]),
    facing: FACING.has(c.facing_camera_mode) ? c.facing_camera_mode : 'rotate_xyz',
    facingKnown: c.facing_camera_mode === undefined || FACING.has(c.facing_camera_mode),
    direction: {
      custom: direction.mode === 'custom' ? vec3(direction.custom_direction, null) : null,
      minSpeed: Number(direction.min_speed_threshold ?? 0.01)
    },
    textureWidth: tw,
    textureHeight: th,
    uv: vec2(uv.uv, [compile(0), compile(0)]),
    uvSize: vec2(uv.uv_size, [compile(tw), compile(th)]),
    flipbook: book
      ? {
          base: vec2(book.base_UV, [compile(0), compile(0)]),
          size: book.size_UV ? book.size_UV.map(Number) : null,
          step: (book.step_UV ?? [0, 0]).map(Number),
          fps: Number(book.frames_per_second ?? 1),
          maxFrame: expr(book.max_frame, 1),
          stretch: yes(book.stretch_to_lifetime),
          loop: yes(book.loop)
        }
      : null
  }
}

/**
 * A particle effect -> what emitters of it run: { identifier, material, texture, curves, events, emitter and
 * particle parts, unsupported: the components it has that are not run }. effect: the file's particle_effect, or the
 * whole file.
 */
function compileEffect (effect) {
  effect = plain(effect?.particle_effect ?? effect ?? {})
  const desc = effect.description ?? {}
  const render = desc.basic_render_parameters ?? {}
  const comps = {}
  const unsupported = []
  for (const [key, value] of Object.entries(effect.components ?? {})) {
    const name = key.replace(/^minecraft:/, '')
    if (COMPONENTS.has(name)) comps[name] = value ?? {}
    else unsupported.push(key)
  }
  const def = {
    identifier: desc.identifier,
    material: MATERIALS.has(render.material) ? render.material : 'particles_alpha',
    texture: render.texture ?? null,
    curves: Object.entries(effect.curves ?? {}).map(([k, c]) => compileCurve(k, c ?? {})).filter(Boolean),
    events: effect.events ?? {},
    unsupported
  }
  if (render.material && !MATERIALS.has(render.material)) unsupported.push('material ' + render.material)

  // ---- emitter ----
  const local = comps.emitter_local_space ?? {}
  def.local = { position: yes(local.position), rotation: yes(local.position) && yes(local.rotation), velocity: yes(local.velocity) }
  const init = comps.emitter_initialization ?? {}
  def.emitterInit = { creation: init.creation_expression ? compile(init.creation_expression) : null, update: init.per_update_expression ? compile(init.per_update_expression) : null }

  if (comps.emitter_rate_instant) def.rate = { kind: 'instant', count: expr(comps.emitter_rate_instant.num_particles, 10) }
  else if (comps.emitter_rate_steady) def.rate = { kind: 'steady', rate: expr(comps.emitter_rate_steady.spawn_rate, 1), max: expr(comps.emitter_rate_steady.max_particles, 50) }
  else def.rate = { kind: 'manual', max: expr(comps.emitter_rate_manual?.max_particles, 50) }

  if (comps.emitter_lifetime_once) def.lifetime = { kind: 'once', active: expr(comps.emitter_lifetime_once.active_time, 10) }
  else if (comps.emitter_lifetime_looping) def.lifetime = { kind: 'looping', active: expr(comps.emitter_lifetime_looping.active_time, 10), sleep: expr(comps.emitter_lifetime_looping.sleep_time, 0) }
  else {
    const c = comps.emitter_lifetime_expression ?? {}
    def.lifetime = { kind: 'expression', activation: expr(c.activation_expression, 1), expiration: expr(c.expiration_expression, 0) }
  }
  const events = comps.emitter_lifetime_events ?? {}
  def.emitterEvents = {
    creation: names(events.creation_event),
    expiration: names(events.expiration_event),
    timeline: Object.entries(events.timeline ?? {}).map(([t, e]) => [Number(t), names(e)]).filter(([t]) => Number.isFinite(t)).sort((a, b) => a[0] - b[0]),
    travel: Object.entries(events.travel_distance_events ?? {}).map(([d, e]) => [Number(d), names(e)]).filter(([d]) => Number.isFinite(d)).sort((a, b) => a[0] - b[0]),
    loopingTravel: (events.looping_travel_distance_events ?? []).map(l => ({ distance: Number(l.distance), events: names(l.effects) })).filter(l => l.distance > 0)
  }

  def.shape = shape('point', {})
  for (const kind of ['point', 'sphere', 'box', 'disc', 'custom', 'entity_aabb']) {
    if (comps['emitter_shape_' + kind]) def.shape = shape(kind, comps['emitter_shape_' + kind])
  }

  // ---- particles ----
  const speed = comps.particle_initial_speed
  def.speed = Array.isArray(speed) ? { vector: vec3(speed) } : { scalar: expr(speed, 0) }
  const spin = comps.particle_initial_spin ?? {}
  def.spin = { rotation: expr(spin.rotation), rate: expr(spin.rotation_rate) }
  const pinit = comps.particle_initialization ?? {}
  def.particleInit = {
    creation: pinit.creation_expression ? compile(pinit.creation_expression) : null,
    update: pinit.per_update_expression ? compile(pinit.per_update_expression) : null,
    render: pinit.per_render_expression ? compile(pinit.per_render_expression) : null
  }
  const dyn = comps.particle_motion_dynamic
  def.dynamic = dyn
    ? { acceleration: vec3(dyn.linear_acceleration), drag: expr(dyn.linear_drag_coefficient), rotationAcceleration: expr(dyn.rotation_acceleration), rotationDrag: expr(dyn.rotation_drag_coefficient) }
    : null
  const par = comps.particle_motion_parametric
  def.parametric = par
    ? { position: vec3(par.relative_position), direction: vec3(par.direction), rotation: par.rotation !== undefined ? expr(par.rotation) : null }
    : null
  const col = comps.particle_motion_collision
  def.collision = col
    ? {
        enabled: expr(col.enabled, 1),
        drag: Number(col.collision_drag ?? 0),
        restitution: Number(col.coefficient_of_restitution ?? 0),
        radius: Number(col.collision_radius ?? 0),
        expire: yes(col.expire_on_contact),
        events: (col.events ?? []).map(e => typeof e === 'string' ? { event: e, minSpeed: 2 } : { event: e.event, minSpeed: Number(e.min_speed ?? 2) }).filter(e => e.event)
      }
    : null
  const life = comps.particle_lifetime_expression
  def.particleLifetime = life
    ? { max: life.max_lifetime !== undefined ? expr(life.max_lifetime) : null, expiration: life.expiration_expression !== undefined ? expr(life.expiration_expression) : null }
    : { max: null, expiration: null }
  const pevents = comps.particle_lifetime_events ?? {}
  def.particleEvents = {
    creation: names(pevents.creation_event),
    expiration: names(pevents.expiration_event),
    timeline: Object.entries(pevents.timeline ?? {}).map(([t, e]) => [Number(t), names(e)]).filter(([t]) => Number.isFinite(t)).sort((a, b) => a[0] - b[0])
  }
  const plane = comps.particle_kill_plane
  def.killPlane = Array.isArray(plane) && plane.length >= 4 && plane.some(v => Number(v) !== 0) ? plane.slice(0, 4).map(Number) : null
  const blocks = list => (Array.isArray(list) ? list : []).map(b => typeof b === 'string' ? b.replace(/^minecraft:/, '') : b?.name?.replace(/^minecraft:/, '')).filter(Boolean)
  def.expireIn = comps.particle_expire_if_in_blocks ? new Set(blocks(comps.particle_expire_if_in_blocks)) : null
  def.expireOutside = comps.particle_expire_if_not_in_blocks ? new Set(blocks(comps.particle_expire_if_not_in_blocks)) : null

  def.billboard = comps.particle_appearance_billboard ? billboard(comps.particle_appearance_billboard) : null
  if (def.billboard && !def.billboard.facingKnown) unsupported.push('facing_camera_mode ' + comps.particle_appearance_billboard.facing_camera_mode)
  def.tint = comps.particle_appearance_tinting ? tinting(comps.particle_appearance_tinting) : null
  def.lit = !!comps.particle_appearance_lighting
  return def
}

module.exports = { compileEffect, COMPONENTS, MATERIALS }
