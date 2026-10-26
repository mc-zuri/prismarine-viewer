// A Bedrock entity drawn from its version's client entity resources (see the integration repo's
// export-bedrock-entities.mjs): the definition's scripts run every frame, its render controllers choose the
// geometry, textures and materials of each layer, and its animations and animation controllers pose the bones.
//
//   const model = new BedrockEntity(assets, 'minecraft:cow', { textures, geometry })
//   scene.add(model.object)              // the caller places model.object and turns it to the entity's yaw (the
//                                        // model faces -z); the body turns within it as the client turns it
//   model.setState({ metadata, properties, health, maxHealth, name, equipment, vehicle, riders, carrying })
//   model.setMotion({ position, yaw, headYaw, pitch, onGround, inWater, inLava })
//   model.event('hurt_animation')        // its events (entity_event names) and animate actions
//   model.playAnimation({ animation, nextState, stopCondition, controller, blendOutTime })  // animate_entity
//   model.setOverrides({ queries, variables })  // what the caller knows better, or the model cannot know
//   model.particles = system             // a ParticleSystem (bedrock/particles) its particle effects show in
//   model.update(dt)                     // every frame
//
// What the client works out of an entity itself, tick by tick (its walk, its body's turn, its swing, hurt and death,
// a sheep's grazing...) is actorState.js; its queries are queries.js. What it wears and holds (equipment: item names
// by slot) is drawn by attachments.js.
//
// Its particle effects (the definition's particle_effects: short name -> effect) start as its animations' timelines
// reach them, and as its animation controllers enter the states that name them; those of a state stop as it leaves it,
// those of an animation as it stops playing. They are on the entity, at a locator of its bones when they name one, and
// follow it unless they are not bound to it (bind_to_actor: false).
//
// assets: { entities, geometry, render_controllers, animations, animation_controllers, materials,
// texture (path) -> THREE.Texture; and for what it wears and holds attachables, items, textureUrl (path) }. textures / geometry: overrides of the definition's (a player's own skin).
const THREE = require('three')
const { compile, num, truthy } = require('./molang')
const { buildSkeleton, addMeshes, disposeSkeleton, mirrorX, DEG } = require('./geometry')
const { entityMaterial, setTextures } = require('./material')
const { channel, animationLength } = require('./animation')
const { ActorState, TICK } = require('./actorState')
const { query } = require('./queries')
const { Attachments, crossSprite } = require('./attachments')
const { dragonGeometry } = require('./dragon')

// Bedrock's dye colours, by the colour index entities carry (sheep wool, collars, tropical fish)
const DYE_COLORS = [0xF9FFFE, 0xF9801D, 0xC74EBD, 0x3AB3DA, 0xFED83D, 0x80C71F, 0xF38BAA, 0x474F52, 0x9D9D97,
  0x169C9C, 0x8932B8, 0x3C44AA, 0x835432, 0x5E7C16, 0xB02E26, 0x1D1D21]
const dyeColor = i => {
  const c = DYE_COLORS[i]
  return c === undefined ? [1, 1, 1, 1] : [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, 1]
}

// the red of a hurt or a death over the entity's colours
const HURT_OVERLAY = [1, 0, 0, 0.5]
// the most ticks a frame catches up on (a page that was hidden)
const MAX_TICKS = 10
// what an animation the server plays runs on without a controller of the entity's
const RUNTIME_CONTROLLER = '__runtime_controller'
// a llama's carpet by colour: Array.decor of its render controller (0 none)
const CARPETS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan',
  'purple', 'blue', 'brown', 'green', 'red', 'black']

const DEFAULT_CONTROLLER = { geometry: 'Geometry.default', textures: ['Texture.default'], materials: [{ '*': 'Material.default' }] }
// entity_alphatest's
const DEFAULT_MATERIAL = { defines: ['ALPHA_TEST'], states: ['DisableCulling'] }

const lowerKeys = o => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
const wrapDegrees = d => ((d + 180) % 360 + 360) % 360 - 180
const globToRegex = (glob) => new RegExp('^' + glob.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
const script = list => [list].flat().filter(s => typeof s === 'string' && !/^\s*[@/]/.test(s)).join('\n')

class BedrockEntity {
  constructor (assets, identifier, overrides = {}) {
    this.assets = assets
    this.identifier = identifier
    this.desc = assets.entities[identifier]
    if (!this.desc) throw new Error(`no client entity ${identifier}`)
    this.overrides = { textures: lowerKeys(overrides.textures), geometry: lowerKeys(overrides.geometry) }
    this.textures = lowerKeys(this.desc.textures)
    this.geometryIds = lowerKeys(this.desc.geometry)
    this.materialNames = lowerKeys(this.desc.materials)

    this.object = new THREE.Group()
    this.model = new THREE.Group()
    this.model.scale.setScalar(1 / 16)
    this.object.add(this.model)

    this.state = { metadata: {}, properties: {} }
    this.equipment = {}
    this.motion = { position: null, yaw: 0, headYaw: 0, pitch: 0, onGround: true }
    this.actor = new ActorState(identifier.replace(/^minecraft:/, ''))
    this.lifeTime = 0
    this.tickTime = 0
    this.dt = 0
    this.frame = 0
    this.variables = {}
    this.provided = { queries: {}, variables: {} }
    this.layers = new Map()
    this.anims = new Map()
    this.controllers = new Map()
    // the animations the server told it to play, by the controller they play on
    this.runtime = new Map()
    this.pose = new Map()
    this.ctx = { variables: this.variables, context: {}, temp: {}, query: (name, args) => this.query(name, args), resource: null }
    this.initialized = false
    // the ParticleSystem its effects show in (the caller's), and the emitters it started
    this.particles = null
    this.emitters = new Set()
    this.particleEffects = lowerKeys(this.desc.particle_effects)
    // what it wears and holds
    this.attachments = new Attachments(this)
  }

  /**
   * What the server says of it: { metadata (its entity data, flags by name), properties, health, maxHealth, name,
   * equipment: { mainhand, offhand, head, chest, legs, feet, body } (item names), vehicle (what it rides: its
   * identifier), riders (theirs), carrying (an enderman's block) }. held and offhand name the hands' items too.
   */
  setState (state) {
    Object.assign(this.state, state)
    if (state.metadata) this.flags = { ...(state.metadata.flags ?? {}), ...(state.metadata.flags_extended ?? {}) }
    const { held, offhand } = this.state
    this.equipment = { ...(held ? { mainhand: held } : {}), ...(offhand ? { offhand } : {}), ...(this.state.equipment ?? {}) }
    this.attachments.set(this.equipment)
  }

  /**
   * How it moves: { position, yaw, headYaw, pitch (degrees), onGround, inWater, inLava, bodyYaw }. bodyYaw: its body's
   * yaw, when the caller knows it (a rider on a seat that holds it); else the model turns the body as the client does.
   */
  setMotion (motion) {
    Object.assign(this.motion, motion)
  }

  /**
   * Queries and variables the caller provides: { queries: { name: value | (args) => value }, variables: { name: value } }
   * (names without query. / variable.). A query answers before the model's own; the variables are set each frame
   * after the client's own, before the scripts. For what the model cannot know (the player's item use, its first
   * person view) or knows worse.
   */
  setOverrides ({ queries, variables } = {}) {
    this.provided = { queries: lowerKeys(queries), variables: lowerKeys(variables) }
  }

  /** An arm swing (an attack, a use): variable.attack_time runs from 0 to 1 over it. */
  swing () {
    this.actor.swing()
  }

  /**
   * One of its events, by the protocol's name: entity_event (hurt_animation, death_animation, arm_swing,
   * eat_grass_animation, iron_golem_offer_flower, shake_wet, arrow_shake, jump, ...) or an animate action
   * (swing_arm, wake_up, ...). data: the packet's.
   */
  event (name, data = 0) {
    this.actor.event(name, data)
  }

  /**
   * An animation the server tells it to play (animate_entity, the /playanimation command): animation: one of its own
   * by short name, or any animation's identifier; it plays on `controller` (one of its animation controllers by name
   * or identifier: that controller waits meanwhile, then goes to `nextState`) or a controller of its own, until
   * `stopCondition` (Molang; by default once it finished), then fades over `blendOutTime` seconds.
   */
  playAnimation ({ animation, nextState = '', stopCondition = '', controller = '', blendOutTime = 0 }) {
    const id = this.desc.animations?.[animation] ?? animation
    if (!this.assets.animations[id] && !this.assets.animation_controllers[id]) return
    const name = controller || RUNTIME_CONTROLLER
    this.anims.delete('runtime:' + name)
    this.runtime.set(name, { id, nextState, stop: stopCondition || 'query.any_animation_finished', blendOut: blendOutTime, stopped: null })
  }

  // where the camera is (world space): billboards (experience orbs, fireballs) turn to it
  setCamera (position) {
    this.camera = position
  }

  // query.camera_rotation: [pitch, yaw] in degrees that turn a bone's south face (+z of the model's space) to the
  // camera, as a billboard's animation turns it (animation.actor.billboard: a fireball, an experience orb). They are
  // taken in the model's own space, from a quarter of a block above its origin: whichever way the caller turned the
  // entity's object (its yaw) and the model turned its body within it.
  cameraRotation () {
    const cam = this.camera
    if (!cam) return [0, 0]
    this.model.updateWorldMatrix(true, false)
    const toCamera = this.model.getWorldPosition(new THREE.Vector3())
    toCamera.set(cam.x - toCamera.x, cam.y - toCamera.y - 0.25, cam.z - toCamera.z)
    toCamera.applyQuaternion(this.model.getWorldQuaternion(new THREE.Quaternion()).invert())
    const yaw = Math.atan2(toCamera.x, toCamera.z) * 180 / Math.PI
    const pitch = Math.atan2(toCamera.y, Math.hypot(toCamera.x, toCamera.z)) * 180 / Math.PI
    return [pitch, -yaw]
  }

  // ---- frame -----------------------------------------------------------------------------------------------------

  update (dt) {
    this.dt = Math.min(Math.max(dt, 0), 0.25)
    this.lifeTime += this.dt
    this.frame++
    this.tick()
    const scripts = this.desc.scripts ?? {}
    if (!this.initialized) {
      this.initialized = true
      this.run(scripts.initialize)
      this.engineVariables()
    }
    this.frameVariables()
    this.run(scripts.pre_animation)
    // what it wears sets up (a helmet hides the hat layer)
    for (const setup of this.attachments.parentSetup()) this.run(setup)
    this.updateScale(scripts)
    this.turnBody()
    this.updateLayers()
    this.animate()
    this.attachments.update(this.dt)
    this.golemFlower()
  }

  // An iron golem offering a flower holds a poppy, which the client draws itself (as Java's IronGolemFlowerLayer does):
  // at the end of its right arm, pointing forward, while variable.offer_flower_tick runs
  golemFlower () {
    if (this.actor.kind !== 'iron_golem') return
    const show = this.actor.golemFlower > 0
    if (!show && !this.poppy) return
    const arm = this.findBone('arm0')
    if (!arm) return
    if (!this.poppy) this.poppy = crossSprite(this.assets, 'blocks/flower_rose')
    if (this.poppy.parent !== arm.group) {
      arm.group.add(this.poppy)
      // its hand: Bedrock (-11, 4, -5), x mirrored, from the arm's pivot
      this.poppy.position.set(11, 4, -5).sub(arm.pivot)
      this.poppy.rotation.x = -Math.PI / 2
    }
    this.poppy.visible = show
  }

  // the client's ticks since the last frame, 20 a second; the first frame ticks once
  tick () {
    this.tickTime += this.dt
    let ticks = Math.floor(this.tickTime / TICK)
    this.tickTime -= ticks * TICK
    if (!this.actor.started) ticks = Math.max(ticks, 1)
    if (ticks > MAX_TICKS) {
      ticks = MAX_TICKS
      this.tickTime = 0
    }
    const m = this.motion
    for (let i = 0; i < ticks; i++) {
      this.actor.tick({
        position: m.position,
        yaw: m.yaw,
        headYaw: m.headYaw,
        bodyYaw: m.bodyYaw,
        onGround: m.onGround !== false,
        inWater: !!m.inWater || !!this.flag('swimming'),
        riding: !!(this.flag('riding') || this.state.vehicle),
        player: this.identifier === 'minecraft:player',
        flag: name => this.flag(name),
        metadata: this.state.metadata ?? {}
      })
    }
    this.actor.alpha = Math.min(1, Math.max(0, this.tickTime / TICK))
  }

  // the body turned within the entity's yaw, tilted along the look as it glides, and tipped over as it dies
  turnBody () {
    const yaw = this.motion.yaw ?? 0
    const tilt = this.actor.glideTilt(this.motion.pitch ?? 0)
    this.model.rotation.set(-tilt * DEG, wrapDegrees(yaw - this.actor.bodyYaw()) * DEG, this.actor.deathFlip() * DEG, 'YXZ')
  }

  run (list) {
    const src = script(list)
    if (!src) return
    this.ctx.temp = {}
    compile(src)(this.ctx)
  }

  // variables the game sets itself from the entity's data
  engineVariables () {
    const md = this.state.metadata ?? {}
    // tropical fish: model and pattern from variant and mark_variant
    this.variables['tropicalfish.base'] = md.variant ?? 0
    this.variables['tropicalfish.pattern'] = (md.variant ?? 0) * 6 + (md.mark_variant ?? 0)
  }

  // variables the game sets every frame, which the packs read and never set: the swing (-1 between swings), the speed
  // a glide slows the limbs by (the walk divides by it), swimming, the hands, and each kind's own; then the caller's
  frameVariables () {
    const v = this.variables
    const a = this.actor
    const md = this.state.metadata ?? {}
    const held = this.equipment.mainhand ? String(this.equipment.mainhand).replace(/^minecraft:/, '') : ''
    v.attack_time = a.attackTime()
    v.gliding_speed_value = 1
    v.swim_amount = a.blend(a.swimPrev, a.swim)
    v.left_arm_swim_amount = v.right_arm_swim_amount = v.leftarmswim_amount = v.rightarmswim_amount = v.swim_amount
    v.is_holding_right = held ? 1 : 0
    v.is_holding_left = this.equipment.offhand ? 1 : 0
    v.has_target = this.query('has_target', [])
    // a humanoid using its item: a trident raised, a bow drawn (charge_amount), a spyglass up
    const using = this.flag('action')
    v.is_brandishing_spear = using && held === 'trident' ? 1 : 0
    v.is_holding_spyglass = using && held === 'spyglass' ? 1 : 0
    v.charge_amount = using ? Math.min(1, a.useTicks / 20) : 0
    v.damage_nearby_mobs = this.flag('spin_attack')
    switch (a.kind) {
      case 'cat':
        v.liedownamount = a.blend(a.lieDownPrev, a.lieDown)
        v.liedownamounttail = a.blend(a.lieTailPrev, a.lieTail)
        v.lieonplayer = 0
      // falls through: its pose, as the move controllers number them (a cat's 4: lying down)
      case 'ocelot':
        if (a.kind === 'cat' && (this.flag('resting') || this.flag('laying_down') || this.flag('sleeping'))) v.state = 4
        else if (this.flag('sitting')) v.state = 2
        else v.state = this.flag('sneaking') ? 0 : (this.flag('sprinting') ? 1 : 3)
        break
      case 'chicken': {
        const flap = a.blend(a.flapPrev, a.flap)
        v.wing_flap = (Math.sin(flap) + 1) * a.blend(a.flapSpeedPrev, a.flapSpeed) * 180 / Math.PI
        break
      }
      case 'cod': case 'salmon': case 'pufferfish': case 'tropicalfish':
        v.animationamount = a.fish
        v.animationamountprev = a.fishPrev
        break
      case 'shulker':
        v['shulker.peekamount'] = a.blend(a.peekPrev, a.peek)
        v['shulker.facingdirection'] = md.shulker_attach_face ?? 1
        break
      case 'iron_golem':
        v.attack_animation_tick = a.golemAttack
        v.offer_flower_tick = a.golemFlower
        break
      case 'pillager': case 'piglin': case 'piglin_brute':
        v.attack_state = a.attackState
        v.crossbow_charge = a.crossbowCharge
        break
      case 'horse': case 'donkey': case 'mule': case 'skeleton_horse': case 'zombie_horse':
        v.stand_anim = a.blend(a.horseStandPrev, a.horseStand)
        v.shake_tail = a.tail > 0 ? 1 : 0
        break
      case 'squid': case 'glow_squid':
        v['squid.tentacle_angle'] = a.blend(a.tentacleAnglePrev, a.tentacleAngle) * 180 / Math.PI
        v['squid.swim_rotation'] = a.blend(a.pitchBodyPrev, a.pitchBody)
        v.glow_alpha = Math.min(1, Math.max(0, 1 - a.dark / 10))
        break
      case 'rabbit':
        v.jump_rotation = a.jumpDuration ? Math.sin(Math.min(1, (a.jumpTicks + a.alpha) / a.jumpDuration) * Math.PI) : 0
        break
      case 'ghast':
        v.ischarging = this.flag('charged')
        break
      case 'witch':
        v.isholdingitem = held ? 1 : 0
        break
      case 'villager_v2': case 'wandering_trader':
        v.raise_arms = held ? 1 : 0
        break
      case 'goat': {
        const horns = md.goat_horn_count ?? 2
        v.goat_has_right_horn = horns >= 1 ? 1 : 0
        v.goat_has_left_horn = horns >= 2 ? 1 : 0
        v.should_bow_head = this.flag('ram_attack')
        break
      }
      case 'llama': case 'trader_llama': {
        const carpet = String(this.equipment.body ?? '').replace(/^minecraft:/, '')
        v.decortextureindex = carpet.endsWith('carpet') ? CARPETS.indexOf(carpet.replace(/_?carpet$/, '') || 'white') + 1 : 0
        break
      }
      case 'ender_dragon':
        for (let i = 0; i < 24; i++) {
          const past = a.past(i)
          v[`historical_frame_${i}.rot_y`] = past.rot_y
          v[`historical_frame_${i}.pos_y`] = past.pos_y
        }
        break
    }
    Object.assign(v, this.provided.variables)
  }

  updateScale (scripts) {
    const s = scripts.scale !== undefined ? num(compile(scripts.scale)(this.ctx)) : 1
    const axis = k => {
      const e = scripts['scale' + k] ?? scripts['scale' + k.toLowerCase()]
      return e !== undefined ? num(compile(e)(this.ctx)) : 1
    }
    const model = this.modelScale()
    this.model.scale.set(s * axis('X') * model / 16, s * axis('Y') * model / 16, s * axis('Z') * model / 16)
  }

  modelScale () {
    const scale = this.state.metadata?.scale
    return typeof scale === 'number' && scale > 0 ? scale : 1
  }

  // ---- queries ---------------------------------------------------------------------------------------------------

  flag (name) {
    return this.flags?.[name] ? 1 : 0
  }

  query (name, args) {
    return query(this, name, args)
  }

  // ---- render controllers ----------------------------------------------------------------------------------------

  resource (rc, ns, name) {
    if (ns === 'array') {
      for (const kind of ['textures', 'geometries', 'materials']) {
        const arrays = rc.arrays?.[kind]
        if (!arrays) continue
        const key = Object.keys(arrays).find(k => k.toLowerCase() === 'array.' + name)
        if (key) return arrays[key].map(ref => this.reference(rc, ref))
      }
      return null
    }
    if (ns === 'texture') return this.overrides.textures[name] ?? this.textures[name] ?? null
    if (ns === 'geometry') return this.overrides.geometry[name] ?? this.geometryIds[name] ?? null
    if (ns === 'material') return this.materialNames[name] ?? null
    return null
  }

  reference (rc, ref) {
    if (typeof ref !== 'string') return ref
    const m = /^(texture|geometry|material)\.(.+)$/i.exec(ref.trim())
    if (m) return this.resource(rc, m[1].toLowerCase(), m[2].toLowerCase())
    return compile(ref)(this.ctx)
  }

  value (rc, expr) {
    this.ctx.resource = (ns, name) => this.resource(rc, ns, name)
    return typeof expr === 'string' ? (/^(texture|geometry|material)\.[\w.]+$/i.test(expr.trim()) ? this.reference(rc, expr) : compile(expr)(this.ctx)) : expr
  }

  updateLayers () {
    const active = new Set()
    let order = 0
    // a definition without render controllers draws its default geometry, texture and material
    for (const entry of this.desc.render_controllers ?? ['controller.render.default']) {
      const [name, cond] = typeof entry === 'string' ? [entry, null] : Object.entries(entry)[0]
      if (cond != null && !truthy(this.value(DEFAULT_CONTROLLER, cond))) continue
      const rc = this.assets.render_controllers[name] ?? DEFAULT_CONTROLLER
      active.add(name)
      this.updateLayer(name, rc, order++)
    }
    for (const [name, layer] of this.layers) {
      if (active.has(name)) continue
      this.disposeLayer(layer)
      this.layers.delete(name)
    }
  }

  geometryData (ref) {
    if (ref && typeof ref === 'object') return ref
    const geo = this.assets.geometry[ref] ?? this.assets.geometry[this.assets.fallbackGeometry?.[ref]] ?? null
    // (the dragon, which the client puts together itself)
    return geo && this.identifier === 'minecraft:ender_dragon' ? dragonGeometry(geo) : geo
  }

  updateLayer (name, rc, order) {
    const geometryRef = this.value(rc, rc.geometry ?? 'Geometry.default')
    const textures = (rc.textures ?? ['Texture.default']).map(t => this.value(rc, t))
    // a rule may name several bones: { "*": false, "head": true }, applied in order
    const materials = (rc.materials ?? [{ '*': 'Material.default' }]).flatMap(m => Object.entries(m).map(([pattern, expr]) => [pattern, this.value(rc, expr)]))
    const key = JSON.stringify([typeof geometryRef === 'string' ? geometryRef : geometryRef?.identifier ?? '#override',
      textures.map(t => typeof t === 'string' ? t : (t?.uuid ?? null)), materials])
    let layer = this.layers.get(name)
    if (!layer || layer.key !== key) {
      if (layer) this.disposeLayer(layer)
      layer = this.buildLayer(name, geometryRef, textures, materials, order)
      layer.key = key
      this.layers.set(name, layer)
    }
    if (!layer.skeleton) return

    // part visibility: the last pattern a bone matches decides
    if (rc.part_visibility) {
      const rules = rc.part_visibility.flatMap(r => Object.entries(r).map(([p, e]) => [globToRegex(p), truthy(this.value(rc, e))]))
      for (const bone of layer.skeleton.bones.values()) {
        let visible = true
        for (const [re, v] of rules) if (re.test(bone.name.toLowerCase())) visible = v
        bone.group.visible = visible
      }
    }

    // per-frame uniforms
    const md = this.state.metadata ?? {}
    const base = md.color !== undefined && md.color !== null ? dyeColor(md.color) : [1, 1, 1, 1]
    const tint2 = md.color_2 !== undefined && md.color_2 !== null ? dyeColor(md.color_2) : [1, 1, 1, 1]
    const rgba = (spec, defaults) => ['r', 'g', 'b', 'a'].map((c, i) => {
      if (!spec || spec[c] === undefined) return defaults[i]
      this.ctx.self = defaults[i]
      return num(this.value(rc, spec[c]))
    })
    const change = rgba(rc.color, base)
    let overlay = rgba(rc.overlay_color, [0, 0, 0, 0])
    // hurt or dying: red over it, unless its own overlay is stronger (a creeper about to blow up)
    if (this.actor.hurt() && overlay[3] < HURT_OVERLAY[3]) overlay = HURT_OVERLAY
    let uvAnim = [0, 0, 1, 1]
    if (rc.uv_anim) {
      const vec2 = (spec, d) => [0, 1].map(i => spec?.[i] === undefined ? d : num(this.value(rc, spec[i])))
      const [ox, oy] = vec2(rc.uv_anim.offset, 0)
      const [sx, sy] = vec2(rc.uv_anim.scale, 1)
      uvAnim = [ox, oy, sx, sy]
    }
    const lit = rc.ignore_lighting ? 0 : 1
    const light = typeof rc.light_color_multiplier === 'number' ? rc.light_color_multiplier : (rc.light_color_multiplier ? num(this.value(rc, rc.light_color_multiplier)) : 1)
    for (const material of layer.materials.values()) {
      const u = material.uniforms
      u.CHANGE_COLOR.value.set(...change)
      u.MULTIPLICATIVE_TINT_CHANGE_COLOR.value.set(...tint2)
      u.OVERLAY_COLOR.value.set(...overlay)
      u.UV_ANIM.value.set(...uvAnim)
      u.LIT.value = lit
      u.LIGHT.value.setScalar(light * (this.light ?? 1))
    }
  }

  buildLayer (name, geometryRef, textures, materials, order) {
    const geo = this.geometryData(geometryRef)
    if (!geo) return { name, skeleton: null, materials: new Map() }
    const skeleton = buildSkeleton(geo)
    const textureObjects = textures.map(t => typeof t === 'string' ? this.assets.texture(t) : (t ?? null))
    const byName = new Map()
    const rules = materials.map(([p, m]) => [globToRegex(p), m])
    const materialFor = (boneName) => {
      let materialName = null
      for (const [re, m] of rules) if (re.test(boneName.toLowerCase())) materialName = m
      // the entities the game draws itself name no material (the ender dragon, a thrown trident)
      if (!materialName) materialName = '#default'
      let material = byName.get(materialName)
      if (!material) {
        material = entityMaterial(this.assets.materials?.[materialName] ?? DEFAULT_MATERIAL)
        setTextures(material, textureObjects)
        byName.set(materialName, material)
      }
      return material
    }
    addMeshes(skeleton, materialFor, order)
    this.model.add(skeleton.root)
    return { name, skeleton, materials: byName, geometry: geo }
  }

  disposeLayer (layer) {
    if (!layer.skeleton) return
    this.model.remove(layer.skeleton.root)
    disposeSkeleton(layer.skeleton)
    for (const m of layer.materials.values()) m.dispose()
  }

  // ---- animations ------------------------------------------------------------------------------------------------

  animate () {
    this.pose.clear()
    const scripts = this.desc.scripts ?? {}
    for (const entry of scripts.animate ?? []) {
      const [name, expr] = typeof entry === 'string' ? [entry, null] : Object.entries(entry)[0]
      const weight = expr == null ? 1 : num(this.value(DEFAULT_CONTROLLER, expr))
      if (weight > 0) this.play(name, weight, name)
    }
    // 1.8 definitions list their controllers apart: they always run, unless the scripts already play them (a pack's
    // newer copy of the definition names them in both)
    const played = new Set((scripts.animate ?? []).map(e => this.desc.animations?.[typeof e === 'string' ? e : Object.keys(e)[0]]))
    for (const entry of this.desc.animation_controllers ?? []) {
      for (const [name, id] of Object.entries(entry)) if (!played.has(id)) this.playId(id, 1, 'controller:' + name)
    }
    this.playRuntime()
    this.stopUnplayedEffects()
    this.applyPose()
  }

  // the animations the server told it to play: each until its stop condition, then fading out over its blend time
  playRuntime () {
    for (const [name, run] of this.runtime) {
      const path = 'runtime:' + name
      if (run.stopped === null) {
        const instance = this.anims.get(path)
        this.ctx.stateFinished = { all: !!instance?.finished, any: !!instance?.finished }
        const stop = instance && truthy(this.value(DEFAULT_CONTROLLER, run.stop))
        this.ctx.stateFinished = null
        if (stop) this.stopRuntime(run)
      }
      let weight = 1
      if (run.stopped !== null) {
        weight = run.blendOut > 0 ? 1 - (this.lifeTime - run.stopped) / run.blendOut : 0
        if (weight <= 0) {
          this.runtime.delete(name)
          this.anims.delete(path)
          continue
        }
      }
      this.playId(run.id, weight, path)
    }
  }

  // a runtime animation stopped: the controller it stood in for goes to its next state
  stopRuntime (run) {
    run.stopped = this.lifeTime
    const target = run.controller
    if (!target) return
    const ctrl = this.assets.animation_controllers[target.id]
    const st = this.controllers.get(target.path)
    const next = run.nextState || 'default'
    if (!ctrl?.states?.[next] || !st || st.state === next) return
    this.run(ctrl.states[st.state]?.on_exit)
    st.state = next
    this.run(ctrl.states[next].on_entry)
  }

  // the runtime animation that plays in place of a controller: named by its identifier or its name
  runtimeFor (id, path) {
    return this.runtime.get(id) ?? this.runtime.get(path) ?? this.runtime.get(path.replace(/^controller:/, ''))
  }

  play (name, weight, path) {
    const id = this.desc.animations?.[name]
    if (id) this.playId(id, weight, path)
  }

  playId (id, weight, path) {
    if (id.startsWith('controller.')) return this.playController(id, weight, path)
    const anim = this.assets.animations[id]
    if (!anim) return
    let instance = this.anims.get(path)
    if (!instance) { instance = { time: 0, frame: -2, finished: false }; this.anims.set(path, instance) }
    const restarted = instance.frame !== this.frame - 1
    instance.frame = this.frame
    this.ctx.animTime = restarted ? 0 : instance.time
    if (restarted) instance.time = 0
    if (anim.anim_time_update !== undefined) instance.time = num(this.value(DEFAULT_CONTROLLER, anim.anim_time_update))
    else if (!restarted) instance.time += this.dt
    const length = animationLength(anim)
    const loop = anim.loop
    let t = instance.time
    if (length > 0) {
      if (loop === true || loop === 'true') t = t % length
      else t = Math.min(t, length)
    }
    instance.finished = loop !== true && loop !== 'true' && length > 0 && instance.time >= length
    if (anim.particle_effects) this.timelineEffects(anim, instance, restarted)
    if (instance.finished && (loop === false || loop === undefined)) return
    if (anim.blend_weight !== undefined) weight *= num(this.value(DEFAULT_CONTROLLER, anim.blend_weight))
    if (weight <= 0) return
    this.ctx.animTime = t
    for (const [boneName, bone] of Object.entries(anim.bones ?? {})) {
      if (!bone) continue
      const key = boneName.toLowerCase()
      const p = this.poseOf(key)
      if (anim.override_previous_animation) { p.rot = [0, 0, 0]; p.pos = [0, 0, 0]; p.scl = [1, 1, 1] }
      if (bone.relative_to?.rotation === 'entity') p.relativeToEntity = true
      // `this`: the channel's value so far, from the bone's rest
      const rest = this.findBone(key)
      const r = channel(bone.rotation, t, this.ctx, rest ? rest.thisRotation.map((v, k) => v + p.rot[k]) : p.rot)
      if (r) for (let k = 0; k < 3; k++) p.rot[k] += r[k] * weight
      const q = channel(bone.position, t, this.ctx, rest ? rest.thisPosition.map((v, k) => v + p.pos[k]) : p.pos)
      if (q) for (let k = 0; k < 3; k++) p.pos[k] += q[k] * weight
      const s = channel(bone.scale, t, this.ctx, p.scl)
      if (s) for (let k = 0; k < 3; k++) p.scl[k] *= 1 + (s[k] - 1) * weight
    }
  }

  playController (id, weight, path) {
    const ctrl = this.assets.animation_controllers[id]
    if (!ctrl?.states) return
    // an animation the server plays on it: the controller waits
    const run = this.runtimeFor(id, path)
    if (run && run.stopped === null) {
      run.controller = { id, path }
      return
    }
    let st = this.controllers.get(path)
    if (!st) {
      st = { state: ctrl.initial_state ?? ('default' in ctrl.states ? 'default' : Object.keys(ctrl.states)[0]) }
      this.controllers.set(path, st)
      this.run(ctrl.states[st.state]?.on_entry)
    }
    const current = ctrl.states[st.state]
    // all_animations_finished / any_animation_finished: of this state's animations, as of last frame
    const names = (current?.animations ?? []).map(a => typeof a === 'string' ? a : Object.keys(a)[0])
    const finished = names.map(n => this.anims.get(`${path}/${st.state}/${n}`)?.finished ?? false)
    this.ctx.stateFinished = { all: finished.length > 0 && finished.every(Boolean), any: finished.some(Boolean) }
    for (const transition of current?.transitions ?? []) {
      const [to, expr] = Object.entries(transition)[0]
      if (ctrl.states[to] && truthy(this.value(DEFAULT_CONTROLLER, expr))) {
        this.run(current.on_exit)
        st.state = to
        this.run(ctrl.states[to].on_entry)
        break
      }
    }
    this.ctx.stateFinished = null
    const state = ctrl.states[st.state]
    st.frame = this.frame
    // the state's particle effects: started as it is entered, stopped as it is left
    if (st.effectsOf !== st.state) this.stateEffects(st, state)
    for (const a of state?.animations ?? []) {
      const [name, expr] = typeof a === 'string' ? [a, null] : Object.entries(a)[0]
      const w = expr == null ? 1 : num(this.value(DEFAULT_CONTROLLER, expr))
      if (w > 0) this.play(name, weight * w, `${path}/${st.state}/${name}`)
    }
  }

  poseOf (bone) {
    let p = this.pose.get(bone)
    if (!p) { p = { rot: [0, 0, 0], pos: [0, 0, 0], scl: [1, 1, 1] }; this.pose.set(bone, p) }
    return p
  }

  applyPose () {
    for (const layer of this.layers.values()) {
      if (!layer.skeleton) continue
      for (const [key, bone] of layer.skeleton.bones) {
        const p = this.pose.get(key)
        const g = bone.group
        if (!p) {
          g.rotation.copy(bone.rest)
          g.position.copy(bone.restPosition)
          g.scale.set(1, 1, 1)
          continue
        }
        g.rotation.set(bone.rest.x - p.rot[0] * DEG, bone.rest.y - p.rot[1] * DEG, bone.rest.z + p.rot[2] * DEG)
        g.position.set(bone.restPosition.x - p.pos[0], bone.restPosition.y + p.pos[1], bone.restPosition.z + p.pos[2])
        g.scale.set(p.scl[0] || 1e-5, p.scl[1] || 1e-5, p.scl[2] || 1e-5)
      }
      // a bone posed relative to the entity (a head looking at its target) does not turn with its parents
      for (const [key, bone] of layer.skeleton.bones) {
        if (!this.pose.get(key)?.relativeToEntity) continue
        const parents = new THREE.Quaternion()
        for (let up = bone.parent && layer.skeleton.bones.get(bone.parent); up; up = up.parent && layer.skeleton.bones.get(up.parent)) {
          parents.premultiply(up.group.quaternion)
        }
        bone.group.quaternion.premultiply(parents.invert())
      }
    }
  }

  // ---- particle effects ------------------------------------------------------------------------------------------

  /**
   * One of its particle effects ({ effect: its short name, locator, pre_effect_script, bind_to_actor }) started on it:
   * the emitter, or null (no such effect, or no ParticleSystem to show it in). pre_effect_script runs on the emitter
   * before it starts, with the entity's queries.
   */
  startEffect ({ effect, locator, pre_effect_script: pre, bind_to_actor: bind } = {}) {
    const identifier = this.particleEffects[String(effect ?? '').toLowerCase()]
    if (!identifier || !this.particles) return null
    const emitter = this.particles.spawn(identifier, { entity: this, locator, bind: bind !== false && bind !== 'false', preEffect: pre ? script(pre) : null })
    if (emitter) this.emitters.add(emitter)
    return emitter
  }

  stopEffects (list) {
    for (const emitter of list ?? []) {
      emitter.stop()
      this.emitters.delete(emitter)
    }
  }

  /** All its effects stop (it is hidden, say); those of the states it is in start again as it is next updated. */
  stopAllEffects () {
    this.stopEffects([...this.emitters])
    for (const st of this.controllers.values()) {
      st.emitters = null
      st.effectsOf = null
    }
    for (const instance of this.anims.values()) instance.emitters = null
  }

  // an animation's timeline of effects ({ "0.5": { effect, ... } or a list of them }): those it passed since the last
  // frame, each time a looping one comes round to them
  timelineEffects (anim, instance, restarted) {
    if (!this.particles) return
    const length = animationLength(anim)
    const loop = (anim.loop === true || anim.loop === 'true') && length > 0
    const now = instance.time
    const before = restarted || instance.effectsAt === undefined ? -1e-6 : instance.effectsAt
    instance.effectsAt = now
    if (now < before) return
    for (const [time, specs] of Object.entries(anim.particle_effects)) {
      const at = Number(time)
      const passed = loop ? Math.floor((now - at) / length) >= Math.floor((before - at) / length) + 1 : before < at && at <= now
      if (!passed) continue
      instance.emitters ??= []
      for (const spec of [specs].flat()) {
        const emitter = this.startEffect(spec)
        if (emitter) instance.emitters.push(emitter)
      }
    }
  }

  // a controller's state's effects in place of those of the state it was in
  stateEffects (st, state) {
    if (!this.particles) return
    this.stopEffects(st.emitters)
    st.emitters = (state?.particle_effects ?? []).map(spec => this.startEffect(spec)).filter(Boolean)
    st.effectsOf = st.state
  }

  // the effects of the animations and controllers that did not play this frame stop
  stopUnplayedEffects () {
    if (!this.emitters.size) return
    for (const instance of this.anims.values()) {
      if (instance.emitters?.length && instance.frame !== this.frame) {
        this.stopEffects(instance.emitters)
        instance.emitters = null
      }
    }
    for (const st of this.controllers.values()) {
      if (st.emitters?.length && st.frame !== this.frame) {
        this.stopEffects(st.emitters)
        st.emitters = null
        st.effectsOf = null
      }
    }
    for (const emitter of this.emitters) if (emitter.done) this.emitters.delete(emitter)
  }

  // a locator of its bones (in the first layer that has it): { bone, offset (from the bone's pivot, its space) }
  locator (name) {
    const key = String(name).toLowerCase()
    for (const layer of this.layers.values()) {
      for (const bone of layer.skeleton?.bones.values() ?? []) {
        if (!bone.locators) continue
        const found = Object.entries(bone.locators).find(([k]) => k.toLowerCase() === key)
        if (!found) continue
        const at = Array.isArray(found[1]) ? found[1] : found[1]?.offset
        if (!Array.isArray(at)) continue
        return { bone, offset: new THREE.Vector3(...mirrorX(at)).sub(bone.pivot) }
      }
    }
    return null
  }

  /**
   * Where an effect on it is in the world: at the locator (and turned as its bone is), else at its feet (turned as it
   * is). Into position and quaternion; false once the model is gone.
   */
  locatorTransform (name, position, quaternion) {
    if (this.disposed) return false
    const found = name ? this.locator(name) : null
    const object = found ? found.bone.group : this.object
    object.updateWorldMatrix(true, false)
    if (found) position.copy(found.offset).applyMatrix4(object.matrixWorld)
    else position.setFromMatrixPosition(object.matrixWorld)
    object.getWorldQuaternion(quaternion)
    return true
  }

  /**
   * Its box ({ width, height }, blocks): its entity data's (boundingbox_width, boundingbox_height), else its model's
   * own size, measured once it has been drawn
   */
  aabb () {
    const md = this.state.metadata ?? {}
    if (md.boundingbox_width > 0 && md.boundingbox_height > 0) return { width: md.boundingbox_width, height: md.boundingbox_height }
    if (!this.measured && this.layers.size) {
      this.object.updateWorldMatrix(true, true)
      const size = new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3())
      if (size.y > 0) this.measured = { width: Math.max(0.1, Math.min(size.x, size.z)), height: size.y }
    }
    return this.measured ?? { width: 1, height: 1 }
  }

  // ---- for the caller --------------------------------------------------------------------------------------------

  // a bone of the first layer that has it (a held item goes on 'rightitem')
  findBone (name) {
    const key = name.toLowerCase()
    for (const layer of this.layers.values()) {
      const bone = layer.skeleton?.bones.get(key)
      if (bone) return bone
    }
    return null
  }

  boneObject (name) {
    return this.findBone(name)?.group ?? null
  }

  dispose () {
    this.disposed = true
    this.stopAllEffects()
    this.attachments.dispose()
    this.poppy?.userData.dispose()
    for (const layer of this.layers.values()) this.disposeLayer(layer)
    this.layers.clear()
    this.object.removeFromParent?.()
  }
}

module.exports = { BedrockEntity, dyeColor }
