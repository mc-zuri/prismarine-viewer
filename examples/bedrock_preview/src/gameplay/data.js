// What the gameplay page and its server read of minecraft-data, and the versions they play. Loaded by the bundles and
// by the Node check alike, so it requires nothing of the build (lazyMinecraftData.js reads files: a bundle must not
// take it in) and nothing of the page.

// The data files of a version the gameplay bundles keep: the viewer's (blocks, their states and collision shapes,
// biomes, the version), the packets, the items (item states, the hotbar), and the materials, enchantments and effects
// (how long a block takes to break with what, which the pathfinder weighs: prismarine-block's digTime).
// viewer/webpack/lazyMinecraftData.js's WORKER_KEYS and five more.
const GAMEPLAY_KEYS = ['blocks', 'blockStates', 'blockCollisionShapes', 'biomes', 'version', 'protocol', 'items', 'materials', 'enchantments', 'effects']

// 'bedrock_1.26.51' -> '1.26.51'
const bare = version => version.replace(/^bedrock_/, '')

// a < b: -1, a = b: 0, a > b: 1, of dotted versions ('1.21.130' > '1.21.2')
function compareVersions (a, b) {
  const pa = bare(a).split('.').map(Number)
  const pb = bare(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}

// Whether minecraft-data has the packets of a version, asked of its table without loading the version
function hasProtocol (version) {
  const table = require('minecraft-data/data.js').bedrock?.[bare(version)]
  return !!table && 'protocol' in table
}

// Whether a version can name block states by their hashes (minecraft-data's blockHashes feature)
const supportsHashes = version => compareVersions(version, '1.19.80') >= 0

module.exports = { GAMEPLAY_KEYS, bare, compareVersions, hasProtocol, supportsHashes }
