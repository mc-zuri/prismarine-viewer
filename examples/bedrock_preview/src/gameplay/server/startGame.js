// The packets that start a player off: start_game and the item states (in it before 1.21.60, in item_registry
// since), what the player may do (update_abilities, adventure_settings before it), and the hotbar it builds with.
// Each names what this server means; the rest of a version's fields are its schema's defaults (schema.js fill), where
// Bedrock Dedicated Server sends a template of its own.
const { stackWire } = require('../protocol/items')
const { allFlags } = require('../protocol/schema')

// The player's eyes above its feet (the physics engine's: the float of 1.62001)
const EYE_HEIGHT = Math.fround(1.62001)
// The player's ids: small, as some packets of old versions write them in 32 bits
const PLAYER_ID = 1n

// What the hotbar holds: building blocks, each by the names versions give it (the first one the version has as both
// a block and an item)
const HOTBAR = [['grass_block', 'grass'], ['dirt'], ['stone'], ['cobblestone'], ['oak_planks', 'planks'], ['oak_log', 'log'], ['glass'], ['brick_block'], ['sand']]

function buildStartGame ({ registry, codec, spawn, hashes, tick, gamemode, dimension = 0 }) {
  const eyes = { x: spawn.x, y: spawn.y + EYE_HEIGHT, z: spawn.z }
  return {
    entity_id: PLAYER_ID,
    runtime_entity_id: PLAYER_ID,
    player_gamemode: gamemode,
    world_gamemode: gamemode,
    // (1.16.201 names the position spawn)
    player_position: eyes,
    spawn: eyes,
    rotation: { x: spawn.pitch ?? 0, z: spawn.yaw ?? 0 },
    spawn_position: { x: Math.floor(spawn.x), y: Math.floor(spawn.y), z: Math.floor(spawn.z) },
    // (a number, or from 1.19.80 a name the schema maps it to)
    dimension,
    generator: 1,
    biome_name: 'plains',
    enable_commands: true,
    permission_level: 2,
    // the client moves the player and says where it is every tick (player_auth_input); gone from 1.21.90, where it is
    // always so
    movement_authority: 1,
    rewind_history_size: 20,
    // a block is broken by an item use the client sends (inventory_transaction), not by the server's own breaking
    server_authoritative_block_breaking: false,
    current_tick: BigInt(tick),
    block_network_ids_are_hashes: hashes,
    itemstates: codec.hasPacket('item_registry') ? [] : registry.writeItemStates(),
    game_version: '*',
    level_id: 'bedrock-preview',
    world_name: 'Bedrock preview'
  }
}

// What the player may do, as the version says it: creative may fly and builds at once
function abilitiesPacket (codec, { gamemode, flying }) {
  const creative = gamemode === 'creative'
  if (codec.hasPacket('update_abilities')) {
    const enabled = {
      build: true,
      mine: true,
      doors_and_switches: true,
      open_containers: true,
      attack_players: true,
      attack_mobs: true,
      operator_commands: true,
      teleport: true,
      invulnerable: creative,
      may_fly: creative,
      flying: creative && flying,
      instant_build: creative
    }
    return ['update_abilities', {
      entity_unique_id: PLAYER_ID,
      permission_level: 2,
      command_permission: 1,
      abilities: [{ type: 'base', allowed: allFlags(codec.types, 'AbilitySet'), enabled, fly_speed: 0.05, vertical_fly_speed: 1, walk_speed: 0.1 }]
    }]
  }
  return ['adventure_settings', {
    flags: { allow_flight: creative, flying: creative && flying },
    command_permission: 1,
    action_permissions: allFlags(codec.types, 'ActionPermissions'),
    permission_level: 2,
    user_id: PLAYER_ID
  }]
}

// The hotbar: [{ name, networkId, count, metadata, blockRuntimeId, stateId }] (stateId: the block it places, its
// runtime id: the registry's state id once start_game has the registry hash them)
function hotbarOf (registry) {
  const slots = []
  for (const names of HOTBAR) {
    const name = names.find(name => registry.blocksByName[name] && registry.itemsByName[name])
    if (!name) continue
    const stateId = registry.blocksByName[name].defaultState
    slots.push({ name, networkId: registry.itemsByName[name].id, count: 64, metadata: 0, blockRuntimeId: stateId, stateId })
  }
  return slots
}

// The player's inventory: the hotbar in its first slots, nothing in the others (36 in all)
function inventoryPacket (hotbar) {
  const input = []
  for (let slot = 0; slot < 36; slot++) input.push(stackWire(hotbar[slot] ?? {}, slot))
  // (1.16.201 names the window inventory_id)
  return ['inventory_content', { window_id: 'inventory', inventory_id: 'inventory', input }]
}

module.exports = { EYE_HEIGHT, PLAYER_ID, buildStartGame, abilitiesPacket, hotbarOf, inventoryPacket }
