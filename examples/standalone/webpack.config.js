const webpack = require('webpack')
const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
const { lazyMinecraftData } = require('prismarine-viewer/viewer/webpack/lazyMinecraftData')

// The page builds its world with minecraft-data too: of its version only, fetched as the viewer's worker does
// (index.js awaits preload). Its files are the worker's, in mc-data/.
const config = lazyMinecraftData({
  mode: 'production',
  entry: path.resolve(__dirname, './index.js'),
  output: {
    path: path.resolve(__dirname, './public'),
    filename: './index.js'
  },
  resolve: {
    // one minecraft-data for the page and the linked viewer, so that the one preload loads is the one read
    alias: { 'minecraft-data': path.dirname(require.resolve('minecraft-data/package.json')) },
    fallback: {
      zlib: require.resolve('browserify-zlib'),
      stream: require.resolve('stream-browserify'),
      buffer: require.resolve('buffer/'),
      events: require.resolve('events/'),
      assert: require.resolve('assert/')
    }
  },
  plugins: [
    // fix "process is not defined" error:
    new webpack.ProvidePlugin({
      process: 'process/browser'
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    }),
    new webpack.NormalModuleReplacementPlugin(
      /prismarine-viewer[/|\\]viewer[/|\\]lib[/|\\]utils/,
      './utils.web.js'
    ),
    new CopyPlugin({
      patterns: [
        { from: '../../public/blocksStates/', to: './blocksStates/' },
        { from: '../../public/textures/*.png', to: './textures/' },
        { from: '../../public/worker.js', to: './' },
        { from: '../../public/worldBounds.json', to: './' }
      ]
    })
  ],
  devServer: {
    contentBase: path.resolve(__dirname, './public'),
    compress: true,
    inline: true,
    // open: true,
    hot: true,
    watchOptions: {
      ignored: /node_modules/
    }
  }
})

module.exports = config
