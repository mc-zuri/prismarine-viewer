// Serves the preview pages beside the viewer's assets (public/ of the repository, built by npm install), and the
// recordings the replay page plays: those of public/recordings, and of a directory.
//
//   node examples/bedrock_preview/server.js [port] [recordings directory]
//   http://localhost:3000/blocks.html, http://localhost:3000/entities.html, http://localhost:3000/items.html,
//   http://localhost:3000/replay.html
//
// The recordings directory (or $RECORDINGS) holds .proxy.bin recordings of a Bedrock client's packets (or .proxy.bin.gz),
// each folder with the world.json of the world they were made in. The server sends them as they are, as a static copy
// of the pages has them: the page reads them (replay-worker.js).
const fs = require('fs')
const path = require('path')
const express = require('express')
const compression = require('compression')
const { listRecordings } = require('./recording')
const { checkExport, bedrockExport } = require('./itemCheck')
const { buildInfo } = require('./buildInfo')

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
app.get('/bedrock-items-check.json', (req, res) => {
  checkExport(null, bedrockExport(bedrockData)).then(results => res.json(results), err => res.status(500).json({ error: err.message }))
})

// what the pages are built from (index.html shows it)
app.get('/build.json', (req, res) => res.json(buildInfo()))

// the recordings: of public/recordings (what build-site.js lists), and of the directory, served under recordings/ as
// they are (express.static above sends public's)
app.get('/recordings/index.json', (req, res) => res.json([...new Set([...listRecordings(path.join(__dirname, 'public/recordings')), ...listRecordings(recordings)])].sort()))
if (recordings) app.use('/recordings', express.static(recordings))

app.listen(port, () => console.log(`Bedrock preview on http://localhost:${port}/` + (recordings ? `, recordings of ${recordings}` : '')))
