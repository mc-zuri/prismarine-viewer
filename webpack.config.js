// eslint-disable-next-line no-unused-vars
const webpack = require('webpack')
const path = require('path')
const { lazyMinecraftData } = require('./viewer/webpack/lazyMinecraftData')
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

const indexConfig = {
  entry: './lib/index.js',
  mode: 'production',
  output: {
    path: path.resolve(__dirname, './public'),
    filename: './index.js'
  },
  resolve: {
    fallback: {
      zlib: false
    }
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
    // fix "process is not defined" error:
    new webpack.ProvidePlugin({
      process: 'process/browser'
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    }),
    new webpack.NormalModuleReplacementPlugin(
      // eslint-disable-next-line
      /viewer[\/|\\]lib[\/|\\]utils/,
      './utils.web.js'
    )
    // new BundleAnalyzerPlugin()
  ]
}

// The worker meshes the world, with minecraft-data: only the files that takes, and of a version only once a world of
// it is shown. They are copied to public/mc-data/, which the worker fetches from beside itself.
const workerConfig = lazyMinecraftData({
  entry: './viewer/lib/worker.js',
  mode: 'production',
  output: {
    path: path.join(__dirname, '/public'),
    filename: './worker.js'
  },
  performance: { hints: false },
  resolve: {
    fallback: {
      zlib: false
    }
  },
  plugins: [
    // fix "process is not defined" error:
    new webpack.ProvidePlugin({
      process: 'process/browser'
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    })
  ]
})

module.exports = [indexConfig, workerConfig]
