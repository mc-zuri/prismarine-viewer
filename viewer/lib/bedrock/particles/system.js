// Bedrock particle effects in a three.js scene: emitters of the effects a version's resource packs define (as
// Snowstorm edits them), run frame by frame and drawn in batches (render.js).
//
//   const system = new ParticleSystem(scene, assets)
//   const emitter = system.spawn('minecraft:basic_flame_particle', { position })
//   system.spawn('minecraft:evoker_spell', { entity: model, locator: 'left_hand' })   // on an entity, following it
//   emitter.stop()                    // it stops emitting; its particles live on
//   system.emit('minecraft:heart_particle', position)   // a particle of an effect the game emits itself (manual rate)
//   system.update(dt, camera)         // every frame
//   system.dispose()
//
// assets: { particles: { identifier: particle_effect }, texture (path) -> THREE.Texture | null } (the entity assets of
// bedrock/entity/assets.js). An effect it has no definition of is left out quietly; the components of an effect it
// does not run are counted (unsupported()) and told once each.
const THREE = require('three')
const { compileEffect } = require('./definition')
const { Emitter } = require('./emitter')
const { Batch } = require('./render')
const { compile } = require('../entity/molang')
const { gameVariables } = require('./variables')

// the most emitters running at once: more are not started
const MAX_EMITTERS = 2000
// the longest frame a step runs (a page that was hidden)
const MAX_STEP = 0.1

let white = null
// the texture of what has none to be drawn with (the game's atlases: atlas.terrain): white, the tint shows
function whiteTexture () {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat)
    white.needsUpdate = true
  }
  return white
}

class ParticleSystem {
  /**
   * options:
   *  - ground: a world y particles with motion collision land on
   *  - blockAt: position -> the name of the block there (particle_expire_if_in_blocks / not_in_blocks)
   *  - light: 0 to 1, what particles with appearance lighting are lit by
   *  - atlases: { 'atlas.terrain': THREE.Texture, 'atlas.items': ... }: the game's atlases some effects are drawn
   *    from (a block's breaking); without them those are drawn white, in their tint
   *  - atlasCell: { u, v, su, sv }: the cell of atlas.terrain (0 to 1) the particles of a block are cut from
   *  - query: (name, args) => value: the queries of the effects on no entity (undefined: as without; emitter.js)
   */
  constructor (scene, assets, options = {}) {
    this.scene = scene
    this.assets = assets
    this.ground = options.ground ?? null
    this.blockAt = options.blockAt ?? null
    this.light = options.light ?? 1
    this.atlases = options.atlases ?? {}
    this.atlasCell = options.atlasCell ?? null
    this.query = options.query ?? null
    this.definitions = new Map()
    this.emitters = []
    this.batches = new Map()
    // the emitters events put single particles into, by effect
    this.shared = new Map()
    this.missing = new Map()
    this.view = { position: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) }
  }

  // ---- effects -----------------------------------------------------------------------------------------------------

  has (identifier) {
    return !!this.assets?.particles?.[identifier]
  }

  // an effect, compiled once; null when there is none of that identifier
  definition (identifier) {
    if (this.definitions.has(identifier)) return this.definitions.get(identifier)
    const effect = this.assets?.particles?.[identifier]
    let def = null
    if (effect) {
      def = compileEffect(effect)
      def.identifier = identifier
      for (const name of def.unsupported) {
        const n = this.missing.get(name) ?? 0
        if (n === 0 && typeof console !== 'undefined') console.warn(`Bedrock particles: ${name} is not supported (${identifier}, and any other effect with it)`)
        this.missing.set(name, n + 1)
      }
    }
    this.definitions.set(identifier, def)
    return def
  }

  /** The components (and materials, facing modes) of the effects compiled so far that are not run: name -> effects. */
  unsupported () {
    return Object.fromEntries(this.missing)
  }

  /**
   * An emitter of an effect, started now; null for an effect there is no definition of (or too many emitters).
   * options:
   *  - position: where in the world (on an entity: from where its locator is, else its feet)
   *  - direction: [x, y, z] or {x, y, z}: the way it goes, which the game gives effects as variables (direction.x/y/z,
   *    actor.direction_x/y/z: variables.js)
   *  - entity: a BedrockEntity it is on: its queries, its box, and it follows it (with locator: one of its locators)
   *  - locator: the name of one of the entity's locators (bones may have them)
   *  - bind: false for one made where the entity (locator) is, which stays there
   *  - variables: its own variables to start with ({ name: value }, without variable.), over those the game gives
   *    (variables.js)
   *  - preEffect: Molang (or ctx => {}) run on it before it starts: pre_effect_script, pre_effect_expression
   *  - duration: seconds after which it stops, whatever its lifetime (an endless one the caller cannot stop)
   */
  spawn (identifier, options = {}) {
    const def = this.definition(identifier)
    if (!def || this.emitters.length >= MAX_EMITTERS) return null
    let direction = options.direction && (Array.isArray(options.direction) ? new THREE.Vector3(...options.direction) : new THREE.Vector3(options.direction.x, options.direction.y, options.direction.z))
    if (direction && direction.lengthSq() > 0) direction.normalize()
    else direction = null
    let follow = null
    const entity = options.entity ?? null
    // the game's variables, then the caller's
    const variables = { ...gameVariables({ direction, box: entity?.aabb?.() ?? null, cell: this.atlasCell }), ...(options.variables ?? {}) }
    if (entity?.locatorTransform) {
      const offset = options.position ? new THREE.Vector3(options.position.x, options.position.y, options.position.z) : null
      follow = (position, q) => {
        if (!entity.locatorTransform(options.locator, position, q)) return false
        if (offset) position.add(offset)
        return true
      }
    }
    const pre = options.preEffect
    const emitter = new Emitter(this, def, {
      position: follow ? null : options.position,
      entity,
      variables,
      follow,
      ground: options.ground,
      duration: options.duration,
      preEffect: typeof pre === 'function' ? pre : (pre ? ctx => compile(pre)(ctx) : null)
    })
    // made where the entity is, it stays there
    if (options.bind === false) emitter.follow = null
    this.emitters.push(emitter)
    return emitter
  }

  /**
   * count particles of an effect at a position, into an emitter of it that runs as long as particles are put in it:
   * as the game emits those of an effect of manual rate (a heart, a flame, a splash). variables: as spawn's; false
   * when there is no such effect.
   */
  emit (identifier, position, { count = 1, variables } = {}) {
    const shared = this.sharedEmitter(identifier)
    if (!shared || !position) return false
    if (variables) Object.assign(shared.vars, variables)
    shared.emit(count, position)
    return true
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  // an event of an effect (its emitter's, or a particle's): another effect, a sequence or a choice of events, Molang
  event (emitter, event, particle) {
    if (!event || typeof event !== 'object') return
    if (Array.isArray(event.sequence)) for (const e of event.sequence) this.event(emitter, e, particle)
    if (Array.isArray(event.randomize) && event.randomize.length) {
      const total = event.randomize.reduce((sum, e) => sum + Math.max(0, Number(e.weight ?? 1)), 0)
      let pick = Math.random() * total
      for (const e of event.randomize) {
        pick -= Math.max(0, Number(e.weight ?? 1))
        if (pick <= 0) { this.event(emitter, e, particle); break }
      }
    }
    if (event.expression) emitter.run(compile(event.expression), particle ? particle.vars : emitter.vars)
    const effect = event.particle_effect
    if (effect?.effect) this.eventEffect(emitter, effect, particle)
    // (sound_effect: no sounds here; log: nothing to log to)
  }

  // where an event happens: its particle, or its emitter
  eventPosition (emitter, particle) {
    return particle ? emitter.worldPosition(particle, new THREE.Vector3()) : emitter.position.clone()
  }

  eventEffect (emitter, { effect, type = 'emitter', pre_effect_expression: pre }, particle) {
    const at = this.eventPosition(emitter, particle)
    const preEffect = pre ? ctx => compile(pre)(ctx) : null
    if (type === 'particle' || type === 'particle_with_velocity') {
      // one particle of it, into the emitter of that effect events share
      const shared = this.sharedEmitter(effect)
      if (!shared) return
      if (preEffect) {
        shared.ctx.variables = shared.vars
        preEffect(shared.ctx)
      }
      let velocity = null
      if (type === 'particle_with_velocity' && particle) {
        velocity = new THREE.Vector3(particle.vx, particle.vy, particle.vz)
        if (emitter.def.local.rotation) velocity.applyQuaternion(emitter.quaternion)
      }
      shared.emit(1, at, velocity)
      return
    }
    const child = this.spawn(effect, { position: at, preEffect })
    if (!child || type !== 'emitter_bound') return
    // bound: it follows its parent emitter, where it was made on it
    const offset = at.clone().sub(emitter.position).applyQuaternion(emitter.quaternion.clone().invert())
    child.follow = (position, q) => {
      if (emitter.done) return false
      position.copy(offset).applyQuaternion(emitter.quaternion).add(emitter.position)
      q.copy(emitter.quaternion)
      return true
    }
  }

  sharedEmitter (identifier) {
    let shared = this.shared.get(identifier)
    if (shared && !shared.done) return shared
    const def = this.definition(identifier)
    if (!def) return null
    // it runs as long as events put particles in it (whatever its own lifetime and rate)
    shared = new Emitter(this, { ...def, rate: { kind: 'manual' }, lifetime: { kind: 'expression', activation: () => 1, expiration: () => 0 } }, { variables: gameVariables({ cell: this.atlasCell }) })
    this.shared.set(identifier, shared)
    this.emitters.push(shared)
    return shared
  }

  // ---- every frame ---------------------------------------------------------------------------------------------------

  /** Runs the emitters dt seconds on, and draws their particles facing camera (a THREE.Camera). */
  update (dt, camera) {
    dt = Math.min(Math.max(dt, 0), MAX_STEP)
    for (let i = 0; i < this.emitters.length; i++) {
      const emitter = this.emitters[i]
      try {
        emitter.update(dt)
      } catch (err) {
        // an effect whose Molang breaks is dropped
        if (typeof console !== 'undefined') console.warn(`Bedrock particles: ${emitter.identifier}: ${err.message}`)
        emitter.kill()
      }
    }
    this.emitters = this.emitters.filter(e => !e.done)
    for (const [id, shared] of this.shared) if (shared.done) this.shared.delete(id)
    this.draw(camera)
  }

  draw (camera) {
    const view = this.view
    if (camera) {
      camera.updateMatrixWorld()
      view.position.setFromMatrixPosition(camera.matrixWorld)
      const e = camera.matrixWorld.elements
      view.right.set(e[0], e[1], e[2]).normalize()
      view.up.set(e[4], e[5], e[6]).normalize()
    }
    for (const batch of this.batches.values()) batch.begin()
    for (const emitter of this.emitters) {
      if (!emitter.particles.length || !emitter.def.billboard) continue
      try {
        emitter.draw(this.batch(emitter.def), view, this.light)
      } catch (err) {
        if (typeof console !== 'undefined') console.warn(`Bedrock particles: ${emitter.identifier}: ${err.message}`)
        emitter.kill()
      }
    }
    for (const batch of this.batches.values()) batch.end()
  }

  // the batch of an effect's texture and material
  batch (def) {
    const key = def.material + '\n' + def.texture
    let batch = this.batches.get(key)
    if (!batch) {
      const texture = this.atlases[def.texture] ?? ((def.texture && this.assets?.texture?.(def.texture)) || whiteTexture())
      batch = new Batch(this.scene, def.material, texture)
      this.batches.set(key, batch)
    }
    return batch
  }

  /** How many particles there are now, of all emitters. */
  count () {
    return this.emitters.reduce((sum, e) => sum + e.particles.length, 0)
  }

  /** Every emitter gone at once (with spawned ones of entities: they start again as their entities say). */
  clear () {
    for (const emitter of this.emitters) emitter.kill()
    this.emitters = []
    this.shared.clear()
    for (const batch of this.batches.values()) {
      batch.begin()
      batch.end()
    }
  }

  dispose () {
    this.clear()
    for (const batch of this.batches.values()) batch.dispose()
    this.batches.clear()
  }
}

module.exports = { ParticleSystem }
