// One end of a connection whose packets go over a MessagePort: those queued in one turn of the event loop leave
// together as one batch, the game's batch (each packet's bytes with its length before it: bedrock-protocol's Framer),
// without RakNet, encryption or compression, its buffer handed over to the other end (transferred, not copied).
// Packets arriving are read in their order, one 'packet' event each.
//
// Besides batches (ArrayBuffers) a port carries a few plain objects of the connection itself: { t: 'close', reason }.
const { EventEmitter } = require('events')
const { Framer } = require('bedrock-protocol/src/transforms/framer')

// per packet name: how many and their bytes
function count (table, name, bytes) {
  const entry = table[name] ?? (table[name] = { count: 0, bytes: 0 })
  entry.count++
  entry.bytes += bytes
}

class PacketChannel extends EventEmitter {
  // port: a MessagePort (a browser's, or Node's worker_threads one); codec: createCodec() of the version
  constructor (port, codec) {
    super()
    this.port = port
    this.codec = codec
    this.pending = []
    this.closed = false
    this.stats = { sent: {}, received: {}, batchesSent: 0, batchesReceived: 0, bytesSent: 0, bytesReceived: 0, decodeErrors: 0 }
    port.onmessage = event => this.receive(event.data)
  }

  // writes a packet now (so that a packet the schema cannot take fails here), and sends it with the turn's others
  queue (name, params) {
    if (this.closed) return
    const buffer = this.codec.encode(name, params)
    count(this.stats.sent, name, buffer.length)
    this.pending.push(buffer)
    if (this.pending.length === 1) queueMicrotask(() => this.flush())
  }

  flush () {
    if (!this.pending.length || this.closed) return
    const framer = new Framer({ features: {} })
    for (const buffer of this.pending) framer.addEncodedPacket(buffer)
    this.pending = []
    // (a Buffer may be a slice of a pool other Buffers share: the batch goes in an ArrayBuffer of its own)
    const batch = new Uint8Array(framer.getBuffer())
    this.stats.batchesSent++
    this.stats.bytesSent += batch.length
    this.port.postMessage(batch.buffer, [batch.buffer])
  }

  receive (data) {
    if (this.closed) return
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
      if (data?.t === 'close') this.close(data.reason, false)
      return
    }
    const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    this.stats.batchesReceived++
    this.stats.bytesReceived += bytes.length
    for (const packet of Framer.getPackets(bytes)) {
      let decoded
      try {
        decoded = this.codec.decode(packet)
      } catch (err) {
        // one packet the schema cannot read: the batch's others still are
        this.stats.decodeErrors++
        this.emit('decodeError', err, packet)
        continue
      }
      count(this.stats.received, decoded.name, packet.length)
      this.emit('packet', decoded.name, decoded.params)
      if (this.closed) return
    }
  }

  // ends the connection, telling the other end (unless it told us)
  close (reason = 'closed', tell = true) {
    if (this.closed) return
    this.flush()
    this.closed = true
    if (tell) this.port.postMessage({ t: 'close', reason })
    this.port.onmessage = null
    // (a turn later: what was posted is on its way)
    setTimeout(() => this.port.close?.(), 0)
    this.emit('close', reason)
  }
}

module.exports = { PacketChannel }
