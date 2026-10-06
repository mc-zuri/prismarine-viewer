// What the pathfinder may do on the way, as mineflayer-pathfinder's Movements has it, and how it turns the player
// (bedrock-demo packages/bedrock-client-pathfinder/src/options.ts).
//   dig            breaks the blocks in the way (Movements.canDig): in creative, at once
//   place          places blocks the hotbar has to bridge a gap or pillar up (Movements.scafoldingBlocks, allow1by1towers)
//   parkour        jumps across gaps: one block walking, up to three sprinting (Movements.allowParkour)
//   sprint         sprints where the way is straight
//   openGates      opens the fence gates in the way (Movements.canOpenDoors: gates, not doors)
//   avoidEntities  plans around the entities in the way (Movements.allowEntityDetection)
//   humanLike      turns and acts as a person does: the look eases toward where it goes rather than snapping, the eyes
//                  on the route ahead; the player walks once it faces the way, and breaks or places once the crosshair
//                  settled on the block
//   fly            in creative, flies where that is quicker (Movements.allowFlying): it takes off with a double jump and
//                  lands with another
//   glide          with an elytra worn (out of creative), glides where that is quicker (Movements.allowGliding),
//                  boosted by the firework rockets of the hotbar
//   maxDrop        the highest drop it walks off, in blocks: more than 3 hurts in survival

const DEFAULT_OPTIONS = Object.freeze({
  dig: true,
  place: true,
  parkour: true,
  sprint: true,
  openGates: true,
  avoidEntities: true,
  humanLike: true,
  fly: true,
  glide: true,
  maxDrop: 3
})

const MAX_DROP = 16
const FLAGS = ['dig', 'place', 'parkour', 'sprint', 'openGates', 'avoidEntities', 'humanLike', 'fly', 'glide']

// Options as given (a page's, a caller's): the known ones of the right kind over `base`, the drop within 0 to 16
function pathfinderOptions (given, base = DEFAULT_OPTIONS) {
  const options = { ...base }
  if (!given || typeof given !== 'object') return options
  for (const flag of FLAGS) if (typeof given[flag] === 'boolean') options[flag] = given[flag]
  if (typeof given.maxDrop === 'number' && Number.isFinite(given.maxDrop)) options.maxDrop = Math.max(0, Math.min(MAX_DROP, Math.round(given.maxDrop)))
  return options
}

module.exports = { DEFAULT_OPTIONS, pathfinderOptions, FLAGS }
