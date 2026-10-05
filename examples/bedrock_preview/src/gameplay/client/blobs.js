// The client's chunk blob cache: blobs by hash (what a section or a column's biomes encode to), those it asked the
// server for and has not received yet, and who waits for them. The game keeps it on disk; the page keeps one for as
// long as it is open, so a player who joins again finds the blobs of the world it saw (bedrock-demo
// packages/bedrock-client/src/world/blob-store.ts).
//
// Keys are a hash's decimal digits: prismarine-chunk looks blobs up with bigints on some versions and with their digits
// on others, and the reader gives protodef's [hi, lo], whose string is the digits too.
const { hashKey } = require('../protocol/schema')

class BlobStore extends Map {
  constructor () {
    super()
    this.pending = new Map()
    this.waiters = []
  }

  set (key, value) {
    const name = hashKey(key)
    super.set(name, value)
    for (const waiter of [...(this.waiters ?? [])]) {
      waiter.outstanding.delete(name)
      if (waiter.outstanding.size === 0) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        waiter.done()
      }
    }
    return this
  }

  get (key) {
    return super.get(hashKey(key))
  }

  has (key) {
    return super.has(hashKey(key))
  }

  // a blob asked for (client_cache_blob_status): what it holds, until its bytes arrive
  addPending (hash, entry) {
    this.pending.set(hashKey(hash), entry)
  }

  // a blob of client_cache_miss_response; false when it was not asked for
  resolvePending (hash, buffer) {
    const name = hashKey(hash)
    const entry = this.pending.get(name)
    if (!entry) return false
    this.pending.delete(name)
    entry.buffer = buffer
    this.set(name, entry)
    return true
  }

  // calls `done` once every one of `hashes` is stored
  once (hashes, done) {
    const outstanding = new Set(hashes.map(hashKey).filter(name => !super.has(name)))
    if (outstanding.size) this.waiters.push({ outstanding, done })
    else done()
  }

  // forgets what a connection asked for (its waiters decode into columns that are gone): the blobs stay
  forgetPending () {
    this.pending.clear()
    this.waiters = []
  }
}

module.exports = { BlobStore }
