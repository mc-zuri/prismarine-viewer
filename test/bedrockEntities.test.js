/**
 * @jest-environment node
 */
/* eslint-env jest */
// Bedrock entities (viewer/lib/bedrock/entity): geometry files as packs and skins write them, a player's skin or the
// pack's Steve and Alex, poly meshes, what the game sets for the packs' scripts, and the boats the game draws itself.
// The tests of a version's own entities read them from its minecraft-assets, as prerender.js builds them for the
// page; they are skipped where minecraft-assets has no Bedrock entities of the version.
const THREE = require('three')
const mcAssets = require('minecraft-assets')
const { geometryEntries, resolveGeometry } = require('../viewer/lib/bedrock/entity/geometryFormat')
const { buildSkeleton } = require('../viewer/lib/bedrock/entity/geometry')
const { skinOverrides } = require('../viewer/lib/bedrock/entity/skin')
const { BedrockEntity } = require('../viewer/lib/bedrock/entity/model')
const { ActorState } = require('../viewer/lib/bedrock/entity/actorState')
const { channel } = require('../viewer/lib/bedrock/entity/animation')
const { entityAssets } = require('../viewer/lib/bedrock/entity/prerender')

const built = new Map()
// a version's entity assets as the page loads them, null when minecraft-assets has no Bedrock entities of it
function assets (version) {
  if (!built.has(version)) {
    const versionAssets = (mcAssets.bedrockVersions ?? []).includes(version) ? mcAssets('bedrock_' + version) : null
    built.set(version, versionAssets?.entities ? entityAssets(versionAssets).data : null)
  }
  return built.get(version)
}
// a test of a version's entities, skipped when there are none
const withAssets = version => assets(version) ? test : test.skip

describe('geometry files', () => {
  test('a 1.8 definition takes its parent\'s bones, each with what its own bone of that name says over it', () => {
    const head = { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }
    const file = {
      'geometry.base': { texturewidth: 64, textureheight: 32, bones: [{ name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }] }, { name: 'head', pivot: [0, 24, 0], cubes: [head] }] },
      'geometry.child:geometry.base': { bones: [{ name: 'head', pivot: [0, 20, 0], bind_pose_rotation: [10, 0, 0] }, { name: 'tail', pivot: [0, 10, 0] }] },
      // the armour pieces: the bones inflated, those a piece does not cover reset
      'geometry.armor:geometry.base': { bones: [{ name: 'head', inflate: 1 }, { name: 'body', inflate: 1.01 }] },
      'geometry.armor.helmet:geometry.armor': { bones: [{ name: 'body', reset: true }] }
    }
    const defs = new Map(geometryEntries(file).map(e => [e.id, e]))
    const geo = resolveGeometry('geometry.child', defs)
    expect(geo.bones.map(b => b.name)).toEqual(['body', 'head', 'tail'])
    expect(geo.bones[1]).toEqual({ name: 'head', pivot: [0, 20, 0], bind: [10, 0, 0], cubes: [head] })
    expect([geo.texture_width, geo.texture_height]).toEqual([64, 32])

    const helmet = resolveGeometry('geometry.armor.helmet', defs)
    expect(helmet.bones.map(b => [b.name, b.inflate, b.cubes?.length ?? 0])).toEqual([['body', 1.01, 0], ['head', 1, 1]])
  })

  test('a parent the file lacks is looked up elsewhere: a skin built on the pack\'s geometry', () => {
    const humanoid = { texture_width: 64, texture_height: 64, bones: [{ name: 'head', pivot: [0, 24, 0] }] }
    const defs = new Map(geometryEntries({ 'geometry.mine:geometry.humanoid': { bones: [{ name: 'hat', pivot: [0, 24, 0] }] } }).map(e => [e.id, e]))
    expect(resolveGeometry('geometry.mine', defs, id => id === 'geometry.humanoid' ? humanoid : null).bones.map(b => b.name)).toEqual(['head', 'hat'])
  })
})

describe('poly meshes', () => {
  // a quad facing up at y 24, whichever way its corners are listed
  const quad = {
    texture_width: 64,
    texture_height: 64,
    bones: [{
      name: 'body',
      pivot: [0, 24, 0],
      poly_mesh: { normalized_uvs: true, positions: [[-4, 24, -2], [-4, 24, 2], [4, 24, 2], [4, 24, -2]], normals: [[0, 1, 0]], uvs: [[0, 0], [0, 0.25], [0.5, 0.25], [0.5, 0]], polys: [[[0, 0, 0], [1, 0, 1], [2, 0, 2], [3, 0, 3]]] }
    }]
  }

  test('its faces are wound by their normals, and its uvs run from the bottom', () => {
    const { bones } = buildSkeleton(quad)
    const geometry = bones.get('body').geometry
    const position = geometry.attributes.position
    const index = geometry.index.array
    expect(index.length).toBe(6)
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(position, index[t + k]))
      const normal = b.sub(a).cross(c.sub(a))
      expect(normal.y).toBeGreaterThan(0)
    }
    expect(Array.from(geometry.attributes.uv.array.slice(0, 4))).toEqual([0, 1, 0, 0.75])
  })
})

describe('player skins', () => {
  const pack = assets('1.26.51')
  const pixels = (width, height, alpha = 255) => {
    const data = new Uint8Array(width * height * 4).fill(200)
    for (let i = 3; i < data.length; i += 4) data[i] = alpha
    return data
  }

  withAssets('1.26.51')('a skin the game\'s geometry draws is the player\'s own', () => {
    const skin = { image: { width: 64, height: 64, data: pixels(64, 64) }, resourcePatch: '{"geometry":{"default":"geometry.humanoid.customSlim"}}', geometryData: '', armSize: 'slim' }
    const overrides = skinOverrides(pack, skin)
    expect(overrides.own).toBe(true)
    expect(overrides.textures.default.image.width).toBe(64)
    expect(overrides.geometry.default.bones.some(b => b.name === 'head')).toBe(true)
  })

  withAssets('1.26.51')('a skin that cannot be drawn whole is Steve, or Alex for slim arms', () => {
    const steve = { own: false, textures: { default: 'textures/entity/steve' }, geometry: { default: 'geometry.humanoid.custom' } }
    const alex = { own: false, textures: { default: 'textures/entity/alex' }, geometry: { default: 'geometry.humanoid.customSlim' } }
    expect(skinOverrides(pack, null)).toEqual(steve)
    expect(skinOverrides(pack, { armSize: 'slim' })).toEqual(alex)
    // see-through, cut short, a geometry no one has, a persona without its head (bedrock-protocol's default skin)
    const patch = '{"geometry":{"default":"geometry.humanoid.custom"}}'
    expect(skinOverrides(pack, { image: { width: 64, height: 64, data: pixels(64, 64, 0) }, resourcePatch: patch, geometryData: '', armSize: 'wide' })).toEqual(steve)
    expect(skinOverrides(pack, { image: { width: 64, height: 64, data: pixels(64, 32) }, resourcePatch: patch, geometryData: '', armSize: 'wide' })).toEqual(steve)
    expect(skinOverrides(pack, { image: { width: 64, height: 64, data: pixels(64, 64) }, resourcePatch: '{"geometry":{"default":"geometry.nowhere"}}', geometryData: '', armSize: 'wide' })).toEqual(steve)
    const headless = { format_version: '1.14.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.persona_x' }, bones: [{ name: 'head', pivot: [0, 24, 0] }, quadBone('body')] }] }
    expect(skinOverrides(pack, { image: { width: 64, height: 64, data: pixels(64, 64) }, resourcePatch: '{"geometry":{"default":"geometry.persona_x"}}', geometryData: JSON.stringify(headless), armSize: 'wide' })).toEqual(steve)
  })

  // every version has Steve and Alex and their geometry
  for (const version of ['1.16.201', '1.20.80', '1.26.51']) {
    withAssets(version)(`${version} has Steve and Alex`, () => {
      const data = assets(version)
      for (const path of ['textures/entity/steve', 'textures/entity/alex']) expect(data.textureFiles[path]).toBeTruthy()
      for (const id of ['geometry.humanoid.custom', 'geometry.humanoid.customSlim']) expect(data.geometry[id]).toBeTruthy()
    })
  }
})

function quadBone (name) {
  return { name, pivot: [0, 24, 0], poly_mesh: { normalized_uvs: true, positions: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], normals: [[0, 0, 1]], uvs: [[0, 0], [1, 0], [1, 1]], polys: [[[0, 0, 0], [1, 0, 1], [2, 0, 2]]] } }
}

// an entity of no geometry: its scripts and animations run all the same
const fake = {
  entities: {
    'test:thing': {
      scripts: { pre_animation: ['v.limbs = 2 / v.gliding_speed_value;'], animate: ['move'] },
      animations: { move: 'controller.animation.test.move', walk: 'animation.test.walk' }
    }
  },
  geometry: {},
  render_controllers: {},
  animations: {
    'animation.test.walk': { loop: true, bones: { leg: { rotation: [10, 0, 0] } } },
    'animation.test.wave': { animation_length: 0.5, bones: { arm: { rotation: [90, 0, 0] } } }
  },
  animation_controllers: {
    'controller.animation.test.move': { initial_state: 'default', states: { default: { animations: ['walk'] }, other: {} } }
  },
  materials: {},
  texture: () => null
}
const ticks = (model, n) => { for (let i = 0; i < n; i++) model.update(0.05) }
const q = (model, name, ...args) => model.query(name, args)

describe('what the game sets', () => {
  test('the glide speed the walk divides by, the swing (-1 between swings), the hands', () => {
    const model = new BedrockEntity(fake, 'test:thing')
    model.setState({ held: 'iron_sword' })
    model.update(0.05)
    expect(model.variables.limbs).toBe(2)
    expect(model.variables.attack_time).toBe(-1)
    expect(model.variables.is_holding_right).toBe(1)
    model.swing()
    ticks(model, 1)
    expect(model.variables.attack_time).toBe(0)
    // a frame on a tick shows the tick before; one between two ticks, a blend of them
    ticks(model, 3)
    expect(model.variables.attack_time).toBeCloseTo(2 / 6)
    model.update(0.025)
    expect(model.variables.attack_time).toBeCloseTo(2 / 6 + 1 / 12)
    expect(q(model, 'frame_alpha')).toBeCloseTo(0.5)
    ticks(model, 3)
    expect(model.variables.attack_time).toBe(-1)
  })

  test('the walk animation is the client\'s: a pig\'s legs swing 1.8 times as far, none while it rides', () => {
    for (const [kind, multiplier] of [['cow', 1], ['pig', 1.8]]) {
      const actor = new ActorState(kind)
      const input = (x, riding = false) => ({ position: { x, y: 64, z: 0 }, yaw: 0, headYaw: 0, onGround: true, riding, flag: () => 0, metadata: {} })
      let speed = 0
      let pos = 0
      for (let i = 0; i <= 10; i++) {
        actor.tick(input(i * 0.1))
        if (i === 0) continue
        speed = speed * 0.6 + multiplier * Math.min(0.4, 0.1 * 1.6)
        pos += speed
      }
      expect(actor.walkSpeed).toBeCloseTo(speed)
      expect(actor.walkPos).toBeCloseTo(pos)
      actor.tick(input(1.1, true))
      expect(actor.walkSpeed).toBe(0)
    }
  })

  test('a mob\'s body comes round to its head once it stands still; a player\'s keeps within 75° of its look', () => {
    const cow = new ActorState('cow')
    const still = (headYaw, yaw = 0) => ({ position: { x: 0, y: 64, z: 0 }, yaw, headYaw, onGround: true, flag: () => 0, metadata: {} })
    cow.tick(still(0))
    cow.tick(still(60))
    expect(cow.body).toBeCloseTo(0)
    cow.tick(still(100))
    expect(cow.body).toBeCloseTo(25)
    for (let i = 0; i < 20; i++) cow.tick(still(100))
    expect(cow.body).toBeCloseTo(100)

    const player = new ActorState('player')
    player.tick({ ...still(0), player: true })
    player.tick({ ...still(120, 120), player: true })
    expect(player.body).toBeCloseTo(63.75)
  })

  test('hurt: 10 ticks of red and a kick of the legs; death: it tips over on its side in 20 ticks', () => {
    const model = new BedrockEntity(fake, 'test:thing')
    model.update(0.05)
    model.event('hurt_animation')
    expect(model.actor.hurt()).toBe(true)
    expect(model.actor.walkSpeed).toBe(1.5)
    ticks(model, 1)
    expect(q(model, 'hurt_time')).toBe(9)
    ticks(model, 9)
    expect(model.actor.hurt()).toBe(false)
    model.event('death_animation')
    ticks(model, 20)
    expect(q(model, 'is_alive')).toBe(0)
    expect(q(model, 'death_ticks')).toBe(20)
    expect(model.model.rotation.z).toBeCloseTo(Math.PI / 2)
    expect(model.actor.hurt()).toBe(true)
  })

  test('gliding, the body comes to lie along the look in 10 ticks, as the client turns it; upright again after', () => {
    const model = new BedrockEntity(fake, 'test:thing')
    model.setState({ metadata: { flags: { gliding: true } } })
    model.setMotion({ pitch: 20, onGround: false })
    ticks(model, 3)
    expect(-model.model.rotation.x).toBeGreaterThan(0)
    expect(-model.model.rotation.x).toBeLessThan(Math.PI / 4)
    ticks(model, 10)
    expect(-model.model.rotation.x).toBeCloseTo(110 * Math.PI / 180)
    model.setState({ metadata: { flags: {} } })
    ticks(model, 1)
    expect(model.model.rotation.x).toBeCloseTo(0)
  })

  test('a sheep grazes for 40 ticks after it eats grass; keyframes read how far between them they are', () => {
    const model = new BedrockEntity(fake, 'test:thing')
    model.actor.kind = 'sheep'
    model.update(0.05)
    model.event('eat_grass_animation')
    ticks(model, 39)
    expect(q(model, 'is_grazing')).toBe(1)
    ticks(model, 1)
    expect(q(model, 'is_grazing')).toBe(0)
    const ctx = { variables: {}, context: {}, temp: {}, query: name => name === 'key_frame_lerp_time' ? ctx.keyFrameLerpTime : 0 }
    expect(channel({ 0.2: ['query.key_frame_lerp_time * 100', 0, 0], 1.8: ['query.key_frame_lerp_time * 100', 0, 0] }, 1, ctx, [0, 0, 0])[0]).toBeCloseTo(50)
  })

  test('flags by the names their queries give them; water, ground, riders, equipment', () => {
    const model = new BedrockEntity(fake, 'test:thing')
    model.setState({ metadata: { flags: { rearing: true, action: true, vibrating: true, showbase: true } }, vehicle: 'minecart', riders: ['zombie'], equipment: { mainhand: 'iron_sword', head: 'iron_helmet', body: 'diamond_horse_armor' } })
    model.setMotion({ inWater: true, onGround: false })
    model.update(0.05)
    for (const name of ['is_standing', 'is_using_item', 'is_shaking', 'show_bottom', 'is_in_water', 'has_rider', 'has_head_gear', 'is_riding']) expect([name, q(model, name)]).toEqual([name, 1])
    expect(q(model, 'is_on_ground')).toBe(0)
    expect(q(model, 'is_riding_any_entity_of_type', 'minecraft:boat', 'minecraft:minecart')).toBe(1)
    expect(q(model, 'armor_texture_slot', 4)).toBe(4)
    expect(q(model, 'is_item_name_any', 'slot.weapon.mainhand', 0, 'minecraft:iron_sword')).toBe(1)
    expect(q(model, 'get_equipped_item_name', 'main_hand')).toBe('iron_sword')
  })

  withAssets('1.26.51')('the dragon is put together as the client does: tips on its wings, its right side mirrored, a neck and a tail', () => {
    const dragon = new BedrockEntity({ ...assets('1.26.51'), texture: () => null }, 'minecraft:ender_dragon')
    dragon.setMotion({ position: { x: 0, y: 64, z: 0 }, yaw: 0, headYaw: 0, pitch: 0 })
    ticks(dragon, 10)
    dragon.object.updateMatrixWorld(true)
    const at = name => dragon.findBone(name).group.getWorldPosition(new THREE.Vector3())
    const middle = at('body').x
    // each wing reaches out its own side, its tip further out
    expect(at('wing').x).toBeLessThan(middle)
    expect(at('wingtip').x).toBeLessThan(at('wing').x)
    expect(at('wing1').x).toBeGreaterThan(middle)
    expect(at('wingtip1').x).toBeGreaterThan(at('wing1').x)
    expect(at('wing1').x - middle).toBeCloseTo(middle - at('wing').x, 5)
    // the head leads, past five pieces of neck; twelve pieces of tail trail behind; the feet hang below
    expect(at('head').z).toBeGreaterThan(at('neck5').z)
    expect(at('neck1').z).toBeGreaterThan(at('body').z)
    expect(at('tail12').z).toBeLessThan(at('tail1').z)
    expect(at('frontfoot1').y).toBeLessThan(at('frontleg1').y)
  })

  withAssets('1.26.51')('a fish swims upright in water and flops on land', () => {
    const data = assets('1.26.51')
    const cod = new BedrockEntity({ ...data, texture: () => null }, 'minecraft:cod')
    cod.setMotion({ position: { x: 0, y: 60, z: 0 }, inWater: true })
    ticks(cod, 5)
    expect(cod.variables.zrot).toBe(0)
    expect(cod.variables.animationamount).toBeGreaterThan(cod.variables.animationamountprev)
    cod.setMotion({ inWater: false })
    ticks(cod, 2)
    expect(cod.variables.zrot).not.toBe(0)
  })

  test('a polar bear stands up over 6 ticks; a cat lies down', () => {
    const flags = set => name => set.includes(name) ? 1 : 0
    const bear = new ActorState('polar_bear')
    const cat = new ActorState('cat')
    for (let i = 0; i < 6; i++) bear.tick({ position: { x: 0, y: 0, z: 0 }, flag: flags(['rearing']), metadata: {} })
    expect(bear.stand / 6).toBe(1)
    for (let i = 0; i < 7; i++) cat.tick({ position: { x: 0, y: 0, z: 0 }, flag: flags(['resting']), metadata: {} })
    expect(cat.lieDown).toBe(1)
  })

  test('an item in use counts down its use, a charged crossbow is charged, and a wither below half its health has its shield', () => {
    const model = new BedrockEntity(fake, 'test:thing')
    model.setState({ equipment: { mainhand: 'bow' }, metadata: { flags: {} } })
    model.update(0.05)
    expect(q(model, 'main_hand_item_use_duration')).toBe(0)
    model.setState({ metadata: { flags: { action: true } } })
    ticks(model, 10)
    expect(q(model, 'main_hand_item_max_duration')).toBe(72000)
    const left = q(model, 'main_hand_item_use_duration')
    expect(left).toBeGreaterThan(72000 - 40)
    expect(left).toBeLessThan(72000)
    expect(q(model, 'item_remaining_use_duration', 'main_hand')).toBeCloseTo(left / 20, 5)
    ticks(model, 5)
    expect(q(model, 'main_hand_item_use_duration')).toBeLessThan(left)
    model.setState({ equipment: { mainhand: 'crossbow' }, metadata: { flags: { charged: true } } })
    expect(q(model, 'item_is_charged', 'main_hand')).toBe(1)
    model.setState({ health: 150, maxHealth: 300 })
    expect(q(model, 'is_shield_powered')).toBe(1)
    model.setState({ health: 151 })
    expect(q(model, 'is_shield_powered')).toBe(0)
  })

  test('a cat\'s pose as its move controller numbers it: sneak 0, sprint 1, sit 2, walk 3, lie down 4', () => {
    const model = new BedrockEntity(fake, 'test:thing')
    model.actor.kind = 'cat'
    for (const [flag, state] of [[null, 3], ['sneaking', 0], ['sprinting', 1], ['sitting', 2], ['resting', 4]]) {
      model.setState({ metadata: { flags: flag ? { [flag]: true } : {} } })
      model.update(0.05)
      expect([flag, model.variables.state]).toEqual([flag, state])
    }
  })

  test('an animation the server plays: on its own, or in place of a controller until it ends, then the next state', () => {
    const model = new BedrockEntity(fake, 'test:thing')
    model.update(0.05)
    expect(model.pose.get('leg').rot[0]).toBe(10)
    model.playAnimation({ animation: 'animation.test.wave', controller: 'move', nextState: 'other' })
    model.update(0.05)
    expect(model.pose.get('arm').rot[0]).toBe(90)
    expect(model.pose.has('leg')).toBe(false)
    ticks(model, 12)
    expect(model.runtime.size).toBe(0)
    expect(model.controllers.get('move').state).toBe('other')
    expect(model.pose.has('arm')).toBe(false)

    // without a controller, it fades out over its blend time
    model.playAnimation({ animation: 'animation.test.walk', stopCondition: 'query.life_time > 0', blendOutTime: 0.2 })
    ticks(model, 3)
    expect(model.pose.get('leg').rot[0]).toBeCloseTo(10 * (1 - 0.05 / 0.2))
  })

  test('what the caller provides answers first', () => {
    const model = new BedrockEntity(fake, 'test:thing')
    model.setOverrides({ queries: { is_levitating: 1, item_remaining_use_duration: args => 5 + args.length }, variables: { is_first_person: 1, limbs: 7 } })
    model.update(0.05)
    expect(q(model, 'is_levitating')).toBe(1)
    expect(q(model, 'item_remaining_use_duration', 'x')).toBe(6)
    expect(model.variables.is_first_person).toBe(1)
  })

  test('a billboard (a fireball) turns its face to the camera, whichever way its entity is turned', () => {
    const fireball = {
      ...fake,
      entities: { 'test:fireball': { geometry: { default: 'geometry.fireball' }, animations: { face_player: 'animation.actor.billboard' }, scripts: { scale: '2.0', animate: ['face_player'] } } },
      geometry: { 'geometry.fireball': { texture_width: 16, texture_height: 16, bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [{ origin: [-8, -4, 0], size: [16, 16, 0], uv: { south: { uv: [0, 0] } } }] }] } },
      animations: { 'animation.actor.billboard': { loop: true, bones: { body: { rotation: ['query.camera_rotation(0)', 'query.camera_rotation(1)', 0] } } } }
    }
    const camera = new THREE.Vector3(8, 6, 10)
    for (const yaw of [0, -45, 100, 180]) {
      const model = new BedrockEntity(fireball, 'test:fireball')
      // placed as entities.js places it: its object turned to the entity's yaw
      model.object.position.set(2, 0, 3)
      model.object.rotation.y = Math.PI - yaw * Math.PI / 180
      model.setMotion({ position: model.object.position, yaw, headYaw: yaw })
      model.setCamera(camera)
      ticks(model, 2)
      model.object.updateMatrixWorld(true)
      const body = model.findBone('body').group
      const face = new THREE.Vector3(0, 0, 1).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()))
      const toCamera = camera.clone().sub(body.getWorldPosition(new THREE.Vector3())).normalize()
      expect(face.dot(toCamera)).toBeCloseTo(1, 2)
    }
  })
})

describe('boats', () => {
  for (const version of ['1.16.201', '1.26.51']) {
    withAssets(version)(`${version}: a boat's wood is its variant, its hull on its floor`, () => {
      const data = assets(version)
      const boat = data.entities['minecraft:boat']
      const controller = data.render_controllers[boat.render_controllers[0]]
      expect(controller.textures).toEqual(['Array.woods[query.variant]'])
      expect(controller.arrays.textures['Array.woods'].slice(0, 5)).toEqual(['Texture.oak', 'Texture.spruce', 'Texture.birch', 'Texture.jungle', 'Texture.acacia'])
      const bottom = data.geometry['geometry.boat'].bones.find(b => b.name === 'bottom')
      expect(bottom.pivot[1]).toBe(0)
    })
  }

  withAssets('1.26.51')('a chest boat is a boat with a chest, on its texture of twice the height', () => {
    const data = assets('1.26.51')
    const chest = data.geometry['geometry.chest_boat']
    expect(chest.texture_height).toBe(data.geometry['geometry.boat'].texture_height * 2)
    expect(chest.bones.map(b => b.name).filter(n => n.startsWith('chest'))).toEqual(['chest_bottom', 'chest_lid', 'chest_lock'])
  })
})
