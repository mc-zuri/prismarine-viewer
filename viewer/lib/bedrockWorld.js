// The Bedrock side of the mesher's World: a Bedrock registry and chunk columns, and per block state a view carrying
// what models.js reads: name, properties, type, liquid depth (metadata), transparent and isCube, and from the assets
// how the game draws the block (blocks_render.json: tint, liquid, connect).
//
// Since 1.19.80 a server may send block network hashes as state ids instead of runtime indexes; its start_game packet
// says which (options.blockHashes). Without that (no bot: a world read from disk) the first palette decides: a runtime
// id palette entry names the block the registry has at that index.
const prismarineRegistry = require('prismarine-registry')
const Chunks = require('prismarine-chunk')

class BedrockBlocks {
  constructor (version, { blockHashes } = {}) {
    this.registry = prismarineRegistry(version)
    this.Chunk = Chunks(this.registry)
    this.hashed = null // unknown until start_game says, or the first column does
    this.render = {}
    this.views = new Map()
    if (blockHashes !== undefined) this.useHashes(blockHashes)
  }

  // with the first column's parsed JSON
  detectIds (column) {
    if (this.hashed !== null) return
    for (const section of column.sections ?? []) {
      for (const layer of section?.palette ?? []) {
        for (const entry of layer ?? []) {
          if (entry?.name === undefined || entry.stateId === undefined) continue
          const name = entry.name.replace(/^minecraft:/, '')
          const byIndex = this.registry.blockStates?.[entry.stateId]
          this.useHashes(!(byIndex && byIndex.name === name))
          return
        }
      }
    }
  }

  useHashes (hashed) {
    this.hashed = hashed
    if (hashed && this.registry.supportFeature('blockHashes')) {
      this.registry.handleStartGame({ block_network_ids_are_hashes: true, itemstates: [] })
    }
    this.indexStates()
  }

  indexStates () {
    this.propsByState = new Map()
    this.registry.blockStates.forEach((s, i) => {
      const props = {}
      for (const [k, v] of Object.entries(s.states ?? {})) props[k] = String(v.value)
      this.propsByState.set(s.stateId ?? i, props)
    })
    this.views.clear()
  }

  // blocks_render.json's blocks: { name: { layer, tint, cube, liquid, connect, defaults } }
  setRender (blocks) {
    this.render = blocks ?? {}
    this.views.clear()
  }

  view (stateId) {
    let v = this.views.get(stateId)
    if (v) return v
    if (!this.propsByState) this.indexStates()
    const block = this.registry.blocksByStateId[stateId] ?? this.registry.blocksByName.air
    const name = block.name
    const props = this.propsByState.get(stateId) ?? {}
    const render = this.render[name] ?? {}
    // flowing water is water, as far as the surface it makes goes
    const liquid = render.liquid ?? (/^(flowing_)?(water|lava)$/.test(name) ? name.replace('flowing_', '') : undefined)
    v = {
      stateId,
      name,
      type: liquid ? this.registry.blocksByName[liquid]?.id ?? block.id : block.id,
      metadata: liquid ? +(props.liquid_depth ?? 0) : 0,
      // drawn whole and opaque, so that the faces against it are hidden
      transparent: render.layer !== undefined || !render.cube,
      isCube: !!render.cube,
      material: block.material,
      liquid,
      tint: render.tint,
      connect: render.connect,
      // what its block entity says when it says nothing (connect: banner, skull, chest)
      defaults: render.defaults,
      getProperties: () => props
    }
    this.views.set(stateId, v)
    return v
  }

  airStateId () {
    return this.registry.blocksByName.air.defaultState
  }
}

module.exports = { BedrockBlocks }
