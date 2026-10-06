// mineflayer-pathfinder's Movements for the Bedrock client, with what the options let it do (options.js): it walks,
// jumps up a block and drops down, and as allowed breaks the blocks in the way, places blocks to bridge a gap or pillar
// up, jumps gaps and opens fence gates (bedrock-demo packages/bedrock-client-pathfinder/src/movements.ts).
const { Movements } = require('mineflayer-pathfinder')
const { DEFAULT_OPTIONS } = require('./options')

// the pathfinder sees these as air, and the player is held up or slowed by them
const AVOIDED = ['scaffolding', 'powder_snow']
// the blocks it builds with, the first of them it carries first: the plugin's dirt and cobblestone, then the other
// common blocks a player bridges with
const SCAFFOLDING = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'oak_planks', 'planks', 'spruce_planks', 'birch_planks', 'sandstone', 'end_stone', 'blackstone', 'basalt']
// the blocks it never breaks, besides those no tool breaks (the plugin keeps chests only): what holds items, a bed, a
// spawner, a portal's frame
const KEPT = ['chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box', 'undyed_shulker_box', 'bed', 'furnace', 'blast_furnace', 'smoker', 'crafting_table', 'brewing_stand', 'beacon', 'spawner', 'mob_spawner', 'end_portal_frame', 'respawn_anchor', 'portal', 'end_portal']

// With hashed block ids the registry has no first state of a block: the plugin's tables are made from the default states
function movementsRegistry (registry) {
  const blocksArray = registry.blocksArray.map(block => block.minStateId === undefined ? { ...block, minStateId: block.defaultState } : block)
  return Object.create(registry, { blocksArray: { value: blocksArray } })
}

function bedrockMovements (bot, options = DEFAULT_OPTIONS) {
  const movements = new Movements(bot)
  const { blocksByName, itemsByName } = bot.registry
  movements.canDig = options.dig
  movements.allow1by1towers = options.place
  movements.scafoldingBlocks = options.place ? SCAFFOLDING.map(name => itemsByName[name]?.id).filter(id => id !== undefined) : []
  movements.allowParkour = options.parkour
  movements.allowSprinting = options.sprint
  movements.canOpenDoors = options.openGates
  movements.allowEntityDetection = options.avoidEntities
  movements.maxDropDown = options.maxDrop
  movements.allowFlying = !!options.fly
  movements.allowGliding = !!options.glide
  for (const name of KEPT) {
    const block = blocksByName[name]
    if (block) movements.blocksCantBreak.add(block.id)
  }
  for (const name of AVOIDED) {
    const block = blocksByName[name]
    if (block) movements.blocksToAvoid.add(block.id)
  }
  return movements
}

module.exports = { bedrockMovements, movementsRegistry }
