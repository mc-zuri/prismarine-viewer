// The columns a connection is sent, as the player moves: those within its radius, nearest first, a few a tick; a
// column the player left far behind is forgotten (the client unloads it), and sent again when it comes back.
//
// A column goes as each version sends one (bedrock-demo packages/bedrock-server/src/index.ts sendColumn, subChunks):
// its sections in level_chunk before 1.18, from 1.18 only its biomes there and the sections each in answer to the
// client's subchunk_request; with the blob cache on, a section or the biomes as the hash of a blob the client may have
// already (client_cache_blob_status says which it lacks, client_cache_miss_response sends those).
const { Vec3 } = require('vec3')
const { fieldType, hashKey } = require('../protocol/schema')

// How a version's level_chunk carries the cache's hashes and the highest section of a column sent in request mode
function levelChunkShape (types) {
  return {
    // up to 1.26.30 the hashes are a switch on cache_enabled ({ hashes }), from 1.26.40 a plain list
    wrappedBlobs: fieldType(types, 'packet_level_chunk', 'blobs')?.[0] === 'switch',
    // from 1.26.40 the request mode is the presence of the highest section
    optionalHighest: fieldType(types, 'packet_level_chunk', 'highest_subchunk_count')?.[0] === 'option'
  }
}

// The index (from the column's lowest) of its highest section that holds something
function highestSection (column) {
  for (let y = column.maxCY - 1; y >= column.minCY; y--) if (column.getSectionAtIndex(y)) return y - column.minCY
  return 0
}

class ChunkStreamer {
  // connection: what it sends with (queue) and to whom (cache, radius); server: the world, the blob store, the version
  constructor (connection, server) {
    this.connection = connection
    this.server = server
    this.shape = levelChunkShape(server.codecTypes)
    this.requestMode = server.registry.version['>=']('1.18.0')
    this.center = null
    this.radius = 0
    // 'x,z' of the columns sent and not forgotten since; those waiting their turn, nearest first
    this.sent = new Set()
    this.waiting = []
    // the client's chunk packets go out in their order, each after the one before is written
    this.chain = Promise.resolve()
    // counts the resets: a column planned before one is not sent after it
    this.generation = 0
  }

  // the player went to another dimension: nothing of the one before is sent, and its columns are planned anew
  reset () {
    this.generation++
    this.sent.clear()
    this.waiting = []
    this.center = null
  }

  // the radius the client sees (chunks), and the chunk it stands in
  setRadius (radius) {
    this.radius = radius
    if (this.center) this.plan()
  }

  // the player's feet: when it moves into another chunk, the columns around it are planned again
  recenter (pos) {
    const center = { x: Math.floor(pos.x) >> 4, z: Math.floor(pos.z) >> 4 }
    if (this.center && center.x === this.center.x && center.z === this.center.z) return
    this.center = center
    this.connection.queue('network_chunk_publisher_update', {
      coordinates: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
      radius: this.radius * 16,
      saved_chunks: []
    })
    if (this.radius) this.plan()
  }

  plan () {
    const { center, radius } = this
    // what the client keeps (network_chunk_publisher_update: within the radius and a chunk) it need not be sent again
    for (const key of this.sent) {
      const [x, z] = key.split(',').map(Number)
      if (Math.max(Math.abs(x - center.x), Math.abs(z - center.z)) > radius + 1) this.sent.delete(key)
    }
    const around = []
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        if (x * x + z * z <= radius * radius && !this.sent.has(`${center.x + x},${center.z + z}`)) around.push({ x: center.x + x, z: center.z + z, d: x * x + z * z })
      }
    }
    this.waiting = around.sort((a, b) => a.d - b.d)
  }

  // sends the next few columns waiting (budget: how many a tick)
  tick (budget) {
    for (let i = 0; i < budget && this.waiting.length; i++) {
      const { x, z } = this.waiting.shift()
      const key = `${x},${z}`
      if (this.sent.has(key)) continue
      this.sent.add(key)
      const { generation } = this
      const dimension = this.connection.dimension
      this.then(() => generation === this.generation && this.sendColumn(x, z, dimension))
    }
  }

  // whether every column waiting is sent
  get settled () {
    return this.waiting.length === 0
  }

  then (work) {
    this.chain = this.chain.then(work).catch(err => this.server.log(`chunks: ${err.stack ?? err}`))
    return this.chain
  }

  async sendColumn (x, z, dimension) {
    const { server, connection, shape } = this
    const column = server.column(x, z, dimension)
    const cache = connection.cache
    const packet = { x, z, dimension, cache_enabled: cache }
    let hashes = []
    if (cache) {
      const encoded = await column.networkEncode(server.blobStore)
      hashes = encoded.blobs.map(blob => blob.hash)
      packet.payload = encoded.payload
    } else {
      packet.payload = await column.networkEncodeNoCache()
    }
    packet.blobs = shape.wrappedBlobs ? { hashes } : hashes
    const v = server.registry.version
    if (v['<']('1.18.0')) {
      packet.sub_chunk_count = cache ? hashes.length - 1 : column.sections.length
    } else if (v['<']('1.18.11')) {
      packet.sub_chunk_count = -1
    } else if (shape.optionalHighest) {
      packet.sub_chunk_count = 0
      packet.highest_subchunk_count = highestSection(column)
    } else {
      packet.sub_chunk_count = -2
      packet.highest_subchunk_count = highestSection(column)
    }
    connection.queue('level_chunk', packet)
    if (dimension === connection.dimension) connection.columnSent(x, z)
  }

  // a section: its result, its bytes, and with the cache its blob's hash
  async subChunk (cx, sy, cz, dimension) {
    const { server, connection } = this
    const column = server.column(cx, cz, dimension)
    if (sy < column.minCY || sy >= column.maxCY) return { result: 'y_index_out_of_bounds', payload: Buffer.alloc(0), blob_id: 0n }
    if (!column.getSectionAtIndex(sy)) {
      if (server.allAir) return { result: 'success_all_air', payload: Buffer.alloc(0), blob_id: 0n }
      // (1.18.0 has no success_all_air: an empty section is sent, a section of air)
      column.setBlockStateId(new Vec3(0, sy * 16, 0), server.registry.blocksByName.air.defaultState)
    }
    if (!connection.cache) return { result: 'success', payload: await column.networkEncodeSubChunkNoCache(sy), blob_id: 0n }
    const [hash, payload] = await column.networkEncodeSubChunk(sy, server.blobStore)
    return { result: 'success', payload, blob_id: hash }
  }

  subchunkRequest (packet) {
    return this.then(async () => {
      const { connection } = this
      const cache = connection.cache
      // (the dimension the request names: a request of the dimension before a change may still come)
      const dimension = packet.dimension ?? connection.dimension
      if (!packet.requests) {
        // 1.18.0: one section a request
        const entry = await this.subChunk(packet.x, packet.y, packet.z, dimension)
        connection.queue('subchunk', { cache_enabled: cache, dimension, x: packet.x, y: packet.y, z: packet.z, data: entry.payload, request_result: entry.result, heightmap_type: 'no_data', blob_id: entry.blob_id })
        if (dimension === connection.dimension) connection.sectionSent(packet.x, packet.y, packet.z)
        return
      }
      const entries = []
      const sections = []
      for (const request of packet.requests) {
        // (named x, y, z from 1.26.30)
        const dx = request.dx ?? request.x
        const dy = request.dy ?? request.y
        const dz = request.dz ?? request.z
        const at = { x: packet.origin.x + dx, y: packet.origin.y + dy, z: packet.origin.z + dz }
        const entry = await this.subChunk(at.x, at.y, at.z, dimension)
        sections.push(at)
        const empty = entry.result !== 'success'
        entries.push({
          dx,
          dy,
          dz,
          result: entry.result,
          // (options from 1.26.40: a section all air has no bytes, and none has a hash without the cache)
          payload: empty && this.optionalPayload ? undefined : entry.payload,
          blob_id: cache ? entry.blob_id : undefined,
          heightmap_type: 'no_data',
          render_heightmap_type: 'no_data'
        })
      }
      connection.queue('subchunk', { cache_enabled: cache, dimension, origin: packet.origin, entries })
      if (dimension === connection.dimension) for (const at of sections) connection.sectionSent(at.x, at.y, at.z)
    })
  }

  get optionalPayload () {
    return this.server.optionalSubchunkPayload
  }

  // the blobs the client lacks, of those this server sent
  blobStatus (packet) {
    const { server, connection } = this
    const found = (packet.missing ?? []).filter(hash => server.blobs.has(hashKey(hash)))
    if (found.length < (packet.missing ?? []).length) server.log(`the client asked for ${packet.missing.length - found.length} blobs never sent`)
    if (found.length) connection.queue('client_cache_miss_response', { blobs: found.map(hash => ({ hash, payload: server.blobs.get(hashKey(hash)).buffer })) })
  }
}

module.exports = { ChunkStreamer, levelChunkShape, highestSection }
