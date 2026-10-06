// The columns the client is sent, read as each version sends them (bedrock-demo packages/bedrock-client/src/handlers:
// level_chunk.ts, subchunk.ts, client_cache_miss_response.ts; world/chunks.ts): before 1.18 a column with its
// sections, from 1.18 its biomes, the client then asking for its sections (subchunk_request); with the blob cache a
// section or the biomes as the hash of a blob, the client telling the server which it lacks.
//
// A column is in the world (loaded) once something of it is read, and again as each of its sections arrives. A block
// update for a section still on its way is held, and applied once the section has arrived (it would be overwritten).
const { BlobEntry, BlobType } = require('prismarine-chunk')

const key = (x, z) => `${x},${z}`

// The section offsets a request names, under the names of every version (dx/dy/dz before 1.26.30, x/y/z since)
const offset = y => ({ x: 0, y, z: 0, dx: 0, dy: y, dz: 0 })

class ChunkStore {
  constructor (client) {
    this.client = client
    this.columns = new Map()
    this.loaded = new Set()
    // the sections asked for and not arrived, by column
    this.requested = new Map()
    // block updates held for a section on its way: 'x,y,z' of the section -> [{ pos, stateId, layer }]
    this.held = new Map()
  }

  // the column the server is sending, made empty at first
  column (x, z) {
    let column = this.columns.get(key(x, z))
    if (!column) {
      column = new this.client.Chunk({ x, z })
      this.columns.set(key(x, z), column)
    }
    return column
  }

  // a column in the world, or undefined
  loadedColumn (x, z) {
    return this.loaded.has(key(x, z)) ? this.columns.get(key(x, z)) : undefined
  }

  setLoaded (column) {
    this.loaded.add(key(column.x, column.z))
    this.client.stats.columns = this.loaded.size
    this.client.emit('column', column)
  }

  // counts a section read, and the runtime ids in it the registry does not know (they read as air)
  inspect (section) {
    if (!section) return
    const { stats } = this.client
    stats.sections++
    for (const layer of section.palette ?? []) {
      for (const entry of layer ?? []) {
        if (entry?.runtimeId !== undefined) stats.unknownRuntimeIds[entry.runtimeId] = (stats.unknownRuntimeIds[entry.runtimeId] ?? 0) + 1
      }
    }
  }

  request (x, z, sections) {
    const pending = this.requested.get(key(x, z)) ?? new Set()
    for (const y of sections) pending.add(y)
    this.requested.set(key(x, z), pending)
  }

  arrived (x, sectionY, z) {
    this.requested.get(key(x, z))?.delete(sectionY)
    const held = this.held.get(`${x},${sectionY},${z}`)
    if (!held) return
    this.held.delete(`${x},${sectionY},${z}`)
    for (const update of held) this.setBlock(update.pos, update.stateId, update.layer)
  }

  // whether the section of a block was asked for and has not arrived (the client stands on it as solid meanwhile)
  pending (x, y, z) {
    return !!this.requested.get(key(x >> 4, z >> 4))?.has(y >> 4)
  }

  // a block the server changed, or the client predicts: held while its section is on its way
  setBlock (pos, stateId, layer = 0) {
    const cx = Math.floor(pos.x) >> 4
    const cz = Math.floor(pos.z) >> 4
    const column = this.loadedColumn(cx, cz)
    if (!column) return false
    if (this.pending(pos.x, pos.y, pos.z)) {
      const name = `${cx},${pos.y >> 4},${cz}`
      if (!this.held.has(name)) this.held.set(name, [])
      this.held.get(name).push({ pos, stateId, layer })
      return false
    }
    const at = { x: pos.x & 15, y: pos.y, z: pos.z & 15, l: layer }
    const before = column.getBlockStateId(at)
    column.setBlockStateId(at, stateId)
    this.client.emit('blockUpdate', pos, stateId, layer, before)
    // a block replaced takes its block entity with it (a bed, a chest broken)
    if (layer === 0 && column.getBlockEntity(at)) {
      column.removeBlockEntity(at)
      this.client.emit('blockEntity', pos, undefined)
    }
    return true
  }

  getBlockStateId (pos, layer = 0) {
    const column = this.loadedColumn(Math.floor(pos.x) >> 4, Math.floor(pos.z) >> 4)
    return column?.getBlockStateId({ x: Math.floor(pos.x) & 15, y: Math.floor(pos.y), z: Math.floor(pos.z) & 15, l: layer })
  }

  // network_chunk_publisher_update: what the client keeps (the columns within the radius and one more)
  keepAround (center, radius) {
    for (const [name, column] of this.columns) {
      if (Math.max(Math.abs(column.x - center.x), Math.abs(column.z - center.z)) <= radius) continue
      this.unload(name, column.x, column.z)
    }
  }

  // every column goes (another dimension)
  clear () {
    for (const [name, column] of [...this.columns]) this.unload(name, column.x, column.z)
    this.held.clear()
  }

  unload (name, x, z) {
    this.columns.delete(name)
    this.requested.delete(name)
    for (const section of [...this.held.keys()]) if (section.startsWith(`${x},`) && section.endsWith(`,${z}`)) this.held.delete(section)
    if (!this.loaded.delete(name)) return
    this.client.stats.columns = this.loaded.size
    this.client.emit('unloadColumn', x, z)
  }

  // ---- reading ---------------------------------------------------------------------------------------------------

  // the blob hashes a column names: a plain list from 1.26.40, inside `hashes` before
  hashes (packet) {
    return packet.blobs?.hashes ?? packet.blobs ?? []
  }

  blobStatus (missing, have) {
    const { stats, blobStore } = this.client
    stats.blobs.misses += missing.length
    stats.blobs.pending = blobStore.pending.size
    // (the counts are written before 1.26.30 only: the schema has them, or not)
    this.client.queue('client_cache_blob_status', { misses: missing.length, haves: have.length, missing, have })
  }

  async levelChunk (packet) {
    const { client } = this
    const { blobStore } = client
    const column = this.column(packet.x, packet.z)
    // a new column of one the client had: what it had of it goes
    if (this.loaded.has(key(packet.x, packet.z))) {
      this.unload(key(packet.x, packet.z), packet.x, packet.z)
      return this.levelChunk(packet)
    }
    // from 1.26.40 the request mode is the presence of highest_subchunk_count, before it a negative sub_chunk_count
    // (1.17.40's schema has the request mode, but its columns carry their sections)
    const requestMode = client.registry.version['>=']('1.18.0') && (packet.sub_chunk_count < 0 || packet.highest_subchunk_count != null)
    const loaded = () => {
      if (!requestMode) column.sections.forEach(section => this.inspect(section))
      this.setLoaded(column)
    }
    if (!packet.cache_enabled) {
      column.networkDecodeNoCache(packet.payload, packet.sub_chunk_count)
      loaded()
    } else {
      const hashes = this.hashes(packet)
      const misses = await column.networkDecode(hashes, blobStore, packet.payload)
      client.stats.blobs.hits += hashes.length - misses.length
      // every cached column is answered with what the client has and lacks
      this.blobStatus(misses, hashes.filter(hash => !misses.includes(hash)))
      if (!misses.length) {
        loaded()
      } else {
        // in the request mode a column's only blob is its biomes; else its last one is
        const biomes = hashes[hashes.length - 1]
        for (const miss of misses) {
          const type = requestMode || miss === biomes ? BlobType.Biomes : BlobType.ChunkSection
          blobStore.addPending(miss, new BlobEntry({ type, x: packet.x, z: packet.z }))
        }
        blobStore.once(misses, () => {
          Promise.resolve(column.networkDecode(hashes, blobStore, packet.payload)).then(left => {
            if (left.length) throw new Error(`${left.length} blobs still missing`)
            if (this.columns.get(key(packet.x, packet.z)) === column) loaded()
          }).catch(err => client.problem(`level_chunk ${packet.x},${packet.z} from the cache: ${err.message}`))
        })
      }
    }
    if (requestMode) this.requestSections(packet, column)
  }

  requestSections (packet, column) {
    const { client } = this
    const count = packet.highest_subchunk_count != null ? packet.highest_subchunk_count + 1 : column.maxCY - column.minCY
    const sections = Array.from({ length: count }, (_, i) => column.minCY + i)
    this.request(packet.x, packet.z, sections)
    if (!client.registry.version['>=']('1.18.11')) {
      // 1.18.0: one request a section
      for (const y of sections) client.queue('subchunk_request', { x: packet.x, y, z: packet.z, dimension: client.dimension })
      return
    }
    client.queue('subchunk_request', { origin: { x: packet.x, y: 0, z: packet.z }, requests: sections.map(offset), dimension: client.dimension })
  }

  async subChunk (packet) {
    const { client } = this
    const { blobStore } = client
    const missing = []
    const have = []
    const touched = new Set()
    const sections = packet.entries && packet.origin
      ? packet.entries.map(entry => ({ ...entry, x: packet.origin.x + entry.dx, y: packet.origin.y + entry.dy, z: packet.origin.z + entry.dz }))
      : [{ x: packet.x, y: packet.y, z: packet.z, result: packet.request_result, payload: packet.data, blob_id: packet.blob_id }]
    for (const section of sections) {
      const column = this.columns.get(key(section.x, section.z))
      if (!column) continue
      if (section.result !== 'success') {
        this.arrived(section.x, section.y, section.z)
        touched.add(column)
        continue
      }
      if (packet.cache_enabled) {
        const misses = await column.networkDecodeSubChunk([section.blob_id], blobStore, section.payload)
        if (misses.length) {
          for (const miss of misses) blobStore.addPending(miss, new BlobEntry({ type: BlobType.ChunkSection, x: section.x, y: section.y, z: section.z }))
          missing.push(...misses)
          // (the payload, the block entities, is read already)
          blobStore.once(misses, () => {
            Promise.resolve(column.networkDecodeSubChunk(misses, blobStore)).then(left => {
              if (left.length) throw new Error(`${left.length} blobs still missing`)
              if (this.columns.get(key(section.x, section.z)) !== column) return
              this.inspect(column.getSectionAtIndex(section.y))
              this.arrived(section.x, section.y, section.z)
              this.setLoaded(column)
            }).catch(err => client.problem(`subchunk ${section.x},${section.y},${section.z} from the cache: ${err.message}`))
          })
          continue
        }
        client.stats.blobs.hits++
        have.push(section.blob_id)
      } else {
        await column.networkDecodeSubChunkNoCache(section.y, section.payload)
      }
      this.inspect(column.getSectionAtIndex(section.y))
      this.arrived(section.x, section.y, section.z)
      touched.add(column)
    }
    if (missing.length || have.length) this.blobStatus(missing, have)
    for (const column of touched) this.setLoaded(column)
  }

  // the blobs the client said it lacks (two sections alike are one blob: it may come twice)
  missResponse (packet) {
    const { client } = this
    const received = []
    for (const { hash, payload } of packet.blobs) {
      if (client.blobStore.resolvePending(hash, payload)) {
        received.push(hash)
        client.stats.blobs.received++
      }
    }
    client.stats.blobs.pending = client.blobStore.pending.size
    if (received.length) client.queue('client_cache_blob_status', { misses: 0, haves: received.length, missing: [], have: received })
  }
}

module.exports = { ChunkStore }
