// Bedrock particle effects (a Bedrock version's assets' particles.json: each effect's texture, material and
// components, as particles/*.json have them), spawned at a position and drawn as camera-facing quads.
//
// The components drawn: emitter_initialization; emitter_rate_instant, _steady and _manual; emitter_lifetime_once,
// _looping and _expression; emitter_shape_point, _sphere, _box, _disc, _custom and _entity_aabb; particle_initialization;
// particle_initial_speed and _spin; particle_lifetime_expression; particle_motion_dynamic and _parametric;
// particle_appearance_billboard (its size, uv and flipbook) and _tinting (a colour or a gradient). Their Molang is
// evaluated per particle (./molang.js), with variable.particle_age, _lifetime, _random_1 - 4 and the emitter's.
const THREE = require('three')
const { compile } = require('./molang')
const { loadTexture, loadJSON } = globalThis.isElectron ? require('./utils.electron.js') : require('./utils')

const MAX_PER_EMITTER = 1000

const num = v => typeof v === 'number' && isFinite(v) ? v : 0

// a colour: '#AARRGGBB' / '#RRGGBB', or [r, g, b, a?] of 0..1 values (Molang)
function colorOf (c, scope) {
  if (typeof c === 'string' && c.startsWith('#')) {
    const hex = c.slice(1)
    const n = parseInt(hex, 16)
    if (hex.length === 8) return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, (n >>> 24 & 255) / 255]
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1]
  }
  if (Array.isArray(c)) {
    const [r = 1, g = 1, b = 1, a = 1] = c.map(e => num(compile(e)(scope)))
    return [r, g, b, a]
  }
  return [1, 1, 1, 1]
}

// a gradient's colour at t: { gradient: { stop: colour } or [colours, evenly spaced] }
function gradientAt (gradient, t, scope) {
  const stops = Array.isArray(gradient)
    ? gradient.map((c, i) => [gradient.length > 1 ? i / (gradient.length - 1) : 0, colorOf(c, scope)])
    : Object.entries(gradient).map(([k, c]) => [parseFloat(k), colorOf(c, scope)]).sort((a, b) => a[0] - b[0])
  if (!stops.length) return [1, 1, 1, 1]
  if (t <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]
      const [t1, c1] = stops[i]
      const f = (t - t0) / (t1 - t0 || 1)
      return c0.map((v, j) => v + (c1[j] - v) * f)
    }
  }
  return stops[stops.length - 1][1]
}

function randomInSphere (surface) {
  for (;;) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
    const l = v.length()
    if (l > 0 && l <= 1) return surface ? v.divideScalar(l) : v
  }
}

class Emitter {
  // effect: { texture, material, components }; at: where; options: { count (a manual emitter's particles), duration }
  constructor (effect, at, options, texturePath) {
    this.c = effect.components
    this.at = new THREE.Vector3(at.x, at.y, at.z)
    this.vars = { 'variable.emitter_age': 0 }
    for (let i = 1; i <= 4; i++) this.vars[`variable.emitter_random_${i}`] = Math.random()
    this.scope = { get: n => this.vars[n] ?? 0, set: (n, v) => { this.vars[n] = v } }
    const c = this.c
    this.run(c['minecraft:emitter_initialization']?.creation_expression, this.scope)

    const once = c['minecraft:emitter_lifetime_once']
    const looping = c['minecraft:emitter_lifetime_looping']
    const byExpression = c['minecraft:emitter_lifetime_expression']
    this.activeTime = options.duration ?? (once || looping ? num(this.ev((once ?? looping).active_time ?? 10, this.scope)) : byExpression ? Infinity : 10)
    this.expiration = byExpression?.expiration_expression
    this.vars['variable.emitter_lifetime'] = this.activeTime

    this.steady = c['minecraft:emitter_rate_steady']
    const instant = c['minecraft:emitter_rate_instant']
    const manual = c['minecraft:emitter_rate_manual']
    const max = this.steady?.max_particles ?? manual?.max_particles ?? 50
    this.max = Math.min(MAX_PER_EMITTER, Math.max(1, Math.round(num(this.ev(max, this.scope)))))
    this.age = 0
    this.toSpawn = 0
    this.particles = []
    if (instant) this.emit(Math.round(num(this.ev(instant.num_particles ?? 10, this.scope))))
    if (manual || (!instant && !this.steady)) this.emit(options.count ?? 1)
    if (!this.steady) this.activeTime = Math.min(this.activeTime, 0)

    const billboard = c['minecraft:particle_appearance_billboard'] ?? {}
    this.billboard = billboard
    const uv = billboard.uv ?? {}
    this.sheet = [uv.texture_width ?? 1, uv.texture_height ?? 1]

    // the quads: four corners a particle, drawn as many as are alive
    const capacity = this.max
    this.geometry = new THREE.BufferGeometry()
    this.positions = new Float32Array(capacity * 4 * 3)
    this.uvs = new Float32Array(capacity * 4 * 2)
    this.colors = new Float32Array(capacity * 4 * 4)
    const indices = []
    for (let i = 0; i < capacity; i++) indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4))
    this.geometry.setIndex(indices)
    this.geometry.setDrawRange(0, 0)
    const material = effect.material ?? 'particles_alpha'
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: material !== 'particles_opaque',
      alphaTest: material === 'particles_alpha' ? 0.5 : 0.01,
      depthWrite: material === 'particles_alpha' || material === 'particles_opaque',
      blending: material === 'particles_add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide
    })
    if (texturePath) {
      loadTexture(texturePath, texture => {
        texture.magFilter = THREE.NearestFilter
        texture.minFilter = THREE.NearestFilter
        this.material.map = texture
        this.material.needsUpdate = true
      })
    }
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
  }

  ev (expression, scope) {
    return compile(expression)(scope)
  }

  run (expression, scope) {
    for (const e of [].concat(expression ?? [])) compile(e)(scope)
  }

  vector (v, scope) {
    return Array.isArray(v) ? new THREE.Vector3(...[0, 1, 2].map(i => num(this.ev(v[i] ?? 0, scope)))) : null
  }

  // a new particle's place and direction, by the emitter's shape
  shape (scope) {
    const c = this.c
    const shapes = ['point', 'sphere', 'box', 'disc', 'custom', 'entity_aabb']
    const name = shapes.find(s => c['minecraft:emitter_shape_' + s]) ?? 'point'
    const s = c['minecraft:emitter_shape_' + name]
    const offset = this.vector(s?.offset, scope) ?? new THREE.Vector3()
    let local = new THREE.Vector3()
    if (name === 'sphere') local = randomInSphere(s.surface_only).multiplyScalar(num(this.ev(s.radius ?? 1, scope)))
    if (name === 'box' || name === 'entity_aabb') {
      const half = this.vector(s.half_dimensions, scope) ?? new THREE.Vector3(0.3, 0.9, 0.3)
      local = new THREE.Vector3((Math.random() * 2 - 1) * half.x, (Math.random() * 2 - 1) * half.y, (Math.random() * 2 - 1) * half.z)
      if (s.surface_only) {
        const axis = Math.floor(Math.random() * 3)
        local.setComponent(axis, (Math.random() < 0.5 ? -1 : 1) * half.getComponent(axis))
      }
    }
    if (name === 'disc') {
      const normal = (this.vector(s.plane_normal, scope) ?? new THREE.Vector3(0, 1, 0)).normalize()
      const r = num(this.ev(s.radius ?? 1, scope)) * (s.surface_only ? 1 : Math.sqrt(Math.random()))
      const a = Math.random() * Math.PI * 2
      local = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal))
    }
    let direction
    if (s?.direction === 'inwards') direction = local.clone().negate()
    else if (Array.isArray(s?.direction)) direction = this.vector(s.direction, scope)
    else direction = name === 'point' ? new THREE.Vector3() : local.clone()
    if (direction.lengthSq() > 0) direction.normalize()
    return { position: local.add(offset), direction }
  }

  emit (n) {
    const c = this.c
    for (let i = 0; i < n && this.particles.length < this.max; i++) {
      const p = { vars: { 'variable.particle_age': 0 }, age: 0, rotation: 0, spin: 0 }
      for (let r = 1; r <= 4; r++) p.vars[`variable.particle_random_${r}`] = Math.random()
      p.scope = { get: name => p.vars[name] ?? this.vars[name] ?? 0, set: (name, v) => { p.vars[name] = v } }
      this.run(c['minecraft:particle_initialization']?.per_update_expression, p.scope)
      p.lifetime = num(this.ev(c['minecraft:particle_lifetime_expression']?.max_lifetime ?? 1, p.scope)) || 1
      p.vars['variable.particle_lifetime'] = p.lifetime
      const { position, direction } = this.shape(p.scope)
      p.position = position
      const speed = c['minecraft:particle_initial_speed']
      p.velocity = Array.isArray(speed) ? this.vector(speed, p.scope) : direction.multiplyScalar(num(this.ev(speed ?? 0, p.scope)))
      const spin = c['minecraft:particle_initial_spin']
      if (spin) {
        p.rotation = num(this.ev(spin.rotation ?? 0, p.scope))
        p.spin = num(this.ev(spin.rotation_rate ?? 0, p.scope))
      }
      this.particles.push(p)
    }
  }

  // a step of dt seconds; false once the emitter is done
  update (dt) {
    const c = this.c
    this.age += dt
    this.vars['variable.emitter_age'] = this.age
    this.run(c['minecraft:emitter_initialization']?.per_update_expression, this.scope)
    const expired = this.expiration !== undefined && !!this.ev(this.expiration, this.scope)
    const active = this.age < this.activeTime && !expired
    if (this.steady && active) {
      this.toSpawn += num(this.ev(this.steady.spawn_rate ?? 1, this.scope)) * dt
      const n = Math.floor(this.toSpawn)
      this.toSpawn -= n
      this.emit(n)
    }
    const dynamic = c['minecraft:particle_motion_dynamic']
    const parametric = c['minecraft:particle_motion_parametric']
    const lifetimeExpiration = c['minecraft:particle_lifetime_expression']?.expiration_expression
    this.particles = this.particles.filter(p => {
      p.age += dt
      p.vars['variable.particle_age'] = p.age
      this.run(c['minecraft:particle_initialization']?.per_update_expression, p.scope)
      if (p.age >= p.lifetime) return false
      if (lifetimeExpiration !== undefined && this.ev(lifetimeExpiration, p.scope)) return false
      if (parametric?.relative_position) {
        p.position = this.vector(parametric.relative_position, p.scope)
      } else {
        const acceleration = this.vector(dynamic?.linear_acceleration, p.scope) ?? new THREE.Vector3()
        const drag = num(this.ev(dynamic?.linear_drag_coefficient ?? 0, p.scope))
        p.velocity.addScaledVector(acceleration.addScaledVector(p.velocity, -drag), dt)
        p.position.addScaledVector(p.velocity, dt)
      }
      if (dynamic) {
        const spinAcceleration = num(this.ev(dynamic.rotation_acceleration ?? 0, p.scope))
        const spinDrag = num(this.ev(dynamic.rotation_drag_coefficient ?? 0, p.scope))
        p.spin += (spinAcceleration - spinDrag * p.spin) * dt
      }
      p.rotation += p.spin * dt
      return true
    })
    return active || this.particles.length > 0
  }

  // the quads, facing the camera (right, up: its axes)
  draw (right, up) {
    const b = this.billboard
    const uv = b.uv ?? {}
    const tinting = this.c['minecraft:particle_appearance_tinting']
    const [sw, sh] = this.sheet
    const perRender = this.c['minecraft:particle_initialization']?.per_render_expression
    let n = 0
    for (const p of this.particles) {
      this.run(perRender, p.scope)
      const [w, h] = (b.size ?? [0.1, 0.1]).map(e => num(this.ev(e, p.scope)))
      let u0 = 0; let v0 = 0; let du = sw; let dv = sh
      if (uv.flipbook) {
        const f = uv.flipbook
        const base = (f.base_UV ?? [0, 0]).map(e => num(this.ev(e, p.scope)))
        const size = f.size_UV ?? [sw, sh]
        const step = f.step_UV ?? [0, 0]
        const frames = Math.max(1, Math.floor(num(this.ev(f.max_frame ?? 1, p.scope))))
        let frame = f.stretch_to_lifetime ? Math.floor(p.age / p.lifetime * frames) : Math.floor(p.age * (f.frames_per_second ?? 8))
        frame = f.loop ? frame % frames : Math.min(frame, frames - 1)
        u0 = base[0] + step[0] * frame
        v0 = base[1] + step[1] * frame
        du = size[0]
        dv = size[1]
      } else if (uv.uv) {
        ;[u0, v0] = uv.uv.map(e => num(this.ev(e, p.scope)))
        ;[du, dv] = (uv.uv_size ?? [sw, sh]).map(e => num(this.ev(e, p.scope)))
      }
      let color = [1, 1, 1, 1]
      if (tinting?.color) {
        const col = tinting.color
        color = col.gradient
          ? gradientAt(col.gradient, num(this.ev(col.interpolant ?? 0, p.scope)), p.scope)
          : colorOf(col, p.scope)
      }
      const cos = Math.cos(p.rotation * Math.PI / 180)
      const sin = Math.sin(p.rotation * Math.PI / 180)
      const center = p.position.clone().add(this.at)
      const corners = [[-1, 1], [1, 1], [-1, -1], [1, -1]]
      corners.forEach(([x, y], k) => {
        const rx = (x * cos - y * sin) * w
        const ry = (x * sin + y * cos) * h
        const i = n * 4 + k
        this.positions[i * 3] = center.x + right.x * rx + up.x * ry
        this.positions[i * 3 + 1] = center.y + right.y * rx + up.y * ry
        this.positions[i * 3 + 2] = center.z + right.z * rx + up.z * ry
        this.uvs[i * 2] = (u0 + (x > 0 ? du : 0)) / sw
        this.uvs[i * 2 + 1] = 1 - (v0 + (y > 0 ? 0 : dv)) / sh
        this.colors.set(color, i * 4)
      })
      n++
    }
    this.geometry.setDrawRange(0, n * 6)
    for (const name of ['position', 'uv', 'color']) this.geometry.getAttribute(name).needsUpdate = true
  }

  dispose () {
    this.geometry.dispose()
    this.material.dispose()
  }
}

class Particles {
  constructor (scene, camera) {
    this.scene = scene
    this.camera = camera
    this.emitters = []
    this.effects = Promise.resolve({})
    this.last = performance.now()
  }

  setVersion (version) {
    this.clear()
    this.version = version
    this.effects = String(version).startsWith('bedrock_')
      ? new Promise(resolve => loadJSON(`textures/${version}/particles.json`, resolve))
      : Promise.resolve({})
  }

  // a particle effect at a position: { name ('minecraft:heart_particle', or without its namespace), pos, count (of a
  // manual emitter's particles), duration (of a looping emitter, in seconds) }
  spawn ({ name, pos, count, duration }) {
    const version = this.version
    this.effects.then(effects => {
      if (version !== this.version) return
      const effect = effects[name] ?? effects['minecraft:' + name]
      if (!effect) return
      const texture = effect.texture && `${effect.texture.replace('textures', 'textures/' + version)}.png`
      const emitter = new Emitter(effect, pos, { count, duration }, texture)
      this.emitters.push(emitter)
      this.scene.add(emitter.mesh)
    })
  }

  update () {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (!this.emitters.length) return
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
    this.emitters = this.emitters.filter(emitter => {
      if (emitter.update(dt)) {
        emitter.draw(right, up)
        return true
      }
      this.scene.remove(emitter.mesh)
      emitter.dispose()
      return false
    })
  }

  clear () {
    for (const emitter of this.emitters) {
      this.scene.remove(emitter.mesh)
      emitter.dispose()
    }
    this.emitters = []
  }
}

module.exports = { Particles }
