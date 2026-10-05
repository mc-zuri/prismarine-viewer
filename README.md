# prismarine-viewer

Web based viewer for servers and bots

[![NPM version](https://img.shields.io/npm/v/prismarine-viewer.svg)](http://npmjs.com/package/prismarine-viewer)
[![Build Status](https://img.shields.io/github/actions/workflow/status/PrismarineJS/prismarine-viewer/ci.yml.svg?label=CI&logo=github&logoColor=lightgrey)](https://github.com/PrismarineJS/prismarine-viewer/actions?query=workflow%3A%22CI%22)
[![Discord](https://img.shields.io/badge/chat-on%20discord-brightgreen.svg)](https://discord.gg/GsEFRM8)
[![Gitter](https://img.shields.io/badge/chat-on%20gitter-brightgreen.svg)](https://gitter.im/PrismarineJS/general)
[![Irc](https://img.shields.io/badge/chat-on%20irc-brightgreen.svg)](https://irc.gitter.im/)
[![Issue Hunt](https://github.com/BoostIO/issuehunt-materials/blob/master/v1/issuehunt-shield-v1.svg)](https://issuehunt.io/r/PrismarineJS/prismarine-viewer)

[![Try it on gitpod](https://img.shields.io/badge/try-on%20gitpod-brightgreen.svg)](https://gitpod.io/#https://github.com/PrismarineJS/prismarine-viewer)

[<img src="https://prismarinejs.github.io/prismarine-viewer/test_1.18.1.png" alt="viewer" width="300">](https://prismarinejs.github.io/prismarine-viewer/)

Supports versions 1.8.8, 1.9.4, 1.10.2, 1.11.2, 1.12.2, 1.13.2, 1.14.4, 1.15.2, 1.16.1, 1.16.4, 1.17.1, 1.18.1, 1.19, 1.20.1, 1.21.1, 1.21.4, 26.1. Other versions of the same major (e.g. 1.21.8) render with the textures and models of the closest supported one.

Bedrock Edition worlds render too, from 1.16.201 to 1.26.51, where minecraft-assets has the version's Bedrock assets. Bedrock versions are named with their edition prefix (`bedrock_1.26.51`); a Bedrock bot's version is turned into one by the viewer. A patch newer than the assets know renders with the newest version before it of the same major. Their entities are the game's client entities, with the particle effects of the game's resource packs: those the entities start (a blaze's flames, an evoker's spell) and those the server spawns.

## Install

```bash
npm install prismarine-viewer
```

## Example

```js
const mineflayer = require('mineflayer')
const mineflayerViewer = require('prismarine-viewer').mineflayer

const bot = mineflayer.createBot({
  username: 'Bot'
})

bot.once('spawn', () => {
  mineflayerViewer(bot, { port: 3000 }) // Start the viewing server on port 3000

  // Draw the path followed by the bot
  const path = [bot.entity.position.clone()]
  bot.on('move', () => {
    if (path[path.length - 1].distanceTo(bot.entity.position) > 1) {
      path.push(bot.entity.position.clone())
      bot.viewer.drawLine('path', path)
    }
  })
})
```

More examples:

* First person bot [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/firstperson_bot.js)
* Record view as video file [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/headless.js)
* Streaming video to a python script [example](https://github.com/PrismarineJS/prismarine-viewer/tree/master/examples/python)
* Visualize a world, without a bot [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/standalone.js)
* Visualize the world coming from a proxy [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/proxy.js)
* Click to move [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/clickmove.js)
* Use the core api for viewing worlds [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/core)
* Create an electron app with viewer [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/electron)
* Create a fully front end viewer with an in memory world [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/standalone)
* A minecraft web client example, using mineflayer and a websocket proxy [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/web_client)
* Export parts of worlds as screenshot or 3d models [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/exporter)
* Visualize a Bedrock world saved on disk [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/bedrock_world.js)
* Preview a Bedrock world of several biomes with its entities moving about, every block state, entity and particle effect of a Bedrock version, and water and plants by biome [example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/bedrock_preview)

## Projects using prismarine-viewer

* [prismarine-web-client](https://gitlab.com/PrismarineJS/prismarine-web-client) A minecraft client in your browser


## API

### prismarine-viewer

#### viewer

The core rendering library. It provides Viewer and WorldView which together make it possible to render a minecraft world.
Check its [API](viewer/README.md)

#### mineflayer

Serve a webserver allowing to visualize the bot surrounding, in first or third person. Comes with drawing functionnalities.

```js
const { mineflayer } = require('prismarine-viewer')
```

Options:
* `viewDistance` view radius, in chunks, default: `6`
* `firstPerson` is the view first person ? default: `false`
* `port` the port for the webserver, default: `3000`

Players are rendered with their skin, wide or slim, and cape when the server sends skin data (online-mode servers).

[example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/bot.js)

#### trackBedrock (bot)

For a Bedrock bot, keeps what its client is told that mineflayer does not keep and the viewer draws entities with: the entity properties (a cow's climate variant, a bee's nectar) and the players' skins. Much of it is sent once, at login (the property definitions, the skins of the players already there), so call it right after creating the bot; `mineflayer` and `headless` call it themselves when they start, and know what comes from then on. Nothing for a Java bot.

```js
const { trackBedrock } = require('prismarine-viewer')
const bot = mineflayer.createBot({ ... })
trackBedrock(bot)
```

#### standalone

Serve a webserver allowing to visualize a world.

```js
const { standalone } = require('prismarine-viewer')
```

Options:
* `version` the version to use: `1.21.4`, or a Bedrock version (`bedrock_1.26.51`)
* `world` the world to show: an object whose `getColumn(x, z)` gives (or resolves to) the prismarine-chunk column at chunk x, z
* `center` a vec3 to center the view on, default: `new Vec3(0, 0, 0)`
* `viewDistance` view radius, in chunks, default: `4`
* `port` the port for the webserver, default: `3000`
* `worldOptions` what the version alone does not say of the world, default: `{}`. For Bedrock, `blockHashes`: whether its state ids are block network hashes (as a server started with them sends them) rather than indexes. When not given, the first column tells.

[example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/standalone.js)

#### headless

Render the bot view and stream it to a file or over TCP.

```js
const { headless } = require('prismarine-viewer')
```

Options:
* `viewDistance` view radius, in chunks, default: `6`
* `output` the output file or a `host:port` address to stream to, default: `output.mp4`
* `frames` number of frames to record, `-1` for infinite, default: `200`
* `width` the width of a frame, default: `512`
* `height` the height of a frame, default: `512`

[example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/headless.js)

### Drawing (mineflayer mode)

All drawing function have a unique id that can be used to replace or erase the primitive.

#### bot.viewer.drawLine (id, points, color=0xff0000)

Draw a line passing through all the `points`.

#### bot.viewer.erase (id)

Remove the primitive with the given id from the display.

#### bot.viewer.close ()

Stop the server and disconnect users.

## Bundling the viewer

The viewer's worker reads minecraft-data to hold the world it draws. `public/worker.js` holds none of it: the files of a version are JSON files in `public/mc-data/`, fetched when a world of that version is first shown, so they must be served beside `worker.js`. A page that bundles minecraft-data itself can do the same with `viewer/webpack/lazyMinecraftData.js` (see the [standalone example](https://github.com/PrismarineJS/prismarine-viewer/blob/master/examples/standalone/webpack.config.js) and the [viewer API](viewer/README.md)).

## Tests

`npm run jestTest -- -t "1.9.4"` runs the tests of one version against a Minecraft server.

`npm run jestTest -- --testPathIgnorePatterns test/viewer.test.js test/simple.test.js` runs those that need no server, after the build (`npm install`).
