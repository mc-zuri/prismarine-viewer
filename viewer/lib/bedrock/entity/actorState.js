// What the Bedrock client keeps of each entity and moves on at 20 Hz from what it is told of it (its moves, its flags
// and entity data, its events), for the packs' scripts to read: the walk animation, the body's turn, the arm's swing,
// hurt and death, swimming, and each kind's own: a sheep eating grass, a cat lying down, wings flapping, a fish's tail,
// a shulker's lid, a polar bear standing, an iron golem's swing. These follow the client's systems as bedrock-engine-v4
// transcribes them (HardcodedAnimationSystem, BodyControlSystem, ActorLegacyTickSystem, CurrentSwimAmountSystem,
// SheepEatAnimationSystem, UpdateLieDownAmountSystem, PolarBearStandAnimationSystem, UpdateWingFlapValueSystem,
// UpdateFishAnimationAmountSystem, HumanoidMonsterAttackStateSystem, the shulker's peek); what it has not ported (a
// horse rearing and swishing its tail, a wolf shaking and tilting its head, a slime's squish, a squid's tentacles, a
// panda sneezing, a rabbit's jump, the dragon's wings and its trail of past places, a glow squid going dark) follows
// Java's client, which the packs' scripts were written against.
//
// Each value keeps its last tick's: the frames between two ticks read them blended by `alpha` (query.frame_alpha).
const TICK = 0.05
const RAD = 180 / Math.PI

// how much faster than its pace each kind's legs swing (the walk animation's multiplier)
const WALK_SPEED = {
  iron_golem: 2.0,
  pig: 1.8,
  villager_v2: 1.8,
  horse: 1.8,
  donkey: 1.8,
  mule: 1.8,
  skeleton_horse: 1.8,
  zombie_horse: 1.8,
  chicken: 1.8,
  creeper: 1.8,
  mooshroom: 1.8,
  npc: 1.8,
  parrot: 1.8,
  bogged: 1.6,
  parched: 1.6,
  skeleton: 1.6,
  stray: 1.6,
  wither_skeleton: 1.6,
  squid: 1.2,
  glow_squid: 1.2,
  cat: 1.2,
  ocelot: 1.2,
  sheep: 1.2,
  wolf: 1.2,
  zombie_pigman: 1.2,
  zombie_villager_v2: 1.2,
  enderman: 1.1
}
const WINGED = ['chicken', 'parrot']
const FISH = ['cod', 'salmon', 'pufferfish', 'tropicalfish']
const HUMANOID_ATTACKERS = ['pillager', 'piglin', 'piglin_brute']
const HORSES = ['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse']
const SLIMES = ['slime', 'magma_cube', 'sulfur_cube']
const SQUIDS = ['squid', 'glow_squid']
// a swing's length in ticks, without haste or mining fatigue
const SWING_TICKS = 6
// the trail of the dragon's past places its neck and tail follow
const HISTORY = 64

const wrap = d => ((d + 180) % 360 + 360) % 360 - 180
const clamp = (v, low, high) => Math.min(Math.max(v, low), high)
const lerp = (a, b, t) => a + (b - a) * t
const lerpRotation = (a, b, t) => a + wrap(b - a) * t
const rotateTowards = (from, to, max) => from + clamp(wrap(to - from), -max, max)

class ActorState {
  /** kind: the identifier without minecraft: */
  constructor (kind) {
    this.kind = kind
    this.alpha = 0
    this.ticks = 0
    this.started = false
    // the tick's place and turn, and the last tick's
    this.pos = { x: 0, y: 0, z: 0 }
    this.posPrev = { x: 0, y: 0, z: 0 }
    this.yaw = 0
    this.yawPrev = 0
    this.body = 0
    this.bodyPrev = 0
    this.stillTicks = 0
    this.lastHeadYaw = 0
    // the walk animation: how fast the legs swing, how far they swung
    this.walkMultiplier = WALK_SPEED[kind] ?? 1
    this.walkSpeed = 0
    this.walkSpeedPrev = 0
    this.walkPos = 0
    this.walkDistance = 0
    // the arm's swing
    this.swinging = false
    this.swingTime = 0
    this.attackAnim = 0
    this.attackAnimPrev = 0
    this.hurtTime = 0
    this.dead = false
    this.deathTicks = 0
    this.swim = 0
    this.swimPrev = 0
    this.useTicks = 0
    // ticks gliding (an elytra flight)
    this.glideTicks = 0
    // each kind's own
    this.eat = 0
    this.stand = 0
    this.standPrev = 0
    this.lieDown = 0
    this.lieDownPrev = 0
    this.lieTail = 0
    this.lieTailPrev = 0
    this.flap = 0
    this.flapPrev = 0
    this.flapSpeed = 0
    this.flapSpeedPrev = 0
    this.flapping = 1
    this.fish = 0
    this.fishPrev = 0
    this.peek = 0
    this.peekPrev = 0
    this.golemAttack = 0
    this.golemFlower = 0
    this.attackState = 0
    this.crossbowCharge = 0
    this.horseStand = 0
    this.horseStandPrev = 0
    this.tail = 0
    this.shaking = false
    this.shake = 0
    this.shakePrev = 0
    this.interest = 0
    this.interestPrev = 0
    this.squish = 0
    this.squishPrev = 0
    this.targetSquish = 0
    this.wasOnGround = true
    this.tentacle = 0
    this.tentaclePrev = 0
    this.tentacleAngle = 0
    this.tentacleAnglePrev = 0
    this.tentacleSpeed = 0.1
    this.pitchBody = 0
    this.pitchBodyPrev = 0
    this.sneeze = 0
    this.roll = 0
    this.jumpTicks = 0
    this.jumpDuration = 0
    this.dragonFlap = 0
    this.dragonFlapPrev = 0
    this.history = []
    this.dark = 0
    this.arrowShake = 0
    this.vibration = -1
  }

  // ---- what it is told --------------------------------------------------------------------------------------------

  /** An arm swing: ignored in the first half of one (Mob::swing). */
  swing () {
    if (this.swinging && this.swingTime >= 0 && this.swingTime < Math.floor(SWING_TICKS / 2)) return
    this.swingTime = -1
    this.swinging = true
  }

  /** An entity event or animate action, by its protocol name; data: the packet's. */
  event (name, data = 0) {
    switch (name) {
      case 'swing':
      case 'swing_arm':
        this.swing()
        break
      // event 4, START_ATTACKING: an iron golem swings its arms; the others their arm
      case 'arm_swing':
      case 'start_attacking':
        if (this.kind === 'iron_golem') this.golemAttack = 10
        this.swing()
        break
      case 'hurt_animation':
      case 'hurt_without_receiving_damage':
        this.hurtTime = 10
        this.walkSpeed = 1.5
        if (this.kind === 'glow_squid') this.dark = 100
        break
      case 'death_animation':
      case 'ender_dragon_death':
        this.dead = true
        break
      case 'respawn':
        this.dead = false
        this.deathTicks = 0
        break
      case 'eat_grass_animation':
        this.eat = 40
        break
      case 'iron_golem_offer_flower':
        this.golemFlower = 400
        break
      case 'iron_golem_withdraw_flower':
        this.golemFlower = 0
        break
      case 'shake_wet':
        this.shaking = true
        this.shake = this.shakePrev = 0
        break
      case 'wetness_stop':
        this.shaking = false
        this.shake = this.shakePrev = 0
        break
      case 'arrow_shake':
        this.arrowShake = data > 0 ? data : 7
        break
      case 'jump':
        this.jumpTicks = 0
        this.jumpDuration = 10
        break
      case 'vibration_detected':
        this.vibration = 0
        break
    }
  }

  // ---- the tick ---------------------------------------------------------------------------------------------------

  /**
   * One tick. input: { position, yaw, headYaw, bodyYaw (the consumer's, else worked out), onGround, inWater, riding,
   * player, flag(name) -> 0 | 1, metadata, health, maxHealth, held }
   */
  tick (input) {
    const pos = input.position ?? this.pos
    if (!this.started) {
      this.started = true
      this.pos = { ...pos }
      this.posPrev = { ...pos }
      this.yaw = this.yawPrev = input.yaw ?? 0
      this.body = this.bodyPrev = input.bodyYaw ?? input.yaw ?? 0
      this.lastHeadYaw = input.headYaw ?? this.body
    }
    this.ticks++
    // the last tick's, kept for the frames between this tick and the next
    this.posPrev = this.pos
    this.pos = { x: pos.x, y: pos.y, z: pos.z }
    this.yawPrev = this.yaw
    this.yaw = input.yaw ?? this.yaw
    this.bodyPrev = this.body
    this.swimPrev = this.swim
    this.attackAnimPrev = this.attackAnim
    const flag = input.flag
    const md = input.metadata ?? {}

    // swimming or crawling: the limbs go over to their swimming pose
    this.swim = flag('swimming') || flag('crawling') ? Math.min(1, this.swim + 0.1) : Math.max(0, this.swim - 0.1)
    if (this.eat > 0) this.eat--
    // using its item (drawing a bow, charging a crossbow, eating...): ticks since it began
    this.useTicks = flag('action') ? (this.useTicks ?? 0) + 1 : 0
    if (this.hurtTime > 0) this.hurtTime--
    this.tickSwing()
    if (HUMANOID_ATTACKERS.includes(this.kind)) this.tickAttackState(flag, md)
    if (this.kind === 'polar_bear') {
      this.standPrev = this.stand
      this.stand = clamp(this.stand + (flag('rearing') ? 1 : -1), 0, 6)
    }
    if (this.kind === 'cat') this.tickLieDown(flag)
    if (this.golemAttack > 0) this.golemAttack--
    if (this.golemFlower > 0) this.golemFlower--
    if (WINGED.includes(this.kind)) this.tickWings(input)
    this.tickWalk(input, flag)
    if (FISH.includes(this.kind)) {
      // the tail beats a step a tick (a moving fish the server moves has no motion of its own)
      this.fishPrev = this.fish
      this.fish += 1
    }
    if (this.kind === 'shulker') this.tickPeek(md)
    this.tickBody(input, flag)
    if (this.dead) this.deathTicks++
    this.useTicks = flag('action') ? this.useTicks + 1 : 0
    this.glideTicks = flag('gliding') ? this.glideTicks + 1 : 0

    if (HORSES.includes(this.kind)) this.tickHorse(flag)
    if (this.kind === 'wolf') this.tickWolf(flag)
    if (SLIMES.includes(this.kind)) this.tickSlime(input)
    if (SQUIDS.includes(this.kind)) this.tickSquid(input)
    if (this.kind === 'panda') {
      this.sneeze = flag('sneezing') ? this.sneeze + 1 : 0
      this.roll = flag('rolling') ? this.roll + 1 : 0
    }
    if (this.jumpDuration > 0 && ++this.jumpTicks > this.jumpDuration) this.jumpDuration = this.jumpTicks = 0
    if (this.kind === 'ender_dragon') this.tickDragon(input)
    if (this.dark > 0) this.dark--
    if (this.arrowShake > 0) this.arrowShake--
    if (this.vibration >= 0) this.vibration++
    if (input.onGround && !flag('sneaking')) this.walkDistance += Math.hypot(this.pos.x - this.posPrev.x, this.pos.z - this.posPrev.z)
  }

  // the arm's swing: 0 to 5/6 over 6 ticks, then done
  tickSwing () {
    let t = 0
    if (this.swinging) {
      t = ++this.swingTime
      if (t >= SWING_TICKS) {
        this.swingTime = 0
        this.swinging = false
        t = 0
      }
    } else {
      this.swingTime = 0
    }
    this.attackAnim = t / SWING_TICKS
  }

  // a piglin's or pillager's crossbow: charged (held up), charging, or neither
  tickAttackState (flag, md) {
    this.attackState = flag('charged') ? 1 : (md.charge_amount > 0 ? 2 : 0)
    this.crossbowCharge = this.attackState === 2 ? Math.min(1, this.crossbowCharge + 1 / 25) : 0
  }

  tickLieDown (flag) {
    this.lieDownPrev = this.lieDown
    this.lieTailPrev = this.lieTail
    if (flag('resting')) {
      this.lieDown = Math.min(1, this.lieDown + 0.15)
      this.lieTail = Math.min(1, this.lieTail + 0.08)
    } else {
      this.lieDown = Math.max(0, this.lieDown - 0.22)
      this.lieTail = Math.max(0, this.lieTail - 0.13)
    }
  }

  // a chicken's or parrot's wings: flapping in the air, folding on the ground or a shoulder
  tickWings (input) {
    this.flapPrev = this.flap
    this.flapSpeedPrev = this.flapSpeed
    const grounded = input.onGround || input.riding
    this.flapSpeed = clamp(this.flapSpeed + (grounded ? -0.3 : 1.2), 0, 1)
    if (!grounded && this.flapping < 1) this.flapping = 1
    this.flapping *= 0.9
    this.flap += this.flapping * 2
  }

  // the legs' swing: faster the farther it went this tick, more when hurt or burning; none while it rides
  tickWalk (input, flag) {
    const moved = Math.hypot(this.pos.x - this.posPrev.x, this.pos.z - this.posPrev.z)
    if (input.riding) {
      this.walkSpeedPrev = this.walkSpeed = 0
      return
    }
    // a blaze burns while charged; a magma cube never counts as burning
    const burning = this.kind === 'blaze' ? flag('charged') : (this.kind === 'magma_cube' ? 0 : flag('onfire'))
    const amplitude = (burning || this.hurtTime !== 0 ? 1.5 : 1) * this.walkMultiplier
    // the body's turn is the last tick's here (the body turns after the walk): standing, it adds nothing
    const step = moved === 0 ? Math.min(0.2, Math.abs(wrap(this.body - this.bodyPrev)) * 0.02) : Math.min(0.4, moved * 1.6)
    this.walkSpeedPrev = this.walkSpeed
    this.walkSpeed = this.walkSpeed * 0.6 + amplitude * step
    this.walkPos += this.walkSpeed
  }

  tickPeek (md) {
    const target = (md.shulker_peek_id ?? 0) * 0.01
    this.peekPrev = this.peek
    if (this.peek < target) this.peek = Math.min(target, Math.max(this.peek + 0.05, 0))
    else this.peek = this.peek - 0.05 > 1 ? 1 : Math.max(this.peek - 0.05, target)
  }

  // the body's yaw: the client works it out, the server sends only the look
  tickBody (input, flag) {
    if (input.bodyYaw !== undefined) {
      this.body = input.bodyYaw
      return
    }
    const head = input.headYaw ?? this.yaw
    const riding = input.riding
    const yaw = this.yaw
    if (this.kind === 'shulker') {
      this.body = yaw
      return
    }
    if (input.player) {
      // a player: toward where it walks, or its look while it swings; never more than 75° from its look
      const dx = this.pos.x - this.posPrev.x
      const dz = this.pos.z - this.posPrev.z
      let target = this.body
      if (Math.hypot(dx, dz) > 0.05) target = Math.atan2(dz, dx) * RAD - 90
      if (this.attackAnim > 0) target = yaw
      let body = wrap(target - this.body) * 0.3 + this.body
      if (!riding) {
        let off = clamp(wrap(yaw - body), -75, 75)
        const over = Math.abs(off)
        if (over > 50) off += off > 0 ? -(over - 50) * 0.75 : (over - 50) * 0.75
        body = yaw - off
      }
      this.body = body
      return
    }
    const blocked = flag('body_rotation_blocked')
    if (flag('body_rotation_axis_aligned')) {
      if (!riding && (!blocked || this.body % 90 !== 0)) this.body = rotateTowards(this.body, yaw, 25)
      this.lastHeadYaw = head
      this.stillTicks = 0
      return
    }
    const dx = this.pos.x - this.posPrev.x
    const dy = this.pos.y - this.posPrev.y
    const dz = this.pos.z - this.posPrev.z
    const moving = dx * dx + dy * dy + dz * dz > 2.5000003e-7
    const leashed = flag('leashed')
    if (moving || leashed || flag('body_rotation_always_follows_head')) {
      if (!riding && !blocked) this.body = rotateTowards(this.body, moving || leashed ? yaw : head, 25)
      this.lastHeadYaw = head
      this.stillTicks = 0
      return
    }
    // standing: the body follows the head when it turns far, and comes round to it after the head stays still
    let max = 75
    if (Math.abs(wrap(head - this.lastHeadYaw)) <= 15) {
      this.stillTicks++
      if (flag('facing_target_to_range_attack')) max = 0
      else if (this.stillTicks >= 11) max = Math.max(0, (this.stillTicks - 10) / -10 + 1) * 75
    } else {
      this.lastHeadYaw = head
      this.stillTicks = 0
    }
    if (!riding && !blocked) this.body = rotateTowards(head, this.body, max)
  }

  // Java's horse: rearing up, and a tail swish now and then
  tickHorse (flag) {
    this.horseStandPrev = this.horseStand
    if (flag('rearing')) this.horseStand = Math.min(1, this.horseStand + (1 - this.horseStand) * 0.4 + 0.05)
    else this.horseStand = Math.max(0, this.horseStand - this.horseStand * 0.4 - 0.05)
    if (this.tail > 0 && ++this.tail > 8) this.tail = 0
    if (this.tail === 0 && Math.random() < 1 / 200) this.tail = 1
  }

  // Java's wolf: its head tilts while interested; it shakes the water off over 2 seconds
  tickWolf (flag) {
    this.interestPrev = this.interest
    this.interest += (flag('interested') - this.interest) * 0.4
    this.shakePrev = this.shake
    if (this.shaking) {
      this.shake += 0.05
      if (this.shakePrev >= 2) {
        this.shaking = false
        this.shake = this.shakePrev = 0
      }
    }
  }

  // Java's slime: squashed as it lands, stretched as it jumps, settling back
  tickSlime (input) {
    this.squishPrev = this.squish
    this.squish += (this.targetSquish - this.squish) * 0.5
    const onGround = !!input.onGround
    if (onGround && !this.wasOnGround) this.targetSquish = -0.5
    else if (!onGround && this.wasOnGround) this.targetSquish = 1
    this.wasOnGround = onGround
    this.targetSquish *= 0.6
  }

  // Java's squid: its tentacles beat in water and flop on land; its body leans the way it swims
  tickSquid (input) {
    this.tentaclePrev = this.tentacle
    this.tentacleAnglePrev = this.tentacleAngle
    this.pitchBodyPrev = this.pitchBody
    this.tentacle += this.tentacleSpeed
    if (this.tentacle > Math.PI * 2) {
      this.tentacle -= Math.PI * 2
      if (Math.random() < 0.1) this.tentacleSpeed = 1 / (Math.random() + 1) * 0.2
    }
    if (input.inWater) {
      if (this.tentacle < Math.PI) {
        const f = this.tentacle / Math.PI
        this.tentacleAngle = Math.sin(f * f * Math.PI) * Math.PI * 0.25
      } else {
        this.tentacleAngle = 0
      }
      const dx = this.pos.x - this.posPrev.x
      const dy = this.pos.y - this.posPrev.y
      const dz = this.pos.z - this.posPrev.z
      this.pitchBody += (-Math.atan2(Math.hypot(dx, dz), dy) * RAD - this.pitchBody) * 0.1
    } else {
      this.tentacleAngle = Math.abs(Math.sin(this.tentacle)) * Math.PI * 0.25
      this.pitchBody += (-90 - this.pitchBody) * 0.02
    }
  }

  // Java's dragon: its wings beat slower the faster it flies; its neck and tail follow where it was
  tickDragon (input) {
    this.dragonFlapPrev = this.dragonFlap
    if (!this.dead) {
      const dx = this.pos.x - this.posPrev.x
      const dy = this.pos.y - this.posPrev.y
      const dz = this.pos.z - this.posPrev.z
      const f = 0.2 / (Math.hypot(dx, dz) * 10 + 1) * Math.pow(2, dy)
      this.dragonFlap += input.flag('sitting') ? f * 0.5 : f
    }
    this.history.unshift({ rot_y: this.yaw, pos_y: this.pos.y })
    if (this.history.length > HISTORY) this.history.length = HISTORY
  }

  // ---- read between ticks -----------------------------------------------------------------------------------------

  blend (prev, cur) {
    return lerp(prev, cur, this.alpha)
  }

  /** The body's yaw this frame. */
  bodyYaw () {
    return lerpRotation(this.bodyPrev, this.body, this.alpha)
  }

  /** variable.attack_time: the swing's progress, -1 when it swings none. */
  attackTime () {
    if (!this.swinging) return -1
    let d = this.attackAnim - this.attackAnimPrev
    if (d < 0) d += 1
    return this.attackAnimPrev + d * this.alpha
  }

  /** query.modified_move_speed */
  moveSpeed () {
    return this.blend(this.walkSpeedPrev, this.walkSpeed)
  }

  /** query.modified_distance_moved */
  distanceMoved () {
    return this.walkPos - this.walkSpeed * (1 - this.alpha)
  }

  /** The tick's movement: [dx, dy, dz] */
  delta () {
    return [this.pos.x - this.posPrev.x, this.pos.y - this.posPrev.y, this.pos.z - this.posPrev.z]
  }

  /** The death's tip over: degrees, 90 when it lies on its side. */
  deathFlip () {
    if (!this.dead || this.kind === 'ender_dragon') return 0
    const t = Math.sqrt(Math.max(0, (this.deathTicks + this.alpha - 1) / 20 * 1.6))
    return Math.min(1, t) * 90
  }

  /**
   * A glide's tilt: degrees forward from upright, which the client turns the body by itself (the packs only lift the
   * head 45° for it): over its first 10 ticks it comes to lie along the look, 90° and the look's pitch (degrees, down),
   * as Java's player renderer turns it.
   */
  glideTilt (pitch = 0) {
    if (!this.glideTicks) return 0
    const t = this.glideTicks - 1 + this.alpha
    return clamp(t * t / 100, 0, 1) * (90 + pitch)
  }

  /** The red of a hurt or a death. */
  hurt () {
    return this.hurtTime > 0 || (this.dead && this.kind !== 'ender_dragon')
  }

  /** The past place `ticks` ago, for the dragon's neck and tail. */
  past (ticks) {
    return this.history[Math.min(ticks, this.history.length - 1)] ?? { rot_y: this.yaw, pos_y: this.pos.y }
  }
}

module.exports = { ActorState, WALK_SPEED, TICK, wrap }
