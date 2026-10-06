// The client as mineflayer-pathfinder reads a mineflayer bot (bedrock-demo
// packages/bedrock-client-pathfinder/src/bot.ts): the blocks, the player, its items, its controls and look in
// mineflayer's radians (yaw 0 faces -z, pitch up; the client's own) given as a person gives them with the humanLike
// option (human.js), its hands (hands.js), and the physics the pathfinder tries a move with before it makes it: the
// Bedrock engine the client moves the player with. What it tries runs on copies: the engine changes the player's
// collision box and attributes in place, and the player the client simulates must not move with them.
const { EventEmitter } = require('events')
const { cloneValue } = require('prismarine-physics-bedrock/lib/bedrock/network/rewind.ts')
const { Hands, HOTBAR_SIZE } = require('./hands')
const { Steering } = require('./human')
const { movementsRegistry } = require('./movements')

// the slots of a mineflayer inventory (the physics reads the armour's: 5 to 8)
const INVENTORY_SLOTS = 46

function createBot (body, blockAt, steering = new Steering(body)) {
  const { client } = body
  const { movement } = client
  // the player the engine steps
  const live = () => client.player

  // a jump the pathfinder tries simulates some 200 ticks over the same few blocks, and a search reads the inventory
  // for each block it would break: both are read once a tick
  const seen = new Map()
  let items
  const world = {
    getBlock (position) {
      const key = `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`
      let block = seen.get(key)
      if (block === undefined) {
        block = movement.world.getBlock(position)
        seen.set(key, block)
      }
      return block
    },
    loaded: movement.world.loaded
  }

  // the hotbar's stacks as the pathfinder reads mineflayer's items
  const inventoryItems = () => {
    items ??= client.interaction.hotbar.slice(0, HOTBAR_SIZE).flatMap((item, slot) => {
      const count = item?.count ?? 0
      return item?.networkId && count > 0 ? [{ type: item.networkId, count, name: item.name.replace(/^minecraft:/, ''), metadata: item.metadata ?? 0, slot }] : []
    })
    return items
  }

  const entity = {
    // copies: the pathfinder stops the bot by writing its velocity and position, which here are the engine's
    get position () { return live().pos.clone() },
    get velocity () { return live().vel.clone() },
    get onGround () { return live().onGround },
    get isInWater () { return !!live().isInWater },
    get isInLava () { return !!live().isInLava },
    get isInWeb () { return !!live().isInWeb },
    get isCollidedHorizontally () { return !!live().isCollidedHorizontally },
    get isCollidedVertically () { return !!live().isCollidedVertically },
    get elytraFlying () { return !!live().elytraFlying },
    get yaw () { return client.look.yaw },
    get pitch () { return client.look.pitch },
    get attributes () { return cloneValue(live().attributes ?? {}) },
    effects: {},
    metadata: { flags: {} }
  }

  const bot = new EventEmitter()
  const hands = new Hands(body, steering, (event, ...args) => bot.emit(event, ...args))
  Object.assign(bot, {
    registry: movementsRegistry(client.registry),
    blockAt,
    entity,
    inventory: { items: inventoryItems, slots: new Array(INVENTORY_SLOTS).fill(null) },
    game: {
      get minY () { return (client.chunks.loadedColumn(Math.floor(live().pos.x) >> 4, Math.floor(live().pos.z) >> 4)?.minCY ?? 0) * 16 },
      get gameMode () { return client.gamemode }
    },
    controlState: client.controls,
    steering,
    hands,
    setControlState: (control, pressed) => steering.setControlState(control, pressed),
    clearControlStates: () => steering.clearControlStates(),
    look: async (yaw, pitch) => steering.look(yaw, pitch),
    lookAt: async point => steering.lookAt(point),
    dig: block => hands.dig(block),
    stopDigging: () => hands.stopDigging(),
    placeBlock: (reference, face) => hands.placeBlock(reference, face),
    activateBlock: block => hands.activateBlock(block),
    equip: (item, destination) => hands.equip(item, destination),
    physics: { simulatePlayer: state => movement.physics.simulatePlayer(state, world) },
    // Forgets the blocks and items read for the last tick
    newTick: () => {
      seen.clear()
      items = undefined
    }
  })
  Object.defineProperties(bot, {
    bedrockPhysicsState: { get: () => live().bedrock === undefined ? undefined : cloneValue(live().bedrock) },
    jumpTicks: { get: () => live().jumpTicks ?? 0 },
    jumpQueued: { get: () => live().jumpQueued ?? false },
    abilities: { get: () => ({ flags: { mayFly: !!live().mayFly, flying: !!live().flying }, flySpeed: live().flySpeed, verticalFlySpeed: live().verticalFlySpeed }) },
    food: { get: () => live().food ?? 20 },
    health: { get: () => 20 },
    // (the world here has no entities)
    entities: { get: () => ({}) },
    quickBarSlot: { get: () => client.interaction.selectedSlot },
    heldItem: { get: () => inventoryItems().find(item => item.slot === client.interaction.selectedSlot) ?? null }
  })
  return bot
}

module.exports = { createBot }
