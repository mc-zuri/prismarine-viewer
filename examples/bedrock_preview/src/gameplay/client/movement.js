// The player as the client moves it: prismarine-physics' Bedrock engine steps it every tick from the keys held and the
// look, and the client tells the server where it went (player_auth_input), as the game's client does where the server
// has the movement (bedrock-demo packages/bedrock-client/src/movement: index.ts, auth-input.ts, clock.ts, player.ts).
// The engine's session takes the server's movement packets (a teleport, a correction) on the tick they are due.
const { Vec3 } = require('vec3')
const { Physics, BedrockSession } = require('prismarine-physics-bedrock/lib/bedrock/index.ts')
const { fieldsOf, fieldType, definitionOf, mapperValues, toBigInt } = require('../protocol/schema')
const { worldView } = require('./worldView')

const TICK_MS = 50
// the most ticks a call of tick() catches up (a page in the background is woken seldom)
const MAX_STEPS = 8
const RAD = Math.PI / 180

// look: mineflayer's radians (yaw 0 faces north, turning west; pitch up) <-> Bedrock's degrees (yaw 0 faces south,
// turning west; pitch down)
const bedrockYaw = yaw => 180 - yaw / RAD
const bedrockPitch = pitch => -pitch / RAD
const lookOf = (yawDegrees, pitchDegrees) => ({ yaw: (180 - yawDegrees) * RAD, pitch: -pitchDegrees * RAD })
// the look as the client keeps it: the pitch within straight up and straight down
const clientLook = (yaw, pitch) => ({ yaw, pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)) })

// The server matches each input to its tick: the client counts from start_game's tick by the clock, and moves forward
// to a correction's when it has fallen behind
class TickClock {
  constructor (now = Date.now) {
    this.now = now
    this.anchorTick = 0n
    this.anchorTime = now()
  }

  start (tick) {
    this.anchorTick = toBigInt(tick)
    this.anchorTime = this.now()
  }

  catchUp (tick) {
    const at = toBigInt(tick)
    if (at <= this.current()) return
    this.anchorTick = at
    this.anchorTime = this.now()
  }

  current () {
    return this.anchorTick + BigInt(Math.max(0, Math.floor((this.now() - this.anchorTime) / TICK_MS)))
  }
}

// player_auth_input as each version's schema has it: the engine builds the newest's fields, this adapts them
class AuthInputWriter {
  constructor (types) {
    const fields = fieldsOf(types, 'packet_player_auth_input')
    // 1.26.40 to 1.26.45 wrap optional fields in presence flags the vanilla client always sets
    this.presence = Object.fromEntries(fields.filter(field => field.name?.endsWith('_presence')).map(field => [field.name, true]))
    // input_data: a bitset before 1.26.40 (an object of flags), a list of names since (an option of one in 1.26.40 and
    // 1.26.45); a name the version does not have is left out
    let type = definitionOf(types, fieldType(types, 'packet_player_auth_input', 'input_data'))
    if (Array.isArray(type) && type[0] === 'option') type = definitionOf(types, type[1])
    this.list = Array.isArray(type) && type[0] === 'array'
    if (this.list) {
      this.known = new Set(mapperValues(types, type[1].type))
    } else {
      const flags = Array.isArray(type) ? type[1].flags : undefined
      this.known = new Set(Array.isArray(flags) ? flags : Object.keys(flags ?? {}))
    }
  }

  write (fields, tick) {
    const flags = fields.input_data.filter(name => this.known.has(name))
    return { ...fields, ...this.presence, tick, input_data: this.list ? flags : Object.fromEntries(flags.map(name => [name, true])) }
  }
}

class Movement {
  constructor (client, { now = Date.now } = {}) {
    this.client = client
    this.world = worldView(client)
    this.physics = Physics(client.registry, this.world)
    this.session = new BedrockSession({ physics: this.physics, world: this.world })
    this.writer = new AuthInputWriter(client.codec.types)
    this.clock = new TickClock(now)
    this.now = now
    // the engine's player: its feet, velocity, look (radians), abilities; the engine keeps its own state on it
    this.player = { pos: new Vec3(0, 0, 0), vel: new Vec3(0, 0, 0), onGround: false, yaw: 0, pitch: 0, control: {}, attributes: {}, food: 20, flySpeed: 0.05, verticalFlySpeed: 1 }
    // where the player was before the last tick, and when that tick ran: the page draws in between
    this.prevPos = this.player.pos.clone()
    this.lastTickTime = now()
    this.last = null
    this.active = false
  }

  // start_game: where the player is (its eyes), how it looks, and the tick the server is at
  start (packet) {
    const eyes = packet.player_position ?? packet.spawn
    this.player.pos = new Vec3(eyes.x, eyes.y - this.physics.eyeHeight, eyes.z)
    this.prevPos = this.player.pos.clone()
    const look = lookOf(packet.rotation?.z ?? 0, packet.rotation?.x ?? 0)
    Object.assign(this.player, look)
    this.client.look = { ...look }
    this.clock.start(packet.current_tick ?? 0)
    this.session.handlePacket('start_game', packet)
  }

  // what the player may do: fly (and whether it flies), build at once
  setAbilities ({ mayFly, flying, flySpeed, verticalFlySpeed }) {
    if (mayFly !== undefined) this.player.mayFly = mayFly
    if (flying !== undefined) this.player.flying = flying
    if (!this.player.mayFly) this.player.flying = false
    if (flySpeed) this.player.flySpeed = flySpeed
    if (verticalFlySpeed) this.player.verticalFlySpeed = verticalFlySpeed
  }

  // whether the player can move: its column is in, and the section of its feet and the one under them arrived
  ready () {
    const { pos } = this.player
    const chunks = this.client.chunks
    return this.world.loaded(pos) && !chunks.pending(pos.x, pos.y, pos.z) && !chunks.pending(pos.x, pos.y - 16, pos.z)
  }

  // steps the player through the ticks due since the last call, sending one input a tick
  tick () {
    if (!this.active) return 0
    const target = this.clock.current()
    if (this.last === null || target - this.last > BigInt(MAX_STEPS)) this.last = target - 1n
    let steps = 0
    while (this.last < target) {
      const t = ++this.last
      this.step(t)
      steps++
    }
    return steps
  }

  // a firework rocket used: the tick to come boosts the glide
  useFirework () {
    this.fireworkUsed = true
  }

  step (t) {
    const { client, player, session } = this
    this.prevPos = player.pos.clone()
    // (the elytra worn: the engine glides with it)
    player.elytraEquipped = client.interaction.elytra
    const frame = { t: Number(t), control: { ...client.controls }, yaw: client.look.yaw, pitch: client.look.pitch, fireworkUsed: !!this.fireworkUsed }
    this.fireworkUsed = false
    if (this.ready()) session.tick(player, frame)
    else session.runDue(player, Number(t))
    client.queue('player_auth_input', this.writer.write(this.physics.playerAuthInput(player), t))
    this.lastTickTime = this.now()
    client.emit('step', t)
  }

  // a server's movement packet (a teleport: move_player; correct_player_move_prediction), due on the next tick
  handle (name, params) {
    if (name === 'correct_player_move_prediction') this.clock.catchUp(params.tick)
    const taken = this.session.handlePacket(name, params)
    if (taken && name === 'move_player') {
      // the look turns with a teleport
      this.client.look = lookOf(params.yaw ?? bedrockYaw(this.client.look.yaw), params.pitch ?? bedrockPitch(this.client.look.pitch))
    }
    return taken
  }
}

module.exports = { Movement, TickClock, AuthInputWriter, TICK_MS, bedrockYaw, bedrockPitch, lookOf, clientLook }
