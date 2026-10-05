// The commands the server knows, sent as a chat line starting with / (command_request): what changes the world, moves
// the player, or changes its game mode or the time. Coordinates may be relative to the player's feet (~, ~2).
const { DIMENSIONS } = require('./recordedWorld')

const HELP = [
  '/setblock <x> <y> <z> <block>[states]  e.g. /setblock ~ ~ ~2 oak_stairs[weirdo_direction=1]',
  '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block>[states]  (4096 blocks at most)',
  '/tp <x> <y> <z>',
  '/dimension <overworld|nether|end>  (the world must have it; its portals take you too)',
  '/gamemode <creative|survival|adventure>',
  '/time <set|add> <ticks|day|noon|night|midnight>'
].join('\n')

const MAX_FILL = 4096
const TIMES = { day: 1000, noon: 6000, night: 13000, midnight: 18000 }

// a coordinate: a number, or ~ and a number from the player's
function coordinate (text, from) {
  if (text === undefined) throw new Error('a coordinate is missing')
  const relative = text.startsWith('~')
  const value = Number(relative ? (text.slice(1) || 0) : text)
  if (!Number.isFinite(value)) throw new Error(`not a coordinate: ${text}`)
  return relative ? from + value : value
}

function position (args, feet) {
  return { x: Math.floor(coordinate(args[0], Math.floor(feet.x))), y: Math.floor(coordinate(args[1], Math.floor(feet.y))), z: Math.floor(coordinate(args[2], Math.floor(feet.z))) }
}

// 'oak_stairs[weirdo_direction=1,upside_down_bit=true]' -> the state of the version
function blockState (text, server) {
  const match = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(text ?? '')
  if (!match) throw new Error(`not a block: ${text}`)
  const props = {}
  for (const pair of (match[2] ?? '').split(',').filter(Boolean)) {
    const [key, value] = pair.split('=')
    props[key.trim()] = value === 'true' ? 1 : value === 'false' ? 0 : value.trim().replace(/^"|"$/g, '')
  }
  const state = server.states.resolve(match[1], props)
  if (!state) throw new Error(`the version has no block ${match[1]}`)
  return state
}

// Runs a command line of a player's (connection; none: the page's own); what it says goes back to the player
function runCommand (server, line, connection) {
  const [name, ...args] = String(line).trim().replace(/^\//, '').split(/\s+/)
  const say = message => connection ? connection.say(message) : server.log(message)
  const feet = connection?.feet ?? server.world.spawn
  const dimension = connection?.dimension ?? server.dimension
  try {
    switch (name) {
      case 'setblock': {
        const at = position(args, feet)
        const state = blockState(args[3], server)
        server.setBlock(at, state.id, 0, dimension)
        return say(`set ${at.x} ${at.y} ${at.z} to ${state.name}`)
      }
      case 'fill': {
        const a = position(args, feet)
        const b = position(args.slice(3), feet)
        const state = blockState(args[6], server)
        const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
        const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
        const [z0, z1] = [Math.min(a.z, b.z), Math.max(a.z, b.z)]
        const count = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1)
        if (count > MAX_FILL) return say(`${count} blocks: ${MAX_FILL} at most`)
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) server.setBlock({ x, y, z }, state.id, 0, dimension)
        return say(`filled ${count} blocks with ${state.name}`)
      }
      case 'tp':
      case 'teleport': {
        if (!connection) return say('tp moves a player')
        const x = coordinate(args[0], feet.x)
        const y = coordinate(args[1], feet.y)
        const z = coordinate(args[2], feet.z)
        connection.teleport({ x, y, z })
        return say(`teleported to ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`)
      }
      case 'dimension': {
        if (!connection) return say('dimension moves a player')
        const to = DIMENSIONS.indexOf(args[0] === 'the_end' ? 'end' : args[0])
        if (!server.worlds.has(to)) return say(`this world has ${[...server.worlds.keys()].map(d => DIMENSIONS[d]).join(', ')}`)
        const { x, y, z } = server.worlds.get(to).spawn
        connection.changeDimension(to, { x, y, z })
        return say(`to the ${DIMENSIONS[to]}`)
      }
      case 'gamemode': {
        if (!connection) return say('gamemode is a player\'s')
        const aliases = { c: 'creative', s: 'survival', a: 'adventure', 0: 'survival', 1: 'creative', 2: 'adventure' }
        const mode = aliases[args[0]] ?? args[0]
        if (!server.gameModes.includes(mode)) return say(`game modes: ${server.gameModes.join(', ')}`)
        connection.setGamemode(mode)
        return say(`game mode ${mode}`)
      }
      case 'time': {
        const value = TIMES[args[1]] ?? Number(args[1])
        if (!Number.isFinite(value) || (args[0] !== 'set' && args[0] !== 'add')) return say('/time <set|add> <ticks|day|noon|night|midnight>')
        server.setTime(args[0] === 'add' ? server.time + value : value)
        return say(`time ${server.time}`)
      }
      case 'help':
      case '?':
        return say(HELP)
      default:
        return say(`unknown command ${name}: /help lists them`)
    }
  } catch (err) {
    say(err.message)
  }
}

module.exports = { runCommand, HELP }
