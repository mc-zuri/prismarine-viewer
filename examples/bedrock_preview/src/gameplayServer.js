/* global self, fetch, Response, DecompressionStream */
// The gameplay page's Bedrock server, in a Web Worker (gameplay-server.js): the page starts it for a version, then
// hands it one end of a MessageChannel, over which its client and the server exchange the game's packets.
//
//   page -> worker   { type: 'start', version, hashes, world ('explore', 'explore:nether'; none: the showcase), start
//                    (what players start with: { armor: { chest: 'elytra' }, hotbar: { 8: 'oak_boat' }, boat: a boat on
//                    the water near the spawn }), radius, verify }   { type: 'connect' } with the port
//                    { type: 'command', line }
//   worker -> page   { type: 'ready', hashes }   { type: 'log', line }   { type: 'stats', stats }   { type: 'error', message }
// (protodef runs the code it compiles with eval, which sees the global Buffer)
globalThis.Buffer = globalThis.Buffer ?? require('buffer').Buffer
const { preload } = require('../../../viewer/lib/mcData')
const { createServer } = require('./gameplay/server/server')

let server = null
const post = message => self.postMessage(message)

// a world of worldImport.js's: worlds/<name>.json and the columns, worlds/<name>.bin, unzipped
async function loadWorld (name) {
  const file = async (ext) => {
    const response = await fetch(`worlds/${name}.${ext}`)
    if (!response.ok) throw new Error(`worlds/${name}.${ext}: ${response.status}`)
    return response
  }
  const meta = await (await file('json')).json()
  const zipped = (await file('bin')).body.pipeThrough(new DecompressionStream('gzip'))
  const bin = Buffer.from(await new Response(zipped).arrayBuffer())
  return { meta, bin }
}

self.onmessage = async ({ data, ports }) => {
  try {
    switch (data.type) {
      case 'start': {
        // ('explore', or 'explore:nether': a dimension of it)
        const [name, dimension = 'overworld'] = (data.world ?? '').split(':')
        const [world] = await Promise.all([name ? loadWorld(name).then(world => ({ ...world, dimension })) : null, preload('bedrock_' + data.version)])
        server = createServer({ version: data.version, hashes: data.hashes, world, ...data.start, maxRadius: data.radius, verify: data.verify, log: line => post({ type: 'log', line }) })
        server.start()
        setInterval(() => post({ type: 'stats', stats: server.stats() }), 1000)
        post({ type: 'ready', hashes: server.hashes })
        break
      }
      case 'connect':
        server.accept(ports[0])
        break
      case 'command':
        server?.command(data.line)
        break
    }
  } catch (err) {
    post({ type: 'error', message: err.stack ?? String(err) })
  }
}
