// An emitter of a particle effect (definition.js) and its particles, as the game runs them: frame by frame, the
// emitter's lifetime, its rate and shape, and each particle's motion, lifetime and events.
//
// Molang runs against the emitter's variables, or a particle's, which are its emitter's beneath its own:
//  - variable.emitter_age, emitter_lifetime, emitter_random_1..4, entity_scale, and the effect's curves
//  - variable.particle_age, particle_lifetime, particle_random_1..4, for a particle's
// and the queries of the entity it is attached to, if any.
//
// Particles live in the world, or in the emitter's space with emitter_local_space (they move, and turn, with it). The
// emitter follows what it was spawned on (an entity, one of its locators) while it is bound to it.
const THREE = require('three')
const { num, truthy } = require('../entity/molang')

// the most particles one emitter keeps
const MAX_PARTICLES = 5000
// the queries of an effect on no entity, besides the caller's: an evoker's spell is the colour of its vex summoning
// (as queries.js answers for an evoker that has none of its own); any other is 0
const QUERIES = { 'spellcolor.r': 0.7, 'spellcolor.g': 0.7, 'spellcolor.b': 0.8, 'spellcolor.a': 1 }
const Y = new THREE.Vector3(0, 1, 0)
const AXES = { direction_x: new THREE.Vector3(1, 0, 0), direction_y: Y, direction_z: new THREE.Vector3(0, 0, 1) }

const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const turn = new THREE.Quaternion()

const ev = (f, ctx) => num(f(ctx))

// a random point of a unit sphere's surface
function onSphere (out) {
  const z = Math.random() * 2 - 1
  const a = Math.random() * Math.PI * 2
  const r = Math.sqrt(1 - z * z)
  return out.set(r * Math.cos(a), r * Math.sin(a), z)
}

class Emitter {
  /**
   * system: the ParticleSystem it is drawn by; def: its effect, compiled. options: { position, quaternion (its
   * transform in the world), follow ((position, quaternion) => whether it still has something to follow: updates its
   * transform each frame), entity (a BedrockEntity: its queries, its box), variables, preEffect (ctx => runs before it
   * starts), ground, duration (seconds after which it stops, whatever its lifetime) }
   */
  constructor (system, def, options = {}) {
    this.system = system
    this.def = def
    this.identifier = def.identifier
    this.entity = options.entity ?? null
    this.follow = options.follow ?? null
    this.ground = options.ground
    this.duration = options.duration ?? Infinity
    this.lived = 0
    this.position = new THREE.Vector3()
    this.quaternion = new THREE.Quaternion()
    if (options.position) this.position.set(options.position.x, options.position.y, options.position.z)
    if (options.quaternion) this.quaternion.copy(options.quaternion)
    this.velocity = new THREE.Vector3()
    this.particles = []
    this.vars = { ...(options.variables ?? {}) }
    this.ctx = { variables: this.vars, temp: {}, context: {}, query: (name, args) => this.query(name, args) }
    this.age = 0
    this.active = false
    // (a looping one sleeping: the age it wakes at)
    this.wakes = Infinity
    this.expired = false
    this.done = false
    this.carry = 0
    this.timeline = 0
    this.travelled = 0
    this.travelIndex = 0
    this.loopTravel = def.emitterEvents.loopingTravel.map(() => 0)
    this.start(options.preEffect)
  }

  // ---- Molang --------------------------------------------------------------------------------------------------------

  query (name, args) {
    if (this.entity?.query) return this.entity.query(name, args)
    return this.system?.query?.(name, args) ?? QUERIES[name] ?? 0
  }

  // the effect's curves, against the variables in ctx
  curves (vars) {
    const curves = this.def.curves
    if (!curves.length) return
    this.ctx.variables = vars
    for (const curve of curves) vars[curve.name] = curve.evaluate(this.ctx)
  }

  run (f, vars = this.vars) {
    if (!f) return 0
    this.ctx.variables = vars
    this.ctx.temp = {}
    return f(this.ctx)
  }

  // ---- the emitter -------------------------------------------------------------------------------------------------

  start (preEffect) {
    const v = this.vars
    for (let i = 1; i <= 4; i++) v['emitter_random_' + i] = Math.random()
    v.emitter_age = 0
    v.entity_scale = v.entity_scale ?? this.entity?.modelScale?.() ?? 1
    this.follow?.(this.position, this.quaternion)
    this.previous = this.position.clone()
    this.curves(v)
    if (preEffect) {
      this.ctx.variables = v
      preEffect(this.ctx)
    }
    this.run(this.def.emitterInit.creation)
    this.fire(this.def.emitterEvents.creation, null)
    const life = this.def.lifetime
    if (life.kind === 'expression') {
      v.emitter_lifetime = 0
      if (truthy(this.run(life.activation))) this.activate()
    } else {
      this.activate()
    }
  }

  // it starts emitting: its age from 0 (or what a frame ran past its loop's start), its instant particles
  activate (age = 0) {
    const life = this.def.lifetime
    this.active = true
    this.age = Math.max(0, age)
    this.timeline = 0
    this.vars.emitter_age = this.age
    if (life.kind !== 'expression') this.vars.emitter_lifetime = ev(life.active, this.ctx)
    if (this.def.rate.kind === 'instant') this.spawn(Math.round(num(this.run(this.def.rate.count))))
  }

  // no more particles: it is gone once the ones it has are
  expire () {
    if (this.expired) return
    this.expired = true
    this.active = false
    this.fire(this.def.emitterEvents.expiration, null)
  }

  /** It stops emitting; its particles live on to their ends. */
  stop () {
    this.expire()
  }

  /** It is gone at once, with its particles. */
  kill () {
    this.expire()
    this.particles.length = 0
    this.done = true
  }

  /**
   * count particles of it now (emitter_rate_manual; or more of any), at its shape's places, or at `at` (a position in
   * the world): an event's particle. velocity: a velocity they start with besides
   */
  emit (count = 1, at = null, velocity = null) {
    this.spawn(count, at, velocity)
  }

  update (dt) {
    if (this.done) return
    const def = this.def
    const v = this.vars
    // where it is now
    if (this.follow && !this.expired && !this.follow(this.position, this.quaternion)) this.expire()
    this.lived += dt
    if (this.lived >= this.duration) this.expire()
    if (dt > 0) this.velocity.subVectors(this.position, this.previous).divideScalar(dt)
    const moved = this.position.distanceTo(this.previous)
    this.previous.copy(this.position)

    if (!this.expired) {
      const life = def.lifetime
      // (a looping one's age runs on as it sleeps)
      if (this.active || life.kind === 'looping') this.age += dt
      v.emitter_age = this.age
      this.curves(v)
      this.run(def.emitterInit.update)
      if (life.kind === 'expression') {
        if (truthy(this.run(life.expiration))) this.expire()
        else {
          const on = truthy(this.run(life.activation))
          if (on && !this.active) this.activate()
          else if (!on) this.active = false
        }
      } else {
        if (this.active && this.age >= v.emitter_lifetime - 1e-9) {
          // the end of its active time: the timeline's last events, then it ends, or sleeps and loops
          this.timelineEvents(Infinity)
          if (life.kind === 'once') this.expire()
          else {
            this.active = false
            this.wakes = v.emitter_lifetime + Math.max(0, ev(life.sleep, this.ctx))
          }
        }
        if (!this.active && !this.expired && this.age >= this.wakes - 1e-9) this.activate(this.age - this.wakes)
      }
    }

    if (this.active) {
      this.timelineEvents(this.age)
      this.travel(moved)
      if (def.rate.kind === 'steady') {
        this.carry += Math.max(0, num(this.run(def.rate.rate))) * dt
        const n = Math.floor(this.carry)
        this.carry -= n
        const room = Math.max(0, Math.round(num(this.run(def.rate.max))) - this.particles.length)
        if (n > 0) this.spawn(Math.min(n, room))
      }
    }

    this.updateParticles(dt)
    if (this.expired && !this.particles.length) this.done = true
  }

  // the timeline's events up to `age`
  timelineEvents (age) {
    const timeline = this.def.emitterEvents.timeline
    while (this.timeline < timeline.length && timeline[this.timeline][0] <= age) {
      this.fire(timeline[this.timeline][1], null)
      this.timeline++
    }
  }

  travel (moved) {
    const events = this.def.emitterEvents
    if (!moved || (!events.travel.length && !events.loopingTravel.length)) return
    this.travelled += moved
    while (this.travelIndex < events.travel.length && events.travel[this.travelIndex][0] <= this.travelled) {
      this.fire(events.travel[this.travelIndex][1], null)
      this.travelIndex++
    }
    events.loopingTravel.forEach((l, i) => {
      this.loopTravel[i] += moved
      while (this.loopTravel[i] >= l.distance) {
        this.loopTravel[i] -= l.distance
        this.fire(l.events, null)
      }
    })
  }

  // ---- particles ---------------------------------------------------------------------------------------------------

  // a place and a direction of its shape, in its space (before the emitter's turn)
  shapePoint (vars, pos, dir) {
    const shape = this.def.shape
    const ctx = this.ctx
    ctx.variables = vars
    pos.set(0, 0, 0)
    let middle = null
    switch (shape.kind) {
      case 'sphere': {
        const r = ev(shape.radius, ctx)
        onSphere(pos).multiplyScalar(shape.surface ? r : r * Math.cbrt(Math.random()))
        break
      }
      case 'box': case 'entity_aabb': {
        let hx, hy, hz
        if (shape.kind === 'box') {
          hx = ev(shape.half[0], ctx); hy = ev(shape.half[1], ctx); hz = ev(shape.half[2], ctx)
        } else {
          // the entity's box (else a block's), whose middle is half its height above its feet, wherever the emitter
          // is; the box is the world's way round, however the emitter turns
          const box = this.entity?.aabb?.() ?? { width: 1, height: 1 }
          hx = hz = box.width / 2
          hy = box.height / 2
          const feet = this.entity?.object ? this.entity.object.getWorldPosition(v1) : v1.copy(this.position)
          turn.copy(this.quaternion).invert()
          middle = v2.set(feet.x - this.position.x, feet.y + hy - this.position.y, feet.z - this.position.z).applyQuaternion(turn)
        }
        pos.set((Math.random() * 2 - 1) * hx, (Math.random() * 2 - 1) * hy, (Math.random() * 2 - 1) * hz)
        if (shape.surface) {
          // on one of its faces
          const axis = Math.floor(Math.random() * 3)
          pos.setComponent(axis, (Math.random() < 0.5 ? -1 : 1) * [hx, hy, hz][axis])
        }
        if (middle) pos.applyQuaternion(turn)
        break
      }
      case 'disc': {
        const r = ev(shape.radius, ctx)
        const a = Math.random() * Math.PI * 2
        const d = shape.surface ? r : r * Math.sqrt(Math.random())
        pos.set(Math.cos(a) * d, 0, Math.sin(a) * d)
        // the disc's plane turned to its normal
        v1.set(ev(shape.normal[0], ctx), ev(shape.normal[1], ctx), ev(shape.normal[2], ctx))
        if (v1.lengthSq() > 0) pos.applyQuaternion(turn.setFromUnitVectors(Y, v1.normalize()))
        break
      }
    }
    // the direction: away from its middle, towards it, or as said
    if (shape.direction === 'outwards' || shape.direction === 'inwards') {
      if (shape.kind === 'point' || shape.kind === 'custom' || pos.lengthSq() === 0) onSphere(dir)
      else dir.copy(pos).normalize()
      if (shape.direction === 'inwards') dir.negate()
    } else {
      dir.set(ev(shape.direction[0], ctx), ev(shape.direction[1], ctx), ev(shape.direction[2], ctx))
      if (dir.lengthSq() > 0) dir.normalize()
    }
    if (middle) pos.add(middle)
    if (shape.offset) pos.add(v1.set(ev(shape.offset[0], ctx), ev(shape.offset[1], ctx), ev(shape.offset[2], ctx)))
  }

  spawn (count, at = null, velocity = null) {
    const def = this.def
    const local = def.local
    const pos = new THREE.Vector3()
    const dir = new THREE.Vector3()
    for (let n = 0; n < count && this.particles.length < MAX_PARTICLES; n++) {
      const vars = Object.create(this.vars)
      for (let i = 1; i <= 4; i++) vars['particle_random_' + i] = Math.random()
      vars.particle_age = 0
      vars.particle_lifetime = 0
      const p = { vars, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ox: 0, oy: 0, oz: 0, rot: 0, spin: 0, age: 0, lifetime: Infinity, timeline: 0, side: 0, dx: 0, dy: 0, dz: 0, contact: false }
      const ctx = this.ctx
      ctx.variables = vars
      // its lifetime first: what follows may read it
      if (def.particleLifetime.max) p.lifetime = ev(def.particleLifetime.max, ctx)
      vars.particle_lifetime = Number.isFinite(p.lifetime) ? p.lifetime : 0
      this.curves(vars)
      this.shapePoint(vars, pos, dir)
      // its speed along the direction, or its velocity
      let vx, vy, vz
      if (def.speed.vector) {
        vx = ev(def.speed.vector[0], ctx); vy = ev(def.speed.vector[1], ctx); vz = ev(def.speed.vector[2], ctx)
      } else {
        const s = ev(def.speed.scalar, ctx)
        vx = dir.x * s; vy = dir.y * s; vz = dir.z * s
      }
      dir.set(vx, vy, vz)
      // into its space: the world (where the emitter is now), or the emitter's, turned or not
      if (!local.rotation) {
        pos.applyQuaternion(this.quaternion)
        dir.applyQuaternion(this.quaternion)
      }
      if (at) {
        // an event's particle: there, wherever its emitter is
        pos.set(at.x, at.y, at.z)
        if (local.position) pos.sub(this.position)
        if (local.rotation) pos.applyQuaternion(turn.copy(this.quaternion).invert())
      } else if (!local.position) {
        pos.add(this.position)
      }
      // where its emitter was (an event's particle: where it was made), which its parametric motion and kill plane are
      // from
      if (at && !local.position) { p.ox = at.x; p.oy = at.y; p.oz = at.z } else if (!local.position) { p.ox = this.position.x; p.oy = this.position.y; p.oz = this.position.z }
      if (local.velocity) {
        v1.copy(this.velocity)
        if (local.rotation) v1.applyQuaternion(turn.copy(this.quaternion).invert())
        if (local.position) v1.set(0, 0, 0) // (it moves with the emitter already)
        dir.add(v1)
      }
      if (velocity) dir.add(velocity)
      p.x = pos.x; p.y = pos.y; p.z = pos.z
      p.vx = dir.x; p.vy = dir.y; p.vz = dir.z
      if (dir.lengthSq() > 0) { v2.copy(dir).normalize(); p.dx = v2.x; p.dy = v2.y; p.dz = v2.z }
      ctx.variables = vars
      p.rot = ev(def.spin.rotation, ctx)
      p.spin = ev(def.spin.rate, ctx)
      if (def.killPlane) p.side = Math.sign(this.planeSide(p))
      this.run(def.particleInit.creation, vars)
      this.particles.push(p)
      this.fire(def.particleEvents.creation, p)
    }
    this.ctx.variables = this.vars
  }

  // the kill plane's value at a particle, in the emitter's space
  planeSide (p) {
    const [a, b, c, d] = this.def.killPlane
    return a * (p.x - p.ox) + b * (p.y - p.oy) + c * (p.z - p.oz) + d
  }

  updateParticles (dt) {
    const def = this.def
    const ctx = this.ctx
    const list = this.particles
    const blockAt = this.system?.blockAt
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const vars = p.vars
      p.age += dt
      vars.particle_age = p.age
      this.curves(vars)
      this.run(def.particleInit.update, vars)
      ctx.variables = vars
      let dead = p.age >= p.lifetime || (def.particleLifetime.expiration && truthy(def.particleLifetime.expiration(ctx)))
      if (!dead) {
        this.move(p, dt)
        if (def.killPlane) {
          // it crossed the plane (one made on it takes the side it leaves it to)
          const side = Math.sign(this.planeSide(p))
          if (!p.side) p.side = side
          else if (side && side !== p.side) dead = true
        }
        if (def.collision && this.collide(p, dt)) dead = true
        if ((def.expireIn || def.expireOutside) && blockAt) {
          const name = String(blockAt(this.worldPosition(p, v1)) ?? 'air').replace(/^minecraft:/, '')
          if ((def.expireIn && def.expireIn.has(name)) || (def.expireOutside && !def.expireOutside.has(name))) dead = true
        }
        const timeline = def.particleEvents.timeline
        while (p.timeline < timeline.length && timeline[p.timeline][0] <= p.age) this.fire(timeline[p.timeline++][1], p)
      }
      if (dead) {
        this.fire(def.particleEvents.expiration, p)
        list[i] = list[list.length - 1]
        list.pop()
        i--
      }
    }
    ctx.variables = this.vars
  }

  move (p, dt) {
    const def = this.def
    const ctx = this.ctx
    const dyn = def.dynamic
    if (def.parametric?.position) {
      // where it is, from where the emitter was
      const f = def.parametric.position
      p.x = p.ox + ev(f[0], ctx); p.y = p.oy + ev(f[1], ctx); p.z = p.oz + ev(f[2], ctx)
    } else {
      if (dyn) {
        const drag = ev(dyn.drag, ctx)
        const acc = dyn.acceleration
        p.vx += ((acc ? ev(acc[0], ctx) : 0) - drag * p.vx) * dt
        p.vy += ((acc ? ev(acc[1], ctx) : 0) - drag * p.vy) * dt
        p.vz += ((acc ? ev(acc[2], ctx) : 0) - drag * p.vz) * dt
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
    }
    if (def.parametric?.direction) {
      const f = def.parametric.direction
      p.vx = ev(f[0], ctx); p.vy = ev(f[1], ctx); p.vz = ev(f[2], ctx)
    }
    if (def.parametric?.rotation) {
      p.rot = ev(def.parametric.rotation, ctx)
    } else {
      if (dyn) p.spin += (ev(dyn.rotationAcceleration, ctx) - ev(dyn.rotationDrag, ctx) * p.spin) * dt
      p.rot += p.spin * dt
    }
  }

  // against the ground plane (a world y), if there is one: true when it expires on contact
  collide (p, dt) {
    const c = this.def.collision
    const ground = this.ground ?? this.system?.ground
    if (ground == null || !truthy(c.enabled(this.ctx))) return false
    const below = this.def.local.position ? this.position.y : 0
    const floor = ground + c.radius - below
    if (p.y > floor) {
      p.contact = false
      return false
    }
    if (p.vy < 0 || !p.contact) {
      const speed = Math.hypot(p.vx, p.vy, p.vz)
      for (const e of c.events) if (speed >= e.minSpeed) this.fire([e.event], p)
      if (c.expire) return true
      p.vy = -p.vy * c.restitution
    }
    p.y = floor
    p.contact = true
    if (c.drag) {
      // it slows along the ground
      const h = Math.hypot(p.vx, p.vz)
      const slower = Math.max(0, h - c.drag * dt)
      if (h > 0) { p.vx *= slower / h; p.vz *= slower / h }
    }
    return false
  }

  // a particle's place in the world
  worldPosition (p, out) {
    out.set(p.x, p.y, p.z)
    if (this.def.local.rotation) out.applyQuaternion(this.quaternion)
    if (this.def.local.position) out.add(this.position)
    return out
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  // the effect's events by name, of a particle (null: of the emitter)
  fire (list, particle) {
    if (!list.length || !this.system) return
    for (const name of list) {
      const event = this.def.events[name]
      if (event) this.system.event(this, event, particle)
    }
  }

  // ---- drawing -----------------------------------------------------------------------------------------------------

  /**
   * Its particles' quads into the batch, facing the camera as the billboard says. view: { position, right, up } of
   * the camera (world). light: what the lit ones are lit by.
   */
  draw (batch, view, light) {
    const def = this.def
    const bb = def.billboard
    if (!bb || !this.particles.length) return
    const ctx = this.ctx
    const pos = v1
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const rgba = [1, 1, 1, 1]
    const uv = [0, 0, 1, 1]
    for (const p of this.particles) {
      ctx.variables = p.vars
      if (def.particleInit.render) this.run(def.particleInit.render, p.vars)
      ctx.variables = p.vars
      const sx = ev(bb.size[0], ctx)
      const sy = ev(bb.size[1], ctx)
      if (sx === 0 && sy === 0) continue
      this.worldPosition(p, pos)
      this.facing(p, pos, view, right, up, normal)
      // turned in its plane by its rotation (degrees)
      if (p.rot) {
        const a = p.rot * Math.PI / 180
        const c = Math.cos(a)
        const s = Math.sin(a)
        v2.copy(right).multiplyScalar(c).addScaledVector(up, s)
        up.multiplyScalar(c).addScaledVector(right, -s)
        right.copy(v2)
      }
      right.multiplyScalar(sx)
      up.multiplyScalar(sy)
      this.uv(p, uv)
      this.tint(p, rgba)
      if (def.lit) { rgba[0] *= light; rgba[1] *= light; rgba[2] *= light }
      batch.quad(pos, right, up, uv, rgba)
    }
    ctx.variables = this.vars
  }

  // the axes of a particle's quad (unit length): right and up, and the normal they face
  facing (p, pos, view, right, up, normal) {
    const mode = this.def.billboard.facing
    switch (mode) {
      case 'rotate_xyz':
        right.copy(view.right)
        up.copy(view.up)
        return
      case 'rotate_y':
        right.set(view.right.x, 0, view.right.z)
        if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
        right.normalize()
        up.copy(Y)
        return
      case 'lookat_xyz': case 'lookat_y':
        normal.subVectors(view.position, pos)
        if (mode === 'lookat_y') normal.y = 0
        if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1)
        normal.normalize()
        right.crossVectors(Y, normal)
        if (right.lengthSq() < 1e-8) right.copy(view.right)
        right.normalize()
        up.crossVectors(normal, right)
        return
      case 'emitter_transform_xy': case 'emitter_transform_xz': case 'emitter_transform_yz':
        right.set(mode === 'emitter_transform_yz' ? 0 : 1, 0, mode === 'emitter_transform_yz' ? 1 : 0).applyQuaternion(this.quaternion)
        up.set(0, mode === 'emitter_transform_xz' ? 0 : 1, mode === 'emitter_transform_xz' ? 1 : 0).applyQuaternion(this.quaternion)
        return
    }
    // along its direction
    this.direction(p, normal)
    if (mode === 'lookat_direction') {
      // its up along it, its face turned to the camera about it
      up.copy(normal)
      v2.subVectors(view.position, pos)
      right.crossVectors(up, v2)
      if (right.lengthSq() < 1e-8) right.copy(view.right)
      right.normalize()
      return
    }
    turn.setFromUnitVectors(AXES[mode], normal)
    right.set(1, 0, 0).applyQuaternion(turn)
    up.set(0, 1, 0).applyQuaternion(turn)
  }

  // a particle's direction in the world (unit length): its custom direction, else its velocity's, or the last it had
  direction (p, out) {
    const bb = this.def.billboard
    const ctx = this.ctx
    if (bb.direction.custom) {
      const f = bb.direction.custom
      out.set(ev(f[0], ctx), ev(f[1], ctx), ev(f[2], ctx))
    } else {
      out.set(p.vx, p.vy, p.vz)
      if (out.length() > bb.direction.minSpeed) {
        out.normalize()
        p.dx = out.x; p.dy = out.y; p.dz = out.z
      } else out.set(p.dx, p.dy, p.dz)
    }
    if (this.def.local.rotation) out.applyQuaternion(this.quaternion)
    if (out.lengthSq() < 1e-8) out.set(0, 1, 0)
    return out.normalize()
  }

  // [u0, v0, u1, v1] of a particle, 0 to 1 over its texture: its uv, or its flipbook's frame at its age
  uv (p, out) {
    const bb = this.def.billboard
    const ctx = this.ctx
    let u, v, w, h
    const book = bb.flipbook
    if (book) {
      const max = ev(book.maxFrame, ctx)
      const fps = book.stretch && max > 0 && p.lifetime > 0 && Number.isFinite(p.lifetime) ? max / p.lifetime : book.fps
      let frame = Math.floor(p.age * fps)
      if (max > 0) frame = book.loop ? frame % Math.max(1, Math.floor(max)) : Math.min(frame, Math.max(0, Math.floor(max) - 1))
      u = ev(book.base[0], ctx) + book.step[0] * frame
      v = ev(book.base[1], ctx) + book.step[1] * frame
      w = book.size ? book.size[0] : ev(bb.uvSize[0], ctx)
      h = book.size ? book.size[1] : ev(bb.uvSize[1], ctx)
    } else {
      u = ev(bb.uv[0], ctx)
      v = ev(bb.uv[1], ctx)
      w = ev(bb.uvSize[0], ctx)
      h = ev(bb.uvSize[1], ctx)
    }
    out[0] = u / bb.textureWidth
    out[1] = v / bb.textureHeight
    out[2] = (u + w) / bb.textureWidth
    out[3] = (v + h) / bb.textureHeight
    return out
  }

  // [r, g, b, a] of a particle: its tint, or white
  tint (p, out) {
    const tint = this.def.tint
    const ctx = this.ctx
    out[0] = out[1] = out[2] = out[3] = 1
    if (!tint) return out
    if (tint.color) {
      for (let k = 0; k < 4; k++) out[k] = ev(tint.color[k], ctx)
      return out
    }
    const stops = tint.stops
    const t = ev(tint.interpolant, ctx)
    let i = 0
    while (i < stops.length - 1 && stops[i + 1].at <= t) i++
    const a = stops[i]
    const b = stops[Math.min(i + 1, stops.length - 1)]
    const f = b === a || t <= a.at ? 0 : Math.min(1, (t - a.at) / (b.at - a.at))
    for (let k = 0; k < 4; k++) {
      const x = ev(a.color[k], ctx)
      out[k] = f ? x + (ev(b.color[k], ctx) - x) * f : x
    }
    return out
  }
}

module.exports = { Emitter, MAX_PARTICLES }
