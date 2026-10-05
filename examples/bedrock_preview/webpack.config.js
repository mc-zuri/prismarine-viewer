// Builds the preview pages (src/<page>.js -> public/<page>.js). They build their worlds in the page with
// minecraft-data, fetched one version at a time (mc-data/), as the viewer's worker does.
//
//   npm install                   (in the repository: builds the viewer and its assets into public/)
//   npx webpack -c examples/bedrock_preview/webpack.config.js
//   node examples/bedrock_preview/server.js
//
// The gameplay page and its server (a worker) are bundles of their own, built with the packets and items of each
// version too: npx webpack -c examples/bedrock_preview/webpack.config.js --config-name gameplay --config-name
// gameplay-server builds those alone.
const path = require('path')
const webpack = require('webpack')
const { lazyMinecraftData } = require('../../viewer/webpack/lazyMinecraftData')
const { GAMEPLAY_KEYS } = require('./src/gameplay/data')

const root = path.resolve(__dirname, '../..')

const pages = lazyMinecraftData({
  name: 'pages',
  mode: 'production',
  context: root,
  entry: {
    blocks: path.join(__dirname, 'src/blocks.js'),
    entities: path.join(__dirname, 'src/entities.js'),
    world: path.join(__dirname, 'src/world.js'),
    replay: path.join(__dirname, 'src/replay.js'),
    particles: path.join(__dirname, 'src/particles.js'),
    items: path.join(__dirname, 'src/items.js')
  },
  output: {
    path: path.join(__dirname, 'public'),
    filename: '[name].js'
  },
  resolve: {
    modules: [path.join(root, 'node_modules'), 'node_modules'],
    fallback: { zlib: false }
  },
  module: {
    rules: [
      {
        // three declares sideEffects: false, but examples/js scripts work by attaching to the THREE global
        test: /three[/\\]examples[/\\]js/,
        sideEffects: true
      }
    ]
  },
  plugins: [
    new webpack.ProvidePlugin({ process: 'process/browser' }),
    new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
    // (matched against the file it resolves to: utils.js, utils.electron.js)
    new webpack.NormalModuleReplacementPlugin(/viewer[/\\]lib[/\\]utils/, './utils.web.js')
  ],
  performance: { hints: false }
})

// The gameplay page (target web), its server or the replay's reader of recordings (webworker): bedrock-protocol's
// datatypes and framer, prismarine-physics' Bedrock engine (TypeScript, which webpack strips of its types itself), and
// minecraft-data with the packets and items
function gameplay (name, source, target) {
  return lazyMinecraftData({
    name,
    mode: 'production',
    context: root,
    target,
    entry: { [name]: path.join(__dirname, 'src', source) },
    output: {
      path: path.join(__dirname, 'public'),
      filename: '[name].js'
    },
    resolve: {
      modules: [path.join(root, 'node_modules'), 'node_modules'],
      fallback: { zlib: false },
      alias: {
        // bedrock-protocol's uuid type reads and writes UUIDs with uuid-1345, which draws on Node's crypto and os when
        // it loads: what the type uses of it
        'uuid-1345$': path.join(__dirname, 'src/gameplay/uuid.js'),
        // the blob cache's hashes (prismarine-chunk): xxhash-wasm's ES build has its function as the default export,
        // which a require does not give, and its CommonJS one takes TextEncoder from Node's util
        'xxhash-wasm$': path.join(root, 'node_modules/xxhash-wasm/umd/xxhash-wasm.js')
      }
    },
    module: {
      rules: [
        { test: /three[/\\]examples[/\\]js/, sideEffects: true },
        // the physics' exact sine routines, fetched by the page (prismarine-physics math/crt.ts loadCrtAsync)
        { test: /crt-math\.wasm$/, type: 'asset/resource', generator: { filename: '[name][ext]' } }
      ]
    },
    plugins: [
      new webpack.ProvidePlugin({ process: 'process/browser' }),
      new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
      new webpack.NormalModuleReplacementPlugin(/viewer[/\\]lib[/\\]utils/, './utils.web.js')
    ],
    experiments: { typescript: true },
    // bedrock-protocol compiles some of its types from the source of its own functions (compiler-minecraft.js js()),
    // which a minifier rewrites
    optimization: { minimize: false },
    performance: { hints: false }
  }, { keys: GAMEPLAY_KEYS })
}

// (the replay's reader of recordings reads their packets as the gameplay page does)
module.exports = [pages, gameplay('gameplay', 'gameplay.js', 'web'), gameplay('gameplay-server', 'gameplayServer.js', 'webworker'), gameplay('replay-worker', 'replayWorker.js', 'webworker')]
