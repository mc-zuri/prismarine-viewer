// Serves the preview pages beside the viewer's assets (public/ of the repository, built by npm install), and the
// recordings the replay page plays.
//
//   node examples/bedrock_preview/server.js [port] [recordings directory]
//   http://localhost:3000/blocks.html, http://localhost:3000/entities.html, http://localhost:3000/items.html,
//   http://localhost:3000/replay.html
//
// The recordings directory (or $RECORDINGS) holds .proxy.bin recordings of a Bedrock client's packets, each folder
// with the world.json of the world they were made in; reading them takes bedrock-protocol (npm install
// bedrock-protocol).
const fs = require('fs')
const path = require('path')
const express = require('express')
const compression = require('compression')
const { readRecording, listRecordings } = require('./recording')
const { checkExport, bedrockExport } = require('./itemCheck')

const port = Number(process.argv[2] ?? process.env.PORT ?? 3000)
const recordings = process.argv[3] ?? process.env.RECORDINGS ?? null
const app = express()
app.use(compression())
app.use(express.static(path.join(__dirname, 'public')))
app.use(express.static(path.join(__dirname, '../../public')))

// The items page reads minecraft-assets' Bedrock export itself, every version of it (the viewer builds those that have
// block states): /bedrock-assets/versions.json, and a version's files, /bedrock-assets/<version>/<entry>/..., wherever
// versions.json says the version's entry is kept (an entry the same as an earlier version's is kept once).
// $BEDROCK_ASSETS: another export to show (an extractor's --out), to look at before it goes into minecraft-assets
const bedrockData = process.env.BEDROCK_ASSETS ?? path.join(path.dirname(require.resolve('minecraft-assets/package.json')), 'minecraft-assets/data/bedrock')
const bedrockIndex = () => JSON.parse(fs.readFileSync(path.join(bedrockData, 'versions.json'), 'utf8'))
app.get('/bedrock-assets/versions.json', (req, res) => res.sendFile(path.join(bedrockData, 'versions.json')))
app.get(/^\/bedrock-assets\/([^/]+)\/(.+)$/, (req, res) => {
  const [version, file] = [req.params[0], req.params[1]]
  const parts = file.split('/')
  const index = bedrockIndex()
  if (!index[version] || parts.some(p => !/^[\w.-]+$/.test(p) || p === '..')) return res.status(404).end()
  const holder = index[version].paths?.[parts[0]] ?? version
  res.sendFile(path.join(bedrockData, holder, ...parts), err => { if (err && !res.headersSent) res.status(404).end() })
})
// every version's item icons checked (itemCheck.js)
app.get('/bedrock-items-check', (req, res) => {
  checkExport(null, bedrockExport(bedrockData)).then(results => res.json(results), err => res.status(500).json({ error: err.message }))
})

app.get('/recordings', (req, res) => res.json(listRecordings(recordings)))
const decoded = new Map()
app.get('/recording', (req, res) => {
  const name = String(req.query.name ?? '')
  if (!recordings || !listRecordings(recordings).includes(name)) return res.status(404).json({ error: 'no such recording' })
  try {
    if (!decoded.has(name)) decoded.set(name, readRecording(path.join(recordings, name)))
    res.json(decoded.get(name))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(port, () => console.log(`Bedrock preview on http://localhost:${port}/` + (recordings ? `, recordings of ${recordings}` : '')))
