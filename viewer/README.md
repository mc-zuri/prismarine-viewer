# Viewer

Viewer library provides Viewer and WorldView which together make it possible to render a minecraft world.

## API

### Viewer

The viewer exposes methods to render a world to a three.js renderer.

#### Viewer(renderer)

Build the viewer.

* renderer is a [WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer) instance

#### version

the currently used minecraft version

#### setVersion(version, options = {})

sets the minecraft version

* version is a string such as "1.16.4", or a Bedrock version with its edition prefix such as "bedrock_1.26.51"
* options is what the version alone does not say of the world. For Bedrock, `blockHashes`: whether its block state ids are block network hashes rather than indexes; the first column tells when not given. `viewerWorldOptions(bot)` gives a bot's.

Returns false and stop there if the version is not supported

#### addColumn (x, z, chunk)

Adds a column

* x is a chunk position
* z is a chunk position
* chunk is a prismarine-chunk

#### removeColumn (x, z)

Removes a column

* x is a chunk position
* z is a chunk position

#### setBlockStateId (pos, stateId, layer = 0)

Set a block at this position 

* pos is a Vec3
* stateId is a number
* layer (Bedrock) is 0 for the block, 1 for the liquid in it

#### setBlockEntity (pos, tag)

Set the block entity at this position (Bedrock draws a bed's colour from it)

* pos is a Vec3
* tag is its NBT, or nothing when it is gone

#### updateEntity (e)

Updates an entity

* e is a prismarine-entity

#### updatePrimitive (p)

Updates a primitive

* p is a Three.js primitive

#### spawnParticle (name, position, options = {})

Bedrock: shows a particle effect of the version's resource packs, as the server spawns them (spawn_particle_effect)

* name is the effect's identifier, such as "minecraft:heart_particle" (minecraft: may be left out)
* position is where, in the world ({ x, y, z })
* options: `variables`, the Molang variables the effect is given (name: value, without `variable.`), over those the viewer gives it itself (see lib/bedrock/particles/variables.js); `direction`, the way it goes

An effect the game emits the particles of itself (of manual rate) shows one particle; one that would run on for ever stops after 10 seconds. Nothing shows of an effect the version has none of, or while its assets load. Returns whether it shows.

The particle effects the Bedrock entities name show as their animations and animation controllers say: a blaze's flames, an evoker's spell, a phantom's wing dust.

#### setFirstPersonCamera (pos, yaw, pitch)

Sets the first person camera

* pos is a Vec3 (if pos is null, only yaw and pitch will be updated)
* yaw is in degrees
* pitch is in degrees

#### listen (emitter)

listen to an emitter and applies its modification
the emitter should emit these events:
* entity(e) ; updates an entity
* primitive(p) ; updates a primitive
* loadChunk({x, z, chunk}) ; add a column
* unloadChunk({x, z}) ; removes a column
* blockUpdate({pos, stateId, layer}) ; update a block
* blockEntity({pos, tag}) ; update a block entity
* particle({name, pos, variables}) ; Bedrock: a particle effect the server spawns, at pos (a position in the world: one the server gives relative to an entity is made the entity's position plus it), with the Molang variables it gives the effect, if any: spawnParticle
it also listen to these events:
* mouseClick({ origin, direction, button })

#### update ()

Update the world. This need to be called in the animate function, just before the render.

#### waitForChunksToRender ()

Returns a promise that resolve once all sections marked dirty have been rendered by the worker threads. Can be used to wait for chunks to 'appear'.

### Versions

#### supportedVersions, bedrockSupportedVersions

the versions the viewer has assets for; Bedrock ones with their edition prefix

#### viewerVersion(bot)

the version a mineflayer bot's world is shown as: its version, prefixed for a Bedrock bot

#### viewerWorldOptions(bot)

the `setVersion` options of a mineflayer bot's world

### Bundling

#### viewer/webpack/lazyMinecraftData.js

`lazyMinecraftData(config, { keys, versions })` makes a webpack config load minecraft-data one version at a time: the data files are copied beside the bundle (`mc-data/<edition>/<folder>/<file>.json`, minified) and fetched for the version asked for, instead of all being in it. Only the files named by `keys` are kept (default `WORKER_KEYS`: blocks, block states, collision shapes, biomes and the version, what holding a world takes); the others read as undefined. `versions(type, version)` can keep fewer versions.

Before reading minecraft-data of a version in such a bundle, wait for `require('prismarine-viewer/viewer/lib/mcData').preload(version)`. Outside such a bundle it resolves at once.

### WorldView

WorldView represents the world from a player/camera point of view

#### WorldView(world, viewDistance, position = new Vec3(0, 0, 0), emitter = null)

Build a WorldView

* world is a prismarine-world
* viewDistance is the number of considered chunks
* position is the position of the camera
* emitter is the event emitter to connect (could be null to set emitter to itself or a socket)

#### WorldView.listenToBot(bot)

listen to events from a mineflayer bot (of a Bedrock bot, its packets too: what its entities do, the particle effects the server spawns)

#### WorldView.removeListenersFromBot(bot)

stop listening to the bot event

#### WorldView.init(pos)

start emitting chunks from that position

#### WorldView.loadChunk(pos)

emit chunks at this position

#### WorldView.unloadChunk(pos)

emit unload chunk at this position

#### WorldView.updatePosition(pos)

change the camera position, and emit corresponding events

### MapControls

Default third person controls based on three.js OrbitControls. Refer to the [documentation here](https://threejs.org/docs/#examples/en/controls/OrbitControls). Controls are applied on animation loop, so you need to call `controls.update()` in your render loop.

##### .controlMap
The keyboard controls to use. You can provide an array for any of the keys that bind to an action. Defaults:

```js
this.controlMap = {
  MOVE_FORWARD: ['KeyW', 'KeyZ'],
  MOVE_BACKWARD: 'KeyS',
  MOVE_LEFT: ['KeyA', 'KeyQ'],
  MOVE_RIGHT: 'KeyD',
  MOVE_DOWN: 'ShiftLeft',
  MOVE_UP: 'Space'
}
```

##### setRotationOrigin(pos: THREE.Vector3)
Sets the center point for rotations

##### .verticalTranslationSpeed
How much the y axis is offset for each vertical translation (movement up and down). To control panning speed for the x/z axis, adjust [`.keyPanSpeed`](https://threejs.org/docs/#examples/en/controls/OrbitControls.keyPanSpeed)

##### .enableTouchZoom, .enableTouchRotate, .enableTouchPan
Booleans to toggle touch interaction

##### .registerHandlers(), .unregisterHandlers()
Enables and disables DOM event handling. Useful if you only want to programatically adjust the controls.