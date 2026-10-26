// The Molang queries of an entity (query.x / q.x), as the client answers them: from what the consumer told the model
// (its entity data, flags, properties, health, what it holds and wears, what it rides, how it moves, whether it is on
// the ground or in water) and from what the model works out tick by tick (actorState.js: the walk, the body's turn,
// the swing, hurt and death, each kind's timers). A query the consumer provides (model.provide) answers first; one
// nothing answers is 0.
const { num } = require('./molang')
const { wrap } = require('./actorState')

// query.is_<x> -> the entity flag of another name (minecraft-data's names of the flags)
const FLAG_OF = {
  is_on_fire: 'onfire',
  is_onfire: 'onfire',
  is_in_love: 'inlove',
  is_casting: 'evoker_spell',
  is_charging: 'charge_attack',
  is_wall_climbing: 'wallclimbing',
  is_standing: 'rearing',
  is_using_item: 'action',
  is_shaking: 'vibrating',
  is_in_ui: 'is_in_ui',
  show_bottom: 'showbase',
  blocking: 'blocking',
  is_eating_mob: 'eat_mob',
  is_jump_goal_jumping: 'jump_goal_jump',
  is_sonic_boom: 'sonic_boom',
  has_dash_cooldown: 'has_dash_cooldown',
  is_ram_attacking: 'ram_attack',
  timer_flag_1: 'timer_flag_1',
  timer_flag_2: 'timer_flag_2',
  timer_flag_3: 'timer_flag_3',
  facing_target_to_range_attack: 'facing_target_to_range_attack',
  is_spin_attacking: 'spin_attack'
}

// the equipment slots queries name: 'main_hand', 'slot.weapon.mainhand', 'slot.armor.head', or a slot number
const SLOTS = {
  main_hand: 'mainhand',
  'slot.weapon.mainhand': 'mainhand',
  off_hand: 'offhand',
  'slot.weapon.offhand': 'offhand',
  'slot.armor.head': 'head',
  'slot.armor.chest': 'chest',
  'slot.armor.legs': 'legs',
  'slot.armor.feet': 'feet',
  'slot.armor.body': 'body'
}
const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet', 'body']
const slotOf = (arg, fallback = 'mainhand') => {
  if (typeof arg === 'number') return arg === 1 ? 'offhand' : fallback
  return SLOTS[String(arg ?? '').toLowerCase()] ?? fallback
}
// horse armor by its material: the render controller's Array.armor (none, leather, iron, gold, diamond, copper, netherite)
const ARMOR_MATERIALS = ['leather', 'iron', 'gold', 'diamond', 'copper', 'netherite']
// a leather armor's undyed colour
const LEATHER = [0xA0 / 255, 0x65 / 255, 0x40 / 255]
// an experience orb's icon by its value (Java's ExperienceOrb.getIcon)
const ORB_VALUES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3]

const strip = name => String(name ?? '').replace(/^minecraft:/, '')

// how long an item is used for, in ticks, as the game has it (a bow is drawn, a shield held up, as long as wanted)
const USE_TICKS = { bow: 72000, crossbow: 25, trident: 72000, shield: 72000, spyglass: 1200, goat_horn: 140, brush: 200, honey_bottle: 40, potion: 32, milk_bucket: 32, ominous_bottle: 32, dried_kelp: 16 }
const useTicksOf = item => USE_TICKS[strip(item)] ?? (item ? 32 : 0)
// an item in use: its ticks left (counting down from its whole use, as main_hand_item_use_duration does), 0 when not
function useLeft (model, slot) {
  const a = model.actor
  const item = model.equipment[slot]
  if (!a.useTicks || !item) return 0
  return Math.max(0, useTicksOf(item) - a.useTicks + 1 - a.alpha)
}
const known = id => id !== undefined && id !== null && id !== -1 && id !== 0

function armorTextureSlot (item) {
  if (!item) return 0
  const name = strip(item)
  const i = ARMOR_MATERIALS.findIndex(material => name.includes(material))
  return i + 1
}

function query (model, name, args) {
  const provided = model.provided.queries[name]
  if (provided !== undefined) return typeof provided === 'function' ? provided(args) : provided
  const md = model.state.metadata ?? {}
  const m = model.motion
  const a = model.actor
  const equipment = model.equipment
  switch (name) {
    case 'life_time': return model.lifeTime
    case 'anim_time': return model.ctx.animTime ?? 0
    case 'delta_time': return model.dt
    case 'time_stamp': return a.ticks
    case 'frame_alpha': return a.alpha
    case 'key_frame_lerp_time': return model.ctx.keyFrameLerpTime ?? 0
    case 'modified_move_speed': return a.moveSpeed()
    case 'modified_distance_moved': return a.distanceMoved()
    case 'walk_distance': return a.walkDistance
    case 'ground_speed': { const [dx, , dz] = a.delta(); return Math.hypot(dx, dz) * 20 }
    case 'vertical_speed': return a.delta()[1] * 20
    case 'yaw_speed': return wrap(a.yaw - a.yawPrev) * 20
    case 'position_delta': return a.delta()[num(args[0])] ?? 0
    case 'movement_direction': {
      const d = a.delta()
      const len = Math.hypot(...d)
      return len ? d[num(args[0])] / len : 0
    }
    case 'is_moving': { const [dx, , dz] = a.delta(); return Math.hypot(dx, dz) > 0.001 || model.flag('moving') ? 1 : 0 }
    case 'is_on_ground': return m.onGround === false ? 0 : 1
    case 'is_in_water': case 'is_in_water_or_rain': return m.inWater || model.flag('swimming') ? 1 : 0
    case 'is_in_lava': return m.inLava ? 1 : 0
    case 'is_alive': return a.dead ? 0 : 1
    case 'target_x_rotation': case 'head_x_rotation': case 'eye_target_x_rotation': return m.pitch ?? 0
    case 'target_y_rotation': case 'head_y_rotation': case 'eye_target_y_rotation': return wrap((m.headYaw ?? m.yaw ?? 0) - a.bodyYaw())
    case 'body_y_rotation': return a.bodyYaw()
    case 'body_x_rotation': return a.blend(a.pitchBodyPrev, a.pitchBody)
    case 'variant': return md.variant ?? 0
    case 'mark_variant': return md.mark_variant ?? 0
    case 'skin_id': return md.skin_id ?? 0
    case 'color': return md.color ?? 0
    case 'trade_tier': return md.trade_tier ?? 0
    case 'model_scale': return model.modelScale()
    case 'standing_scale': return a.blend(a.standPrev, a.stand) / 6
    case 'swell_amount': return md.creeper_swell ? md.creeper_swell / 30 : 0
    case 'swelling_dir': return md.creeper_swell_direction ?? 0
    case 'fuse_time': return md.fuse_length ?? 0
    case 'sit_amount': return md.sitting_amount ?? 0
    case 'lie_amount': return md.laying_amount ?? 0
    // full, unless told (an iron golem's cracks go by it)
    // an item in use: what is left of its use (ticks), its whole use, and what is left in seconds (or as a part of
    // the normalisation given); a crossbow is charged when its flag says so
    case 'main_hand_item_use_duration': return useLeft(model, 'mainhand')
    case 'main_hand_item_max_duration': return useTicksOf(model.equipment.mainhand)
    case 'item_remaining_use_duration': {
      const left = useLeft(model, slotOf(args[0])) / 20
      return args[1] ? left / num(args[1]) : left
    }
    case 'item_is_charged': return model.flag('charged') ? 1 : 0
    // the wither's armour: below half its health, or powered as the server says
    case 'is_shield_powered': {
      const { health, maxHealth } = model.state
      return model.flag('powered') || (health !== undefined && maxHealth && health <= maxHealth / 2) ? 1 : 0
    }
    case 'health': return model.state.health ?? model.state.maxHealth ?? 100
    case 'max_health': return model.state.maxHealth ?? model.state.health ?? 100
    case 'life_span': return md.limited_life ?? 0
    case 'camera_rotation': return model.cameraRotation()[num(args[0])] ?? 0
    // the colour of an evoker's spell, which the particles of it take: its entity data's (ARGB), else the one it
    // summons vexes with
    case 'spellcolor.r': case 'spellcolor.g': case 'spellcolor.b': case 'spellcolor.a': {
      const argb = md.evoker_spell_casting_color
      if (typeof argb !== 'number' || !argb) return { r: 0.7, g: 0.7, b: 0.8, a: 1 }[name.slice(-1)]
      return ((argb >>> { a: 24, r: 16, g: 8, b: 0 }[name.slice(-1)]) & 255) / 255
    }
    case 'property': {
      const v = model.state.properties?.[String(args[0]).toLowerCase()]
      return v === undefined ? 0 : v
    }
    case 'has_property': return model.state.properties && String(args[0]).toLowerCase() in model.state.properties ? 1 : 0
    case 'get_name': return model.state.name ?? ''

    // what it holds and wears
    case 'is_item_equipped': return equipment[slotOf(args[0])] ? 1 : 0
    case 'get_equipped_item_name': {
      const item = equipment[slotOf(args[0])]
      return item ? strip(item) : ''
    }
    case 'is_item_name_any': {
      const item = equipment[slotOf(args[0])]
      const full = item ? 'minecraft:' + strip(item) : ''
      return args.slice(2).some(a => a === full || a === strip(item)) ? 1 : 0
    }
    case 'has_head_gear': return equipment.head ? 1 : 0
    case 'armor_texture_slot': return armorTextureSlot(equipment[ARMOR_SLOTS[num(args[0])] ?? 'body'])
    case 'armor_color_slot': return LEATHER[num(args[1])] ?? 1
    case 'equipment_count': return ARMOR_SLOTS.filter(slot => equipment[slot]).length

    // what it rides, and what rides it
    case 'is_riding': return model.flag('riding') || model.state.vehicle ? 1 : 0
    case 'has_rider': return model.state.riders?.length ? 1 : 0
    case 'is_riding_any_entity_of_type': {
      const vehicle = strip(model.state.vehicle)
      return vehicle && args.some(a => strip(a) === vehicle) ? 1 : 0
    }

    // what its entity data says
    case 'hurt_time': return typeof md.hurt_time === 'number' ? md.hurt_time : a.hurtTime
    case 'hurt_direction': return md.hurt_direction ?? 0
    // a minecart's or boat's health
    case 'structural_integrity': return md.health ?? 40
    case 'invulnerable_ticks': return md.wither_invulnerable_ticks ?? 0
    case 'texture_frame_index': {
      const value = md.experience_value ?? 0
      const i = ORB_VALUES.findIndex(least => value >= least)
      return i === -1 ? 0 : ORB_VALUES.length - i
    }
    case 'has_target': return known(md.target_eid) ? 1 : 0
    case 'has_owner': return known(md.owner_eid) ? 1 : 0
    case 'is_carrying_block': return model.state.carrying ? 1 : 0

    // what the client works out of it
    case 'is_grazing': return a.eat > 0 || model.flag('eating') ? 1 : 0
    case 'death_ticks': return a.deathTicks
    case 'swim_amount': return a.blend(a.swimPrev, a.swim)
    case 'wing_flap_position': return model.identifier === 'minecraft:ender_dragon' ? a.blend(a.dragonFlapPrev, a.dragonFlap) : a.blend(a.flapPrev, a.flap)
    case 'wing_flap_speed': return a.blend(a.flapSpeedPrev, a.flapSpeed)
    case 'previous_squish_value': return a.squishPrev
    case 'current_squish_value': return a.squish
    case 'shake_time': return a.arrowShake
    case 'is_shaking_wetness': return a.shaking ? 1 : 0
    case 'shake_angle': return a.shakePrev
    case 'head_roll_angle': return a.blend(a.interestPrev, a.interest) * 0.15 * Math.PI
    case 'tail_angle': {
      if (model.flag('angry')) return 1.5393804
      if (!model.flag('tamed')) return Math.PI / 5
      const max = model.state.maxHealth ?? 20
      return (0.55 - (max - (model.state.health ?? max)) * 0.02) * Math.PI
    }
    case 'sneeze_counter': return a.sneeze
    case 'roll_counter': return a.roll
    case 'time_since_last_vibration_detection': return a.vibration < 0 ? -1 : a.vibration / 20
    case 'heartbeat_phase': {
      const interval = md.heartbeat_interval_ticks
      return interval > 0 ? (a.ticks % interval) / interval : 0
    }
    case 'get_default_bone_pivot': {
      const bone = model.findBone(String(args[0]))
      if (!bone) return 0
      const axis = num(args[1])
      return axis === 0 ? -bone.pivot.x : bone.pivot.getComponent(axis)
    }
    case 'all_animations_finished': return model.ctx.stateFinished?.all ? 1 : 0
    case 'any_animation_finished': return model.ctx.stateFinished?.any ? 1 : 0
    case 'is_sneaking': return model.flag('sneaking')
    case 'is_baby': return model.flag('baby')
    case 'is_sheared': return model.flag('sheared')
  }
  if (FLAG_OF[name]) return model.flag(FLAG_OF[name])
  if (name.startsWith('is_')) return model.flag(name.slice(3))
  if (name.startsWith('has_')) return model.flag(name)
  return 0
}

module.exports = { query, FLAG_OF, armorTextureSlot }
