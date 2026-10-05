// A version's packets, written and read as bedrock-protocol writes and reads them: minecraft-data's protocol of the
// version compiled with bedrock-protocol's own datatypes (src/datatypes/compiler-minecraft), as its createProtocol
// (src/transforms/serializer.js) does, without the files that module reads in Node (a precompiled protocol, a dump of a
// packet it cannot read). Compiled once a version, for both directions.
//
// A packet is completed from the schema before it is written (schema.js fill), so callers name what they mean in any
// version. Item stacks are read and written by what the shield's item id is (an item that is a shield has an extra
// field): the id comes with start_game's or item_registry's item states, and is set as the packet that has it is
// written or read, before the next one of the batch is (bedrock-protocol src/connection.js does the same).
const { ProtoDefCompiler } = require('protodef').Compiler
const { fill, hasPacket } = require('./schema')

const compiled = new Map()

// The compiled protocol of a version ('1.26.51') and its types; minecraft-data of the version must be loaded
function compile (version) {
  if (!compiled.has(version)) {
    const { types } = require('minecraft-data')('bedrock_' + version).protocol
    const compiler = new ProtoDefCompiler()
    compiler.addTypesToCompile(types)
    compiler.addTypes(require('bedrock-protocol/src/datatypes/compiler-minecraft'))
    compiled.set(version, { protodef: compiler.compileProtoDefSync(), types })
  }
  return compiled.get(version)
}

// The shield's runtime id among item states, if they have it
const shieldOf = itemstates => itemstates?.find(item => item.name === 'minecraft:shield')?.runtime_id

// verify: write every packet read back again and count those that come out otherwise. strict: fill() throws where a
// field has no default or a name is not the mapper's.
function createCodec (version, { verify = false, strict = false } = {}) {
  const { protodef, types } = compile(version)
  const variables = {}
  const stats = { verifyMismatches: 0 }

  function observe (name, params) {
    if (name !== 'start_game' && name !== 'item_registry') return
    const shield = shieldOf(params.itemstates)
    if (shield === undefined) return
    variables.ShieldItemID = shield
    protodef.setVariable('ShieldItemID', shield)
  }

  return {
    version,
    types,
    variables,
    stats,
    hasPacket: name => hasPacket(types, name),
    // params of a type of the schema ('packet_text', 'Item') completed
    fill: (typeName, params) => fill(types, typeName, params, { variables, strict }),
    // the packet's bytes (its id and fields), and the params written
    encode (name, params) {
      const filled = fill(types, `packet_${name}`, params, { variables, strict })
      const buffer = protodef.createPacketBuffer('mcpe_packet', { name, params: filled })
      observe(name, filled)
      return buffer
    },
    // { name, params } of a packet's bytes
    decode (buffer) {
      const { data } = protodef.parsePacketBuffer('mcpe_packet', buffer)
      observe(data.name, data.params)
      if (verify && !protodef.createPacketBuffer('mcpe_packet', data).equals(buffer)) stats.verifyMismatches++
      return data
    }
  }
}

module.exports = { createCodec, compile }
