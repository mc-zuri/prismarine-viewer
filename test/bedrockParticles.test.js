/**
 * @jest-environment node
 */
/* eslint-env jest */
// Bedrock particle effects (viewer/lib/bedrock/particles): emitters of effects made up here (their rates, lifetimes
// and shapes, a flipbook, curves, events), effects started by an entity's animations, and the game's own dragon breath.
const THREE = require('three')
const mcAssets = require('minecraft-assets')
const { ParticleSystem } = require('../viewer/lib/bedrock/particles/system')
const { compileCurve } = require('../viewer/lib/bedrock/particles/curves')
const { BedrockEntity } = require('../viewer/lib/bedrock/entity/model')

// an effect of these components (named without minecraft:)
function effect (identifier, components, extra = {}) {
  return {
    description: { identifier, basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/particles' } },
    components: Object.fromEntries(Object.entries(components).map(([name, c]) => ['minecraft:' + name, c])),
    ...extra
  }
}
function particleSystem (...effects) {
  const particles = Object.fromEntries(effects.map(e => [e.description.identifier, e]))
  return new ParticleSystem(new THREE.Scene(), { particles, texture: () => null })
}
function camera () {
  const c = new THREE.PerspectiveCamera()
  c.position.set(0, 2, 10)
  c.lookAt(0, 0, 0)
  return c
}
// seconds of frames of step seconds
function run (system, seconds, step = 0.05) {
  const cam = camera()
  for (let i = 0; i < Math.round(seconds / step); i++) system.update(step, cam)
}
// particles that live long enough to be counted
const lasting = { particle_lifetime_expression: { max_lifetime: 100 }, particle_appearance_billboard: { size: [0.1, 0.1] } }

describe('emitters', () => {
  test('an instant rate makes its particles at once, a steady one so many a second up to its most, a manual one when told', () => {
    const system = particleSystem(
      effect('test:instant', { ...lasting, emitter_rate_instant: { num_particles: 7 }, emitter_lifetime_once: { active_time: 1 } }),
      effect('test:steady', { ...lasting, emitter_rate_steady: { spawn_rate: 20, max_particles: 15 }, emitter_lifetime_looping: { active_time: 10 } }),
      effect('test:manual', { ...lasting, emitter_rate_manual: { max_particles: 5 }, emitter_lifetime_expression: {} })
    )
    const instant = system.spawn('test:instant', { position: { x: 0, y: 0, z: 0 } })
    const steady = system.spawn('test:steady', { position: { x: 0, y: 0, z: 0 } })
    const manual = system.spawn('test:manual', { position: { x: 0, y: 0, z: 0 } })
    run(system, 0.5)
    expect(instant.particles).toHaveLength(7)
    expect(steady.particles).toHaveLength(10)
    expect(manual.particles).toHaveLength(0)
    run(system, 1.5)
    expect(steady.particles).toHaveLength(15)
    manual.emit(3)
    expect(manual.particles).toHaveLength(3)
    expect(system.count()).toBe(25)
  })

  test('lifetimes: once ends, looping comes round after its sleep, an expression starts and ends it', () => {
    const system = particleSystem(
      effect('test:once', { emitter_rate_steady: { spawn_rate: 10, max_particles: 100 }, emitter_lifetime_once: { active_time: 0.5 }, particle_lifetime_expression: { max_lifetime: 0.2 } }),
      effect('test:looping', { ...lasting, emitter_rate_instant: { num_particles: 4 }, emitter_lifetime_looping: { active_time: 0.2, sleep_time: 0.3 } }),
      effect('test:expression', { ...lasting, emitter_rate_steady: { spawn_rate: 10, max_particles: 100 }, emitter_lifetime_expression: { activation_expression: 'variable.on', expiration_expression: 'variable.off' } })
    )
    const once = system.spawn('test:once', { position: { x: 0, y: 0, z: 0 } })
    const looping = system.spawn('test:looping', { position: { x: 0, y: 0, z: 0 } })
    const expression = system.spawn('test:expression', { position: { x: 0, y: 0, z: 0 } })
    run(system, 0.4)
    expect(once.done).toBe(false)
    expect(expression.particles).toHaveLength(0)
    expression.vars.on = 1
    run(system, 0.65)
    // bursts at 0, 0.5 and 1 seconds
    expect(looping.particles).toHaveLength(12)
    expect(expression.particles.length).toBeGreaterThanOrEqual(6)
    // its active time over and its particles gone, it is too
    expect(once.done).toBe(true)
    expect(system.emitters).not.toContain(once)
    expression.vars.off = 1
    run(system, 0.1)
    expect(expression.expired).toBe(true)
    const before = expression.particles.length
    run(system, 0.5)
    expect(expression.particles).toHaveLength(before)
  })

  test('shapes: a sphere\'s surface, a box, a disc about its normal, a point offset; directions out, in and given', () => {
    const shaped = (id, shape, c, direction) => effect(id, { ...lasting, emitter_rate_instant: { num_particles: 50 }, emitter_lifetime_once: {}, ['emitter_shape_' + shape]: { ...c, direction }, particle_initial_speed: 1 })
    const system = particleSystem(
      shaped('test:sphere', 'sphere', { radius: 2, surface_only: true }, 'outwards'),
      shaped('test:inwards', 'sphere', { radius: 2, surface_only: true }, 'inwards'),
      shaped('test:box', 'box', { half_dimensions: [1, 2, 3] }, [0, 2, 0]),
      shaped('test:disc', 'disc', { radius: 1, plane_normal: 'x' }),
      shaped('test:point', 'point', { offset: [1, 2, 3] })
    )
    const at = { x: 10, y: 64, z: 10 }
    const emitters = Object.fromEntries(['sphere', 'inwards', 'box', 'disc', 'point'].map(s => [s, system.spawn('test:' + s, { position: at })]))
    const rel = p => new THREE.Vector3(p.x - at.x, p.y - at.y, p.z - at.z)
    for (const p of emitters.sphere.particles) {
      expect(rel(p).length()).toBeCloseTo(2)
      expect(new THREE.Vector3(p.vx, p.vy, p.vz).dot(rel(p).normalize())).toBeCloseTo(1)
    }
    for (const p of emitters.inwards.particles) expect(new THREE.Vector3(p.vx, p.vy, p.vz).dot(rel(p).normalize())).toBeCloseTo(-1)
    for (const p of emitters.box.particles) {
      const r = rel(p)
      expect(Math.abs(r.x) <= 1 && Math.abs(r.y) <= 2 && Math.abs(r.z) <= 3).toBe(true)
      // a direction given is the way they go, whatever its length
      expect([p.vx, p.vy, p.vz]).toEqual([0, 1, 0])
    }
    for (const p of emitters.disc.particles) {
      const r = rel(p)
      expect(r.x).toBeCloseTo(0)
      expect(Math.hypot(r.y, r.z)).toBeLessThanOrEqual(1 + 1e-9)
    }
    for (const p of emitters.point.particles) expect(rel(p).toArray()).toEqual([1, 2, 3])
  })

  test('a flipbook\'s frame at a particle\'s age: at its frame rate, stretched over its lifetime, looping', () => {
    const book = (id, flipbook, lifetime = 10) => effect(id, {
      emitter_rate_instant: { num_particles: 1 },
      emitter_lifetime_once: {},
      particle_lifetime_expression: { max_lifetime: lifetime },
      particle_appearance_billboard: { size: [0.1, 0.1], uv: { texture_width: 32, texture_height: 8, flipbook: { base_UV: [0, 0], size_UV: [8, 8], step_UV: [8, 0], frames_per_second: 4, max_frame: 4, ...flipbook } } }
    })
    const system = particleSystem(book('test:fps', {}), book('test:stretch', { stretch_to_lifetime: true }, 2), book('test:loop', { loop: true }))
    const emitters = ['fps', 'stretch', 'loop'].map(name => system.spawn('test:' + name, { position: { x: 0, y: 0, z: 0 } }))
    const uv = emitter => emitter.uv(emitter.particles[0], [])
    run(system, 0.6)
    // frame 2 of 4 across a texture of 32 by 8
    expect(uv(emitters[0])).toEqual([16 / 32, 0, 24 / 32, 1])
    run(system, 0.4)
    // a second of a 2 second life: half way through its 4 frames
    expect(uv(emitters[1])).toEqual([16 / 32, 0, 24 / 32, 1])
    run(system, 0.3)
    // 1.3 seconds at 4 a second is frame 5: 1 once round, the last one without looping
    expect(uv(emitters[2])).toEqual([8 / 32, 0, 16 / 32, 1])
    expect(uv(emitters[0])).toEqual([24 / 32, 0, 1, 1])
  })

  test('curves: linear, Catmull-Rom, Bézier and a Bézier chain, read as variables by the effect', () => {
    const at = (curve, t) => compileCurve('variable.c', { input: 'variable.t', horizontal_range: 2, ...curve }).evaluate({ variables: { t: t * 2 } })
    expect(at({ type: 'linear', nodes: [0, 1, 0] }, 0.25)).toBeCloseTo(0.5)
    expect(at({ type: 'linear', nodes: [0, 1, 0] }, 0.75)).toBeCloseTo(0.5)
    expect(at({ type: 'catmull_rom', nodes: [0, 0, 1, 1] }, 0.5)).toBeCloseTo(0.5)
    expect(at({ type: 'catmull_rom', nodes: [0, 0, 1, 1] }, 1)).toBeCloseTo(1)
    expect(at({ type: 'bezier', nodes: [0, 0, 1, 1] }, 0.5)).toBeCloseTo(0.5)
    expect(at({ type: 'bezier', nodes: [0, 1, 1, 0] }, 0.5)).toBeCloseTo(0.75)
    expect(at({ type: 'bezier_chain', nodes: { 0: { value: 0, slope: 0 }, 1: { value: 1, slope: 0 } } }, 0.5)).toBeCloseTo(0.5)
    expect(at({ type: 'bezier_chain', nodes: { 0: { value: 2 }, 0.5: { left_value: 4, right_value: 6 }, 1: { value: 8 } } }, 0.75)).toBeCloseTo(7)

    // the size of its particles over their lives: 0, up to 1 at half their life, then 0
    const system = particleSystem(effect('test:curve', {
      emitter_rate_instant: { num_particles: 1 },
      emitter_lifetime_once: {},
      particle_lifetime_expression: { max_lifetime: 2 },
      particle_appearance_billboard: { size: ['variable.size', 'variable.size'] }
    }, { curves: { 'variable.size': { type: 'linear', input: 'variable.particle_age', horizontal_range: 'variable.particle_lifetime', nodes: [0, 1, 0] } } }))
    const emitter = system.spawn('test:curve', { position: { x: 0, y: 0, z: 0 } })
    run(system, 0.5)
    expect(emitter.particles[0].vars.size).toBeCloseTo(0.5)
  })

  test('events: a particle\'s end starts another effect where it is; a sequence of Molang and a particle; a random pick', () => {
    const system = particleSystem(
      effect('test:pop', {
        emitter_rate_instant: { num_particles: 1 },
        emitter_lifetime_once: {},
        emitter_shape_point: { offset: [0, 1, 0] },
        particle_lifetime_expression: { max_lifetime: 0.1 },
        particle_lifetime_events: { expiration_event: 'burst' }
      }, { events: { burst: { particle_effect: { effect: 'test:child', type: 'emitter', pre_effect_expression: 'variable.from_event = 1;' } } } }),
      effect('test:start', { emitter_rate_manual: {}, emitter_lifetime_expression: {}, emitter_lifetime_events: { creation_event: ['begin', 'pick'] } }, {
        events: {
          begin: { sequence: [{ expression: 'variable.x = 3;' }, { particle_effect: { effect: 'test:child', type: 'particle' } }] },
          pick: { randomize: [{ weight: 0, expression: 'variable.picked = 1;' }, { weight: 1, expression: 'variable.picked = 2;' }] }
        }
      }),
      effect('test:child', { ...lasting, emitter_rate_instant: { num_particles: 2 }, emitter_lifetime_once: {} })
    )
    system.spawn('test:pop', { position: { x: 5, y: 64, z: 5 } })
    run(system, 0.2)
    const child = system.emitters.find(e => e.identifier === 'test:child')
    expect(child.position.toArray()).toEqual([5, 65, 5])
    expect(child.vars.from_event).toBe(1)
    expect(child.particles).toHaveLength(2)

    const start = system.spawn('test:start', { position: { x: 0, y: 0, z: 0 } })
    expect(start.vars.x).toBe(3)
    expect(start.vars.picked).toBe(2)
    // one particle of it, into the emitter events share
    expect(system.shared.get('test:child').particles).toHaveLength(1)
  })

  test('the components it does not run are counted and told once, and effects it has no definition of are left out', () => {
    const system = particleSystem(
      effect('test:a', { emitter_rate_instant: {}, emitter_lifetime_once: {}, particle_motion_teleport: {} }),
      effect('test:b', { emitter_rate_instant: {}, emitter_lifetime_once: {}, particle_motion_teleport: {} })
    )
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(system.spawn('test:a')).not.toBe(null)
    expect(system.spawn('test:b')).not.toBe(null)
    expect(system.spawn('test:nowhere')).toBe(null)
    expect(system.unsupported()).toEqual({ 'minecraft:particle_motion_teleport': 2 })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  test('its quads are drawn in one batch per texture and material, as many as there are particles', () => {
    const system = particleSystem(
      effect('test:a', { ...lasting, emitter_rate_instant: { num_particles: 300 }, emitter_lifetime_once: {} }),
      effect('test:b', { ...lasting, emitter_rate_instant: { num_particles: 20 }, emitter_lifetime_once: {} })
    )
    system.spawn('test:a', { position: { x: 0, y: 0, z: 0 } })
    system.spawn('test:b', { position: { x: 0, y: 0, z: 0 } })
    run(system, 0.05)
    expect(system.batches.size).toBe(1)
    const [batch] = system.batches.values()
    expect(batch.count).toBe(320)
    expect(batch.geometry.drawRange.count).toBe(320 * 6)
    system.dispose()
    expect(system.scene.children).toHaveLength(0)
  })
})

describe('effects on entities', () => {
  // an evoker-like entity: an arm with a hand locator, an animation whose timeline casts at half a second, and a
  // controller whose casting state has an effect of its own
  const assets = {
    entities: {
      'test:caster': {
        geometry: { default: 'geometry.caster' },
        particle_effects: { spell: 'test:spell' },
        animations: { cast: 'animation.test.cast', general: 'controller.animation.test.general' },
        scripts: { animate: ['cast', 'general'] }
      }
    },
    geometry: {
      'geometry.caster': { texture_width: 64, texture_height: 64, bones: [{ name: 'arm', pivot: [5, 22, 0], locators: { hand: [6, 12, 0] }, cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [0, 0] }] }] }
    },
    render_controllers: {},
    animations: { 'animation.test.cast': { animation_length: 1, particle_effects: { 0.5: { effect: 'spell', locator: 'hand' } } } },
    animation_controllers: {
      'controller.animation.test.general': { initial_state: 'default', states: { default: { transitions: [{ casting: 'query.is_casting' }] }, casting: { particle_effects: [{ effect: 'spell' }], transitions: [{ default: '!query.is_casting' }] } } }
    },
    materials: {},
    texture: () => null
  }
  const spell = effect('test:spell', { ...lasting, emitter_rate_steady: { spawn_rate: 10, max_particles: 50 }, emitter_lifetime_expression: {} })

  test('an animation\'s timeline starts an effect at a locator, which follows the entity', () => {
    const system = particleSystem(spell)
    const model = new BedrockEntity(assets, 'test:caster')
    model.particles = system
    model.object.position.set(10, 64, 10)
    // facing +z, as entities.js turns a yaw of 0
    model.object.rotation.y = Math.PI
    for (let i = 0; i < 9; i++) model.update(0.05)
    expect(system.emitters).toHaveLength(0)
    for (let i = 0; i < 3; i++) model.update(0.05)
    expect(system.emitters).toHaveLength(1)
    system.update(0.05, camera())
    // the hand: (6, 12, 0) pixels of the model, x mirrored, turned with the entity
    const emitter = system.emitters[0]
    expect(emitter.position.x).toBeCloseTo(10 + 6 / 16)
    expect(emitter.position.y).toBeCloseTo(64 + 12 / 16)
    expect(emitter.position.z).toBeCloseTo(10)
    model.object.position.x = 20
    system.update(0.05, camera())
    expect(emitter.position.x).toBeCloseTo(20 + 6 / 16)
    // gone with the entity
    model.dispose()
    expect(emitter.expired).toBe(true)
  })

  test('a controller\'s state starts its effects as it is entered, and stops them as it is left', () => {
    const system = particleSystem(spell)
    const model = new BedrockEntity(assets, 'test:caster')
    model.particles = system
    model.update(0.05)
    const before = system.emitters.length
    model.setState({ metadata: { flags: { evoker_spell: true } } })
    model.update(0.05)
    const casting = system.emitters.slice(before)
    expect(casting).toHaveLength(1)
    model.update(0.05)
    expect(system.emitters.slice(before)).toEqual(casting)
    model.setState({ metadata: { flags: {} } })
    model.update(0.05)
    expect(casting[0].expired).toBe(true)
  })
})

describe('the game\'s own effects', () => {
  // particles/dragon_breath_fire.json and dragon_breath_lingering.json of the vanilla resource pack (1.26.50)
  const fire = { format_version: '1.26.10', particle_effect: { description: { identifier: 'minecraft:dragon_breath_fire', basic_render_parameters: { material: 'particles_blend', texture: 'textures/particle/particles' } }, components: { 'minecraft:emitter_lifetime_once': {}, 'minecraft:emitter_rate_instant': { num_particles: 1 }, 'minecraft:emitter_shape_point': { direction: ['variable.actor.direction_x', 'variable.actor.direction_y', 'variable.actor.direction_z'] }, 'minecraft:particle_appearance_billboard': { size: [0.125, 0.125], facing_camera_mode: 'rotate_xyz', direction: { mode: 'derive_from_velocity', custom_direction: [0, 0, 0], min_speed_threshold: 0.1 }, uv: { texture_width: 128, texture_height: 128, uv: [0, 0], uv_size: [1, 1], flipbook: { base_UV: [40, 0], size_UV: [8, 8], step_UV: [8, 0], frames_per_second: 3, max_frame: 3, stretch_to_lifetime: true } } }, 'minecraft:particle_appearance_lighting': {}, 'minecraft:particle_appearance_tinting': { color: { gradient: { '0.000000': ['Math.random(0.7176, 0.8745)', 0, 'Math.random(0.8235, 0.9765)', 1] }, interpolant: 0 } }, 'minecraft:particle_initial_speed': 'variable.actor.speed * 20', 'minecraft:particle_lifetime_expression': { max_lifetime: 'Math.random(2.0, 3.0)' }, 'minecraft:particle_motion_collision': { collision_drag: 7.5, collision_radius: 0.5, events: [] }, 'minecraft:particle_motion_dynamic': { linear_acceleration: ['variable.particle_age < 0.5 ? 0.0 : Math.random(-0.05, 0.05)', 'variable.particle_age < 0.5 ? -9.8 : 1.0', 'variable.particle_age < 0.5 ? 0.0 : Math.random(-0.05, 0.05)'] } } } }
  const lingering = { format_version: '1.26.10', particle_effect: { description: { identifier: 'minecraft:dragon_breath_lingering', basic_render_parameters: { material: 'particles_blend', texture: 'textures/particle/particles' } }, components: { 'minecraft:emitter_lifetime_once': { active_time: 'variable.cloud_lifetime' }, 'minecraft:emitter_rate_instant': { num_particles: 'Math.max(variable.cloud_radius * variable.cloud_radius * variable.particle_multiplier, 2)' }, 'minecraft:emitter_shape_disc': { radius: 'variable.cloud_radius', direction: [0, 1, 0] }, 'minecraft:particle_appearance_billboard': { size: [0.125, 0.125], facing_camera_mode: 'rotate_xyz', direction: { mode: 'derive_from_velocity', custom_direction: [0, 0, 0], min_speed_threshold: 0.1 }, uv: { texture_width: 128, texture_height: 128, uv: [0, 0], uv_size: [1, 1], flipbook: { base_UV: [40, 0], size_UV: [8, 8], step_UV: [8, 0], frames_per_second: 3, max_frame: 3, stretch_to_lifetime: true } } }, 'minecraft:particle_appearance_lighting': {}, 'minecraft:particle_appearance_tinting': { color: { gradient: { '0.000000': [0.863, 0, 0.937, 1] }, interpolant: 0 } }, 'minecraft:particle_initial_speed': 0, 'minecraft:particle_lifetime_expression': { max_lifetime: 'Math.random(2.0, 3.25)' }, 'minecraft:particle_motion_dynamic': { linear_acceleration: [0, 0.75, 0] } } } }

  test('dragon breath: a breath falls to the ground and slows there, a lingering cloud rises from its disc', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const system = new ParticleSystem(new THREE.Scene(), { particles: { 'minecraft:dragon_breath_fire': fire.particle_effect, 'minecraft:dragon_breath_lingering': lingering }, texture: () => null }, { ground: 64 })
    const breaths = []
    let cloud = null
    let most = 0
    let touched = 0
    let later = []
    const cam = camera()
    for (let i = 0; i < 100; i++) {
      // a breath a tick for the first second, a block up, along +x (the game's variables: its direction)
      if (i < 20) breaths.push(system.spawn('minecraft:dragon_breath_fire', { position: { x: 0, y: 65, z: 0 }, direction: [1, 0, 0] }))
      if (i === 0) cloud = system.spawn('minecraft:dragon_breath_lingering', { position: { x: 0, y: 64, z: 0 }, variables: { cloud_lifetime: 5 } })
      system.update(0.05, cam)
      most = Math.max(most, system.count())
      for (const b of breaths) {
        for (const p of b.particles) {
          // (half a block of collision radius above the ground)
          expect(p.y).toBeGreaterThanOrEqual(64.5 - 1e-9)
          if (p.contact) touched++
        }
      }
      if (i === 30) later = { breath: breaths.flatMap(b => b.particles), cloud: [...cloud.particles] }
    }
    expect(most).toBeGreaterThan(30)
    expect(touched).toBeGreaterThan(0)
    // the breath went along +x; the cloud's 36 rose from the ground, over its disc
    expect(later.breath.length).toBeGreaterThan(0)
    for (const p of later.breath) expect(p.x).toBeGreaterThan(0)
    expect(later.cloud).toHaveLength(36)
    for (const p of later.cloud) {
      expect(p.y).toBeGreaterThan(64)
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(3 + 1e-9)
    }
    // by 5 seconds all are gone
    expect(system.count()).toBe(0)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // every effect of a version, from its minecraft-assets (skipped where it has none)
  const particles = (mcAssets.bedrockVersions ?? []).includes('1.26.51') ? mcAssets('bedrock_1.26.51').particles?.particles : null
  ;(particles ? test : test.skip)('1.26.51: each of its effects runs for 3 seconds, every component of them run', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const system = new ParticleSystem(new THREE.Scene(), { particles, texture: () => null }, { ground: 63 })
    const cam = camera()
    let drawn = 0
    for (const identifier of Object.keys(particles)) {
      const emitter = system.spawn(identifier, { position: { x: 0, y: 64, z: 0 }, direction: [0, 1, 0] })
      expect(emitter).not.toBe(null)
      // (those the game emits particles of itself: some of them)
      if (emitter.def.rate.kind === 'manual') emitter.emit(5)
      let most = 0
      for (let i = 0; i < 60; i++) {
        system.update(0.05, cam)
        most = Math.max(most, emitter.particles.length)
      }
      if (most) drawn++
      system.clear()
    }
    expect(Object.keys(particles).length).toBe(192)
    expect(drawn).toBeGreaterThan(180)
    expect(system.unsupported()).toEqual({})
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
