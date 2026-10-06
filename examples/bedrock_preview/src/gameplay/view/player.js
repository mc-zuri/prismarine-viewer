// The player's model, seen in third person and the walk view (bedrock-demo
// packages/bedrock-client-viewer/web/three/player.ts): the version's Bedrock player (the pack's Steve), placed every
// frame where the camera puts the player, turned to its look with its head tilted, its body turning after it; its pack
// animations walk, sneak, sprint and swim it by the engine's state of the player, and it holds the item in hand.
const RADIANS = Math.PI / 180

class PlayerModel {
  constructor (viewer) {
    this.viewer = viewer
    this.assets = null
    this.model = undefined
    this.last = undefined
    this.swung = false
  }

  // The version's Bedrock entities: the model is made again with them
  use (assets) {
    if (assets === this.assets) return
    this.assets = assets
    this.unmake()
  }

  // The arm swings
  swing () {
    this.swung = true
  }

  // feet; Bedrock degrees (yaw 0 faces +z, pitch positive looks down); the engine's player (its Bedrock state: the
  // pose); the item in hand, by name
  place (feet, yaw, pitch, visible, player, held, now) {
    const seconds = this.last === undefined ? 0 : (now - this.last) / 1000
    this.last = now
    if (!this.model) {
      if (!this.assets?.has('minecraft:player')) return
      this.model = this.assets.player(null)
      this.viewer.scene.add(this.model.object)
    }
    const model = this.model
    model.object.visible = visible
    if (!visible) return
    model.object.position.set(feet.x, feet.y, feet.z)
    // the model faces -z unturned; its body turns within its look
    model.object.rotation.y = Math.PI - yaw * RADIANS
    const state = player.bedrock ?? {}
    const flags = ['sneaking', 'sprinting', 'swimming', 'crawling'].filter(flag => state[flag])
    model.setState({ metadata: { flags: Object.fromEntries(flags.map(flag => [flag, true])) }, held: held || undefined, equipment: held ? { mainhand: held } : {} })
    model.setMotion({ position: feet, yaw, headYaw: yaw, pitch, onGround: !!player.onGround, inWater: !!player.isInWater, inLava: !!player.isInLava })
    model.setCamera(this.viewer.camera.position)
    if (this.swung) model.swing()
    this.swung = false
    model.update(seconds)
  }

  unmake () {
    if (!this.model) return
    this.viewer.scene.remove(this.model.object)
    this.model.dispose()
    this.model = undefined
  }

  dispose () {
    this.unmake()
  }
}

module.exports = { PlayerModel }
