const supportedVersions = ['1.8.8', '1.9.4', '1.10.2', '1.11.2', '1.12.2', '1.13.2', '1.14.4', '1.15.2', '1.16.1', '1.16.4', '1.17.1', '1.18.1', '1.19', '1.20.1', '1.21.1', '1.21.4', '26.1']

// Bedrock Edition versions, named with their edition prefix so that a Java and a Bedrock version never resolve to each
// other's assets: those minecraft-data has the block states of (1.16.201 and later), which the viewer needs to read
// their worlds. prerender.js builds those minecraft-assets has assets for.
const bedrockSupportedVersions = ['1.16.201', '1.16.210', '1.16.220', '1.17.0', '1.17.10', '1.17.30', '1.17.40',
  '1.18.0', '1.18.11', '1.18.30', '1.19.1', '1.19.10', '1.19.20', '1.19.21', '1.19.30', '1.19.40', '1.19.50',
  '1.19.60', '1.19.62', '1.19.63', '1.19.70', '1.19.80', '1.20.0', '1.20.10', '1.20.15', '1.20.30', '1.20.40',
  '1.20.50', '1.20.61', '1.20.71', '1.20.80', '1.21.0', '1.21.2', '1.21.20', '1.21.30', '1.21.42', '1.21.50',
  '1.21.60', '1.21.70', '1.21.80', '1.21.90', '1.21.93', '1.21.100', '1.21.111', '1.21.120', '1.21.124', '1.21.130',
  '1.26.0', '1.26.10', '1.26.20', '1.26.30', '1.26.40', '1.26.45', '1.26.51'].map(v => 'bedrock_' + v)

const lastOfMajor = {}
for (const version of supportedVersions) {
  const major = toMajor(version)
  if (lastOfMajor[major]) {
    if (minor(lastOfMajor[major]) < minor(version)) {
      lastOfMajor[major] = version
    }
  } else {
    lastOfMajor[major] = version
  }
}

function toMajor (version) {
  const [a, b] = (version + '').split('.')
  return a + '.' + b
}

function minor (version) {
  const [, , c] = (version + '.0').split('.')
  return parseInt(c, 10)
}

function compareVersions (a, b) {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  }
  return 0
}

// The supported version whose assets show a version: itself, else for Java the last of its major, for Bedrock the
// newest before it of its major (a patch newer than the assets know); null for none
function getVersion (version) {
  if (typeof version === 'string' && version.startsWith('bedrock_')) {
    if (bedrockSupportedVersions.includes(version)) return version
    const bare = version.slice('bedrock_'.length)
    const earlier = bedrockSupportedVersions
      .map(v => v.slice('bedrock_'.length))
      .filter(v => toMajor(v) === toMajor(bare) && compareVersions(v, bare) < 0)
      .pop()
    return earlier ? 'bedrock_' + earlier : null
  }
  if (supportedVersions.indexOf(version) !== -1) return version
  const major = toMajor(version)
  if (lastOfMajor[major] === undefined) {
    return null
  }
  return lastOfMajor[toMajor(version)]
}

// Of Bedrock versions that have assets built (candidates), those that show `version`: its own, else those of the
// newest before it of its major, else of the oldest after it of its major (block names change little within one);
// null for none
function nearestBedrockVersion (version, candidates) {
  if (candidates.includes(version)) return version
  const bare = version.replace(/^bedrock_/, '')
  const major = candidates.map(v => v.replace(/^bedrock_/, '')).filter(v => toMajor(v) === toMajor(bare)).sort(compareVersions)
  const found = major.filter(v => compareVersions(v, bare) < 0).pop() ?? major.find(v => compareVersions(v, bare) > 0)
  return found ? 'bedrock_' + found : null
}

// The version a bot's world is shown as: mineflayer names a Bedrock bot's version without its edition (bot.version
// '1.26.51', with bot.edition 'bedrock')
function viewerVersion (bot) {
  if (bot.edition === 'bedrock' || bot.registry?.type === 'bedrock') {
    const version = bot.registry?.version?.minecraftVersion ?? bot.version
    return version.startsWith('bedrock_') ? version : 'bedrock_' + version
  }
  return bot.version
}

// What the viewer cannot tell from a bot's version alone. blockHashes (Bedrock): whether the state ids of its chunk
// columns are block network hashes. A server says so in start_game (block_network_ids_are_hashes), but the columns
// carry the ids of the bot's registry, which uses hashes only once it has been told to: ask the registry first. In
// index space, the air block's default state indexes the air entry of blockStates.
function viewerWorldOptions (bot) {
  const registry = bot.registry
  const air = registry?.blocksByName?.air
  if (registry?.type === 'bedrock' && air && Array.isArray(registry.blockStates)) {
    return { blockHashes: registry.blockStates[air.defaultState]?.name !== 'air' }
  }
  const startGame = bot._client?.startGameData
  if (!startGame || startGame.block_network_ids_are_hashes === undefined) return {}
  return { blockHashes: !!startGame.block_network_ids_are_hashes }
}

module.exports = { getVersion, nearestBedrockVersion, viewerVersion, viewerWorldOptions, supportedVersions, bedrockSupportedVersions }
