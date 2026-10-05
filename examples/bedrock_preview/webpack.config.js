// Builds the preview pages (src/<page>.js -> public/<page>.js). They build their worlds in the page with
// minecraft-data, fetched one version at a time (mc-data/), as the viewer's worker does.
//
//   npm install                   (in the repository: builds the viewer and its assets into public/)
//   npx webpack -c examples/bedrock_preview/webpack.config.js
//   node examples/bedrock_preview/server.js
const path = require('path')
const webpack = require('webpack')
const { lazyMinecraftData } = require('../../viewer/webpack/lazyMinecraftData')

const root = path.resolve(__dirname, '../..')

module.exports = lazyMinecraftData({
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
