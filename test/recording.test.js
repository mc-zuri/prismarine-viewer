/* eslint-env jest */
// The recordings the replay page plays (examples/bedrock_preview/recording.js): their container
const { records } = require('../examples/bedrock_preview/recording')

const varint = n => {
  const out = []
  do {
    out.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0))
    n >>>= 7
  } while (n)
  return Buffer.from(out)
}
const head = (kind, ns) => {
  const b = Buffer.alloc(9)
  b[0] = kind.charCodeAt(0)
  b.writeBigInt64LE(BigInt(ns), 1)
  return b
}

test('a recording is its version, then log lines and packets in order, each with its time', () => {
  const version = Buffer.from('1.26.51')
  const log = Buffer.from(JSON.stringify({ message: 'started' }))
  const packet = Buffer.concat([varint(0x1b), Buffer.from([1, 2, 3])])
  const length = Buffer.alloc(4)
  length.writeUInt32LE(packet.length)
  const file = Buffer.concat([varint(version.length), version, head('L', 1000), varint(log.length), log, head('C', 2500), length, packet])
  const read = records(file)
  expect(read.version).toBe('1.26.51')
  expect(read.records.map(r => [r.kind, r.time])).toEqual([['L', 1000], ['C', 2500]])
  expect(read.records[0].log).toEqual({ message: 'started' })
  expect([...read.records[1].buffer]).toEqual([0x1b, 1, 2, 3])
})
