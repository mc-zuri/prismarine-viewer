/* global self, fetch, Response, DecompressionStream */
// The replay page's reader of recordings, in a Web Worker (replay-worker.js): it fetches a recording as it is
// (recordings/<name>: a .proxy.bin, or a .proxy.bin.gz) and the world.json beside it, reads its packets with
// bedrock-protocol (gameplay/protocol/codec.js: the protocol of minecraft-data's version, as the gameplay page writes
// and reads them) and sends the page what it tells (replay/decode.js). No server is needed: the recordings are files.
//
//   page -> worker   { name }
//   worker -> page   { type: 'status', text }   { type: 'recording', recording }   { type: 'error', message }
// (protodef runs the code it compiles with eval, which sees the global Buffer)
globalThis.Buffer = globalThis.Buffer ?? require('buffer').Buffer
const { preload } = require('../../../viewer/lib/mcData')
const { createCodec } = require('./gameplay/protocol/codec')
const { hasProtocol } = require('./gameplay/data')
const { records, decodeRecording, candidates } = require('./replay/decode')

const post = message => self.postMessage(message)
const url = name => 'recordings/' + name.split('/').map(encodeURIComponent).join('/')

async function bytesOf (name) {
  const response = await fetch(url(name))
  if (!response.ok) throw new Error(`${url(name)}: ${response.status}`)
  const body = name.endsWith('.gz') ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body
  return Buffer.from(await new Response(body).arrayBuffer())
}

// the world.json of the recording's folder, or null
async function worldOf (name) {
  const response = await fetch(url(name.split('/').slice(0, -1).concat('world.json').join('/'))).catch(() => null)
  return response?.ok ? response.json() : null
}

// a reader of the version's packets: its own protocol, else of the protocols this build has, the nearest before or after
// that reads more of sample (a client build minecraft-data has no version of shares the protocol of one of them)
async function readerOf (version, sample) {
  const known = Object.keys(require('minecraft-data/data.js').bedrock ?? {}).filter(hasProtocol)
  const options = candidates(version, known)
  if (!options.length) throw new Error(`no protocol of bedrock ${version} here`)
  await Promise.all(options.map(v => preload('bedrock_' + v)))
  if (options.length === 1) return createCodec(options[0])
  const reads = v => {
    const codec = createCodec(v)
    return sample.filter(buffer => {
      try {
        codec.decode(buffer)
        return true
      } catch {
        return false
      }
    }).length
  }
  const best = options.map(v => ({ v, reads: reads(v) })).reduce((a, b) => b.reads > a.reads ? b : a)
  return createCodec(best.v)
}

self.onmessage = async ({ data }) => {
  try {
    post({ type: 'status', text: `${data.name}: fetching...` })
    const [bytes, world] = await Promise.all([bytesOf(data.name), worldOf(data.name)])
    const read = records(bytes)
    post({ type: 'status', text: `${data.name}: reading ${read.records.length} records of ${read.version}...` })
    const codec = await readerOf(read.version, read.records.filter(r => r.kind === 'C').slice(0, 300).map(r => r.buffer))
    post({ type: 'recording', recording: decodeRecording(read, buffer => codec.decode(buffer), world) })
  } catch (err) {
    post({ type: 'error', message: err.stack ?? String(err) })
  }
}
