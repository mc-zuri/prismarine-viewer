// Walks the client's player to a place with mineflayer-pathfinder (bedrock-demo
// packages/bedrock-client-pathfinder/src/index.ts): the plugin, as it is, on a bot made from the client (bot.js). It
// plans on the blocks the client has (blocks.js) with the moves the options allow (options.js, movements.js): walking,
// jumping up and dropping down, breaking the blocks in the way, placing blocks to bridge or pillar, jumping gaps,
// opening gates. It steers with the client's controls and look after each tick the player moved, as a person would
// with the humanLike option (human.js), breaks and places as the player does (hands.js), and plans again when the
// world around its route changes.
//
//   const pathfinder = attachPathfinder(client, { dig: false })
//   pathfinder.on('route', route => ...)          // the steps left to walk, or null when the walk ended
//   pathfinder.on('end', reason => ...)           // arrived, no path, stuck, stopped...
//   pathfinder.goTo({ x: 10, y: 64, z: -3 })      // the block to stand in; with a range, near it
//   pathfinder.setOptions({ humanLike: false })   // from now on, the walk going on too
//
// The plugin tries its moves with prismarine-physics' PlayerState, which must be the Bedrock fork's: the bundle points
// prismarine-physics there (webpack.config.js), and the Node check puts it in require's cache.
//
// A route: { goal, points: [{ x, y, z, move: walk | jump | parkour | drop, breaks, places, opens }], status: walking |
// partial }: where the player stands at each step, how it gets there, and the blocks it breaks, places and opens on the
// way, until each is done.
const { EventEmitter } = require('events')
const { Vec3 } = require('vec3')
const { pathfinder: plugin, goals } = require('mineflayer-pathfinder')
const { blockReader } = require('./blocks')
const { bodyOf } = require('./body')
const { createBot } = require('./bot')
const { bedrockMovements } = require('./movements')
const { DEFAULT_OPTIONS, pathfinderOptions } = require('./options')

// how long the search may take in all, and in one tick
const THINK_MS = 2000
const TICK_THINK_MS = 15
// columns that arrived are told to the plugin this often: sections come one by one
const CHUNKS_MS = 250
// the plugin plans again when a step takes too long, or a block would not break or be placed: after this many times in
// one walk it gives up
const MAX_FAILURES = 3
// why the walk ends after that, by the plugin's reason for planning again
const FAILURES = { stuck: 'stuck', dig_error: 'dig failed', place_error: 'place failed', no_scaffolding_blocks: 'no blocks' }
// a player moved further than this in a tick was put elsewhere (a teleport, a respawn): the walk ends
const TELEPORT = 8
// a step this much higher or lower than the one before is a jump or a drop, not a step up a slab or a stair
const STEP_HEIGHT = 0.6
// half the player's width: its box reaches this far over an edge
const HALF_WIDTH = 0.3

// The player sprints unless hunger holds it back (food of 6 or less, unless it may fly, as the engine has it)
const hungerLimited = (food, mayFly) => food <= 6 && !mayFly

class Pathfinder extends EventEmitter {
  constructor (client, options) {
    super()
    this.client = client
    this.options = pathfinderOptions(options, DEFAULT_OPTIONS)
    // the goal of the walk going on
    this.goal = undefined
    this.bot = undefined
    // the plugin's last search result: partial while it goes on
    this.status = undefined
    this.path = []
    // each step's blocks to break, place and open as the plugin planned them: it takes a block off its step as it
    // starts on it, and the route shows it until it is done
    this.plans = new WeakMap()
    this.sent = ''
    this.failures = 0
    this.last = undefined
    this.columns = new Set()
    // the best tool for each block state, worked out once a tick
    this.tools = new Map()
    // whether the plan sprints: the option, and the player able to
    this.sprints = true
    // the plugin's ticks are held while its then() of a placement settles
    this.held = false
    // (a pathfinder that cannot start says so, and leaves the client to play)
    this.join = () => {
      try {
        this.start()
      } catch (error) {
        this.bot = undefined
        client.problem(`pathfinder: ${error.stack ?? error.message}`)
      }
    }
    this.step = this.step.bind(this)
    this.chunk = this.chunk.bind(this)
    this.blockUpdate = this.blockUpdate.bind(this)
    this.left = () => this.stop('left')
    client.on('startGame', this.join)
    client.on('step', this.step)
    client.on('column', this.chunk)
    client.on('blockUpdate', this.blockUpdate)
    client.on('dimension', this.left)
    client.on('close', this.left)
    this.chunkTimer = setInterval(() => this.flushChunks(), CHUNKS_MS)
    this.chunkTimer.unref?.()
    if (client.movement) this.join()
  }

  get walking () {
    return this.goal !== undefined
  }

  // Walks to a block (the one the player's feet are in), or with a range to within that many blocks of it. Returns why
  // not.
  goTo (goal, range = 0) {
    const { movement } = this.client
    if (!this.bot || !movement?.active) return 'the player has not spawned'
    if (movement.player.flying) return 'the player is flying'
    const at = { x: Math.floor(goal.x), y: Math.floor(goal.y), z: Math.floor(goal.z) }
    this.goal = at
    this.status = undefined
    this.path = []
    this.failures = 0
    this.bot.pathfinder.setGoal(range > 0 ? new goals.GoalNear(at.x, at.y, at.z, range) : new goals.GoalBlock(at.x, at.y, at.z))
    this.sendRoute()
    return null
  }

  // What the pathfinder may do and how it turns the player, from now on: a walk going on plans again with them
  setOptions (options) {
    this.options = pathfinderOptions(options, this.options)
    if (this.bot) this.useOptions()
    return this.options
  }

  stop (reason = 'stopped') {
    if (this.walking) this.finish(reason)
  }

  close () {
    this.stop('closed')
    clearInterval(this.chunkTimer)
    this.client.off('startGame', this.join)
    this.client.off('step', this.step)
    this.client.off('column', this.chunk)
    this.client.off('blockUpdate', this.blockUpdate)
    this.client.off('dimension', this.left)
    this.client.off('close', this.left)
  }

  useOptions () {
    this.bot.steering.enabled = this.options.humanLike
    this.sprints = this.options.sprint && this.canSprint()
    this.bot.pathfinder.setMovements(bedrockMovements(this.bot, { ...this.options, sprint: this.sprints }))
  }

  canSprint () {
    const player = this.client.player
    return !hungerLimited(player?.food ?? 20, player?.mayFly)
  }

  // start_game has remapped the registry: the plugin's tables are made from it
  start () {
    if (this.bot) {
      // a join again: a new registry and a new movement
      this.stop('left')
      this.bot = undefined
    }
    const body = bodyOf(this.client)
    this.body = body
    const bot = createBot(body, blockReader(this.client))
    plugin(bot)
    bot.pathfinder.thinkTimeout = THINK_MS
    bot.pathfinder.tickTimeout = TICK_THINK_MS
    // the search asks for the best tool for every block it would break
    const bestHarvestTool = bot.pathfinder.bestHarvestTool
    bot.pathfinder.bestHarvestTool = block => {
      if (!this.tools.has(block.stateId)) this.tools.set(block.stateId, bestHarvestTool(block))
      return this.tools.get(block.stateId)
    }
    // the plugin plans again when the hands fail, and says nothing of why: the client's problems do
    for (const name of ['dig', 'placeBlock', 'activateBlock', 'equip']) {
      const act = bot[name]
      bot[name] = async (...args) => {
        try {
          return await act(...args)
        } catch (error) {
          // the walk ended, or the plugin let go of a block as it planned again
          if (this.walking && !['cancelled', 'digging aborted'].includes(error.message)) this.client.emit('message', `pathfinder: ${error.message}`)
          throw error
        }
      }
    }
    // once a gate is open the plugin goes on to place the next block of the step, which is none: it plans again
    // instead, through the gate
    const activateBlock = bot.activateBlock
    bot.activateBlock = async block => {
      await activateBlock(block)
      if (this.walking) bot.pathfinder.setGoal(bot.pathfinder.goal)
    }
    bot.on('path_update', result => {
      this.status = result.status
      this.path = result.path
      for (const node of result.path) this.plans.set(node, planned(node))
    })
    bot.on('path_reset', reason => {
      // the plugin plans again: what it found before is no more (an empty path is not the end of a walk)
      this.status = undefined
      if (FAILURES[reason] && ++this.failures >= MAX_FAILURES) this.finish(FAILURES[reason])
    })
    bot.on('goal_reached', () => this.finish('arrived'))
    bot.on('held', () => {
      this.held = true
      setTimeout(() => { this.held = false }, 0)
    })
    // a player over an edge (sneaked out to place a block, and left there) stands on the block beside it: the plugin
    // plans from the cell the feet are in, the gap's, and backs into the edge for ever
    const getPathFromTo = bot.pathfinder.getPathFromTo
    bot.pathfinder.getPathFromTo = (movements, start, goal, options) => getPathFromTo(movements, this.standing(start), goal, options)
    this.bot = bot
    this.useOptions()
  }

  step () {
    if (!this.bot || !this.client.player) return
    this.bot.newTick()
    this.tools.clear()
    const { x, y, z } = this.client.player.pos
    const moved = this.last ? Math.hypot(x - this.last.x, y - this.last.y, z - this.last.z) : 0
    this.last = { x, y, z }
    if (!this.walking) return
    if (moved > TELEPORT) {
      this.finish('teleported')
      return
    }
    // hungry, or fed again: the plan sprints as the player can
    if (this.options.sprint && this.canSprint() !== this.sprints) this.useOptions()
    try {
      this.bot.steering.route = this.path
      if (!this.held) this.bot.emit('physicsTick')
      this.bot.steering.tick()
    } catch (error) {
      this.client.problem(`pathfinder: ${error.stack ?? error.message}`)
      this.finish('failed')
      return
    }
    if (!this.walking) return
    // a search that ended leaves the plugin with its goal and nothing to walk: by the best path it found, or at once
    if (this.status && this.status !== 'partial' && !this.bot.pathfinder.isMoving()) {
      this.finish(this.status === 'success' ? 'arrived' : 'no path')
      return
    }
    this.sendRoute()
  }

  chunk (column) {
    this.columns.add(`${column.x},${column.z}`)
  }

  flushChunks () {
    if (this.bot && this.walking) {
      for (const column of this.columns) {
        const [x, z] = column.split(',').map(Number)
        this.bot.emit('chunkColumnLoad', new Vec3(x * 16, 0, z * 16))
      }
    }
    this.columns.clear()
  }

  // a block changed (the client's blockUpdate: where, its state now, its layer, its state before)
  blockUpdate (pos, stateId, layer, before) {
    if (!this.walking || layer !== 0) return
    const typeOf = id => this.client.registry.blocksByStateId[id]?.id
    const position = new Vec3(pos.x, pos.y, pos.z)
    this.bot.emit('blockUpdate', { position, type: typeOf(before), stateId: before }, { position, type: typeOf(stateId), stateId })
  }

  // Where the player stands for a plan: the cell its feet are in, or when nothing is under that, the nearest cell under
  // its box that has a block under it
  standing (feet) {
    if (!this.client.player.onGround) return feet
    const y = Math.floor(feet.y)
    const holds = (x, z) => !!this.body.blockAt({ x, y, z })?.shapes?.length || !!this.body.blockAt({ x, y: y - 1, z })?.shapes?.length
    if (holds(Math.floor(feet.x), Math.floor(feet.z))) return feet
    let nearest
    for (const dx of [-HALF_WIDTH, HALF_WIDTH]) {
      for (const dz of [-HALF_WIDTH, HALF_WIDTH]) {
        const x = Math.floor(feet.x + dx)
        const z = Math.floor(feet.z + dz)
        const away = Math.hypot(x + 0.5 - feet.x, z + 0.5 - feet.z)
        if (holds(x, z) && (!nearest || away < nearest.away)) nearest = { x, z, away }
      }
    }
    return nearest ? new Vec3(nearest.x + 0.5, feet.y, nearest.z + 0.5) : feet
  }

  routeStatus () {
    return this.status === 'success' ? 'walking' : 'partial'
  }

  // The steps as the player stands at them, and the blocks of each not done yet: a step the plugin has not placed on
  // the block it stands on yet (beyond the first block to break or place) is the middle of its cell
  steps () {
    let from = this.client.player.pos
    // whether the player would walk through the cell: broken, a gate open; placed once it would not
    const open = block => !this.body.blockAt(block)?.shapes?.length
    return this.path.map(node => {
      const x = Number.isInteger(node.x) && Number.isInteger(node.z) ? node.x + 0.5 : node.x
      const z = Number.isInteger(node.x) && Number.isInteger(node.z) ? node.z + 0.5 : node.z
      const rise = node.y - from.y
      const move = node.parkour ? 'parkour' : rise > STEP_HEIGHT ? 'jump' : rise < -STEP_HEIGHT ? 'drop' : 'walk'
      from = { x, y: node.y, z }
      const plan = this.plans.get(node) ?? planned(node)
      return {
        x,
        y: node.y,
        z,
        move,
        breaks: plan.breaks.filter(block => !open(block)),
        places: plan.places.filter(open),
        opens: plan.opens.filter(block => !open(block))
      }
    })
  }

  // the route as it is now, when it changed: the plugin drops the steps the player reached, and the blocks it broke
  // and placed
  sendRoute () {
    if (!this.goal) return
    const route = { goal: this.goal, points: this.steps(), status: this.routeStatus() }
    const json = JSON.stringify(route)
    if (json === this.sent) return
    this.sent = json
    this.emit('route', route)
  }

  finish (reason) {
    this.goal = undefined
    this.path = []
    this.sent = ''
    // lets go of the keys the plugin held, and of a block being broken
    this.bot.pathfinder.setGoal(null)
    this.bot.hands.cancel()
    this.bot.steering.reset()
    this.emit('route', null)
    this.emit('end', reason)
  }
}

// a step's blocks as the plugin plans them: those to break, where blocks are placed, the gates to open
function planned (node) {
  const toPlace = node.toPlace ?? []
  return {
    breaks: (node.toBreak ?? []).map(({ x, y, z }) => ({ x, y, z })),
    places: toPlace.filter(place => !place.useOne).map(place => ({ x: place.x + place.dx, y: place.y + place.dy, z: place.z + place.dz })),
    opens: toPlace.filter(place => place.useOne).map(({ x, y, z }) => ({ x, y, z }))
  }
}

function attachPathfinder (client, options) {
  return new Pathfinder(client, options)
}

module.exports = { attachPathfinder, Pathfinder, DEFAULT_OPTIONS, pathfinderOptions }
