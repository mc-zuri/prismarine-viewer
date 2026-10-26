const supportedVersions = ['1.8.8', '1.9.4', '1.10.2', '1.11.2', '1.12.2', '1.13.2', '1.14.4', '1.15.2', '1.16.1', '1.16.4', '1.17.1', '1.18.1', '1.19', '1.20.1', '1.21.1', '1.21.4', '26.1']

// Bedrock versions with assets of their own in minecraft-assets (data/bedrock); any other Bedrock version draws with
// the newest of them that is not newer than it
const bedrockSupportedVersions = ['0.14', '0.15', '1.0', '1.16.201', '1.16.210', '1.16.220', '1.17.0', '1.17.10', '1.17.30', '1.17.40',
  '1.18.0', '1.18.11', '1.18.30', '1.19.1', '1.19.10', '1.19.20', '1.19.30', '1.19.40', '1.19.50', '1.19.60', '1.19.63', '1.19.70', '1.19.80', '1.20.0',
  '1.20.10', '1.20.30', '1.20.40', '1.20.50', '1.20.61', '1.20.71', '1.20.80', '1.21.0', '1.21.20', '1.21.30',
  '1.21.42', '1.21.50', '1.21.60', '1.21.70', '1.21.80', '1.21.90', '1.21.93', '1.21.100', '1.21.111',
  '1.21.120', '1.21.130', '1.26.0', '1.26.10', '1.26.20', '1.26.30', '1.26.40', '1.26.51'].map(v => 'bedrock_' + v)

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
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

// 'bedrock_1.21.2' -> 'bedrock_1.21.0'
function getBedrockVersion (version) {
  const bare = version.slice('bedrock_'.length)
  let found = null
  for (const v of bedrockSupportedVersions) {
    if (compareVersions(v.slice('bedrock_'.length), bare) <= 0) found = v
  }
  return found
}

function getVersion (version) {
  if (supportedVersions.indexOf(version) !== -1) return version
  if (String(version).startsWith('bedrock_')) return getBedrockVersion(version)
  const major = toMajor(version)
  if (lastOfMajor[major] === undefined) {
    return null
  }
  return lastOfMajor[toMajor(version)]
}

// the version among candidates (bedrock_<v>) a Bedrock version takes its assets from: itself, else the newest of its
// major before it, else the oldest of its major after it; null when its major has none
function nearestBedrockVersion (version, candidates) {
  if (candidates.includes(version)) return version
  const bare = version.replace(/^bedrock_/, '')
  const major = candidates.map(v => v.replace(/^bedrock_/, '')).filter(v => toMajor(v) === toMajor(bare)).sort(compareVersions)
  const found = major.filter(v => compareVersions(v, bare) < 0).pop() ?? major.find(v => compareVersions(v, bare) > 0)
  return found ? 'bedrock_' + found : null
}

module.exports = { getVersion, nearestBedrockVersion, supportedVersions, bedrockSupportedVersions }
