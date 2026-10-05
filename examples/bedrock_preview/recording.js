// A recording of a Bedrock client's packets read in Node, from its file (the page reads them itself, in replayWorker.js):
// src/replay/decode.js decodes it, its packets read with bedrock-protocol's parser, compiled from the protocol of the
// minecraft-data bedrock-protocol is installed with (npm install bedrock-protocol), found by that data's dataPaths.json.
//
//   readRecording(file) -> decode.js decodeRecording's { version, recorded, world, start, events }
//   listRecordings(directory) -> the recordings under it (.proxy.bin, or .proxy.bin.gz), by their path from it
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { records, decodeRecording, candidates } = require('./src/replay/decode')

const readers = new Map()
// a reader of a client version's packets: bedrock-protocol's, compiled from the protocol of the minecraft-data
// bedrock-protocol is installed with. Its files are found by its dataPaths.json (and not its data.js, which is
// generated, and can be out of date in a checkout). A version the data has none of is read with the nearest that
// reads more of sample (the recording's packets). -> { version, parser }
function packetReader (version, sample = []) {
  let data, ProtoDefCompiler, FullPacketParser, minecraftTypes
  try {
    const bedrockProtocol = path.dirname(require.resolve('bedrock-protocol/package.json'))
    const from = id => require.resolve(id, { paths: [bedrockProtocol] })
    ;({ Compiler: { ProtoDefCompiler }, FullPacketParser } = require(from('protodef')))
    minecraftTypes = require(path.join(bedrockProtocol, 'src/datatypes/compiler-minecraft'))
    data = path.join(path.dirname(from('minecraft-data/package.json')), 'minecraft-data/data')
  } catch {
    throw new Error('the replay reads recordings with bedrock-protocol: npm install bedrock-protocol')
  }
  const paths = JSON.parse(fs.readFileSync(path.join(data, 'dataPaths.json'), 'utf8')).bedrock
  const readerOf = chosen => {
    const key = data + '|' + chosen
    if (!readers.has(key)) {
      const protocol = JSON.parse(fs.readFileSync(path.join(data, paths[chosen].protocol, 'protocol.json'), 'utf8'))
      const compiler = new ProtoDefCompiler()
      compiler.addTypesToCompile(protocol.types)
      compiler.addTypes(minecraftTypes)
      readers.set(key, { version: chosen, parser: new FullPacketParser(compiler.compileProtoDefSync(), 'mcpe_packet') })
    }
    return readers.get(key)
  }
  const options = candidates(version, Object.keys(paths).filter(v => paths[v].protocol))
  if (!options.length) throw new Error(`no protocol of bedrock ${version} in ${data}`)
  if (options.length === 1 || !sample.length) return readerOf(options[0])
  const reads = reader => sample.filter(buffer => {
    try {
      reader.parser.parsePacketBuffer(buffer)
      return true
    } catch {
      return false
    }
  }).length
  const scored = options.map(v => ({ reader: readerOf(v), reads: reads(readerOf(v)) }))
  return scored.reduce((best, s) => s.reads > best.reads ? s : best).reader
}

// a recording's bytes, of a .proxy.bin or a .proxy.bin.gz
const bytesOf = file => file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file)

function readRecording (file) {
  const read = records(bytesOf(file))
  const { parser } = packetReader(read.version, read.records.filter(r => r.kind === 'C').slice(0, 300).map(r => r.buffer))
  const worldFile = path.join(path.dirname(file), 'world.json')
  const world = fs.existsSync(worldFile) ? JSON.parse(fs.readFileSync(worldFile, 'utf8')) : null
  return decodeRecording(read, buffer => parser.parsePacketBuffer(buffer).data, world)
}

// the recordings under a directory, by their path from it
function listRecordings (root) {
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.proxy\.bin(\.gz)?$/.test(entry.name)) out.push(path.relative(root, full).replace(/\\/g, '/'))
    }
  }
  if (root && fs.existsSync(root)) walk(root)
  return out.sort()
}

module.exports = { readRecording, listRecordings, records, packetReader }
