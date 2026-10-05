const THREE = require('three')
const TWEEN = require('@tweenjs/tween.js')
const { WorldRenderer } = require('./worldrenderer')
const { Entities } = require('./entities')
const { Primitives } = require('./primitives')
const { getVersion } = require('./version')
const { Vec3 } = require('vec3')

class Viewer {
  constructor (renderer) {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('lightblue')

    this.ambientLight = new THREE.AmbientLight(0xcccccc)
    this.scene.add(this.ambientLight)

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.5)
    this.directionalLight.position.set(1, 1, 0.5).normalize()
    this.directionalLight.castShadow = true
    this.scene.add(this.directionalLight)

    const size = renderer.getSize(new THREE.Vector2())
    this.camera = new THREE.PerspectiveCamera(75, size.x / size.y, 0.1, 1000)

    this.world = new WorldRenderer(this.scene)
    this.entities = new Entities(this.scene)
    this.primitives = new Primitives(this.scene, this.camera)

    this.domElement = renderer.domElement
    this.playerHeight = 1.6
    this.isSneaking = false
  }

  resetAll () {
    this.world.resetWorld()
    this.entities.clear()
    this.primitives.clear()
  }

  // version: '1.21.4', or a Bedrock one with its edition prefix ('bedrock_1.26.51')
  // options: what the version alone does not say (Bedrock: blockHashes, see world.js)
  setVersion (version, options = {}) {
    const assetsVersion = getVersion(version)
    if (assetsVersion === null) {
      const msg = `${version} is not supported`
      window.alert(msg)
      console.log(msg)
      return false
    }
    console.log(`Using version: ${version} (assets: ${assetsVersion})`)
    this.version = version
    this.world.setVersion(version, assetsVersion, options)
    this.entities.setVersion(assetsVersion)
    this.primitives.clear()
    return true
  }

  addColumn (x, z, chunk) {
    this.world.addColumn(x, z, chunk)
  }

  removeColumn (x, z) {
    this.world.removeColumn(x, z)
  }

  setBlockStateId (pos, stateId, layer) {
    this.world.setBlockStateId(pos, stateId, layer)
  }

  setBlockEntity (pos, tag) {
    this.world.setBlockEntity(pos, tag)
  }

  updateEntity (e) {
    this.entities.update(e)
  }

  updatePrimitive (p) {
    this.primitives.update(p)
  }

  // Bedrock: a particle effect of the version's packs by its identifier, at a position ({ x, y, z }); options: its
  // variables (as the server gives them), direction
  spawnParticle (name, position, options = {}) {
    return this.entities.spawnParticle(name, position, options)
  }

  setFirstPersonCamera (pos, yaw, pitch) {
    if (pos) {
      let y = pos.y + this.playerHeight
      if (this.isSneaking) y -= 0.3
      new TWEEN.Tween(this.camera.position).to({ x: pos.x, y, z: pos.z }, 50).start()
    }
    this.camera.rotation.set(pitch, yaw, 0, 'ZYX')
  }

  listen (emitter) {
    emitter.on('entity', (e) => {
      this.updateEntity(e)
    })

    emitter.on('primitive', (p) => {
      this.updatePrimitive(p)
    })

    emitter.on('loadChunk', ({ x, z, chunk }) => {
      this.addColumn(x, z, chunk)
    })

    emitter.on('unloadChunk', ({ x, z }) => {
      this.removeColumn(x, z)
    })

    emitter.on('blockUpdate', ({ pos, stateId, layer }) => {
      this.setBlockStateId(new Vec3(pos.x, pos.y, pos.z), stateId, layer)
    })

    emitter.on('blockEntity', ({ pos, tag }) => {
      this.setBlockEntity(new Vec3(pos.x, pos.y, pos.z), tag)
    })

    emitter.on('particle', ({ name, pos, variables }) => {
      this.spawnParticle(name, pos, { variables })
    })

    this.domElement.addEventListener('pointerdown', (evt) => {
      const raycaster = new THREE.Raycaster()
      const mouse = new THREE.Vector2()
      mouse.x = (evt.clientX / this.domElement.clientWidth) * 2 - 1
      mouse.y = -(evt.clientY / this.domElement.clientHeight) * 2 + 1
      raycaster.setFromCamera(mouse, this.camera)
      const ray = raycaster.ray
      emitter.emit('mouseClick', { origin: ray.origin, direction: ray.direction, button: evt.button })
    })
  }

  update () {
    TWEEN.update()
    this.world.update()
    this.entities.animate(this.camera)
  }

  async waitForChunksToRender () {
    await this.world.waitForChunksToRender()
  }
}

module.exports = { Viewer }
