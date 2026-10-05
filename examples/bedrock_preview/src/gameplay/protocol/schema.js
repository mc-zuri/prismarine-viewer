// Packets completed from the schema of their version: minecraft-data's protocol, the types bedrock-protocol compiles
// its reader and writer from. Each version writes a packet in a shape of its own (a field added, renamed, widened, an
// item packed differently); the server and the client name what they mean, and fill() gives every field the schema has
// and they did not name its default (zero, false, '', an empty list, a mapper's first name), so that one call writes
// a packet in every version.
//
// It walks a type as protodef's compiler does (node_modules/protodef/src/datatypes/compiler-*.js): a container's
// anonymous container is inlined into it, an anonymous switch writes its branch from the container's own object; a
// switch compares the field it names, looked up from the innermost container outwards ('../' going out one, '.' into a
// field, '/name' a variable such as the shield's item id) against its keys converted as protodef converts them; a
// mapper writes a name (a number that is one of its keys becomes the name); a bitflags writes its named flags over its
// _value. Numbers are fitted to their field: a bigint where the schema writes 64 bits, a number where it writes fewer
// (bedrock-demo's packages/bedrock-client/src/schema.ts, fitted()).
//
// Keys the schema has no field for are kept: a caller may name a field under the names of several versions
// (player_position and 1.16.201's spawn), and the writer reads only the one its version has.

// the numeric types bedrock-protocol writes in 64 bits, and those it writes in fewer (floats among them)
const WIDE = new Set(['i64', 'u64', 'li64', 'lu64', 'varint64', 'zigzag64', 'varint128'])
const INTEGER = new Set(['i8', 'u8', 'i16', 'u16', 'li16', 'lu16', 'i32', 'u32', 'li32', 'lu32', 'varint', 'zigzag32', 'byterot'])
const FLOAT = new Set(['f32', 'lf32', 'f64', 'lf64'])
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const emptyNbt = () => ({ type: 'compound', name: '', value: {} })

// A 64-bit value as a bigint, from what the reader gives (a bigint, or protodef's [hi, lo] whose valueOf is one) or
// what a caller writes (a number, a numeric string)
function toBigInt (value) {
  if (typeof value === 'bigint') return value
  if (value === undefined || value === null) return 0n
  if (Array.isArray(value)) {
    const own = value.valueOf()
    if (typeof own === 'bigint') return own
    return (BigInt(value[0]) << 32n) | BigInt(value[1] >>> 0)
  }
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  return BigInt(value)
}

// A blob hash as the key of a blob store: its decimal digits (the reader gives lu64 as [hi, lo])
const hashKey = hash => toBigInt(hash).toString()

// How protodef's switch writes a key: a number, a boolean, a variable, or the string
function switchKey (key, variables) {
  if (key.startsWith('/')) return variables[key.slice(1)]
  if (key === 'true') return true
  if (key === 'false') return false
  if (!isNaN(key)) return Number(key)
  return key
}

// What a switch compares: `path` from the innermost container of `scopes` outwards, as protodef's getField
function resolve (path, scopes, variables) {
  if (path.startsWith('/')) return variables[path.slice(1)]
  const steps = path.split('/')
  let level = scopes.length - 1
  while (steps[0] === '..') {
    steps.shift()
    level--
  }
  const [name, ...members] = steps.join('.').split('.')
  let at
  for (let i = level; i >= 0; i--) {
    if (scopes[i] && typeof scopes[i] === 'object' && name in scopes[i]) {
      at = scopes[i][name]
      break
    }
  }
  for (const member of members) at = at?.[member]
  return at
}

// The mapper's names by their keys, as protodef's reader sanitizes them
function mappingsOf (mapper) {
  const out = new Map()
  for (const [key, name] of Object.entries(mapper.mappings)) {
    const k = /^0x[0-9a-f]+$/i.test(key) ? parseInt(key.slice(2), 16) : (isNaN(key) ? key : Number(key))
    let value = name
    if (!isNaN(value) && value !== '') value = Number(value)
    if (value === 'true') value = true
    if (value === 'false') value = false
    out.set(k, value)
  }
  return out
}

// A bitflags' flags: name -> bit (a bigint for a big one)
function flagBits ({ flags, shift, big }) {
  const out = {}
  const bit = n => big ? 1n << BigInt(n) : 2 ** n
  if (Array.isArray(flags)) flags.forEach((name, i) => { out[name] = bit(i) })
  else if (shift) for (const name in flags) out[name] = bit(flags[name])
  else for (const name in flags) out[name] = big ? BigInt(flags[name]) : flags[name]
  return out
}

function createFiller (types, { variables = {}, strict = false } = {}) {
  function fail (message) {
    if (strict) throw new Error(message)
  }

  function fillNative (name, value, where) {
    if (WIDE.has(name)) return toBigInt(value)
    if (INTEGER.has(name)) {
      if (value === undefined || value === null) return 0
      return typeof value === 'bigint' ? Number(value) : Math.trunc(Number(value))
    }
    if (FLOAT.has(name)) return value === undefined || value === null ? 0 : Number(value)
    switch (name) {
      case 'bool': return value === true || value === 1 || value === 1n || value === 'true'
      case 'void': return undefined
      case 'cstring': return String(value ?? '')
      case 'uuid': return value ?? ZERO_UUID
      case 'nbt': case 'lnbt': return value ?? emptyNbt()
      case 'nbtLoop': return value ?? []
      case 'restBuffer': return value ? Buffer.from(value) : Buffer.alloc(0)
    }
    if (value === undefined) fail(`${where}: no default for ${name}`)
    return value
  }

  function fillType (type, value, scopes, where) {
    if (typeof type === 'string') {
      const definition = types[type]
      if (definition === undefined || definition === 'native') return fillNative(type, value, where)
      return fillType(definition, value, scopes, `${where}<${type}>`)
    }
    const [kind, options] = type
    switch (kind) {
      case 'container': return fillContainer(options, value, scopes, where)
      case 'array': {
        const items = Array.isArray(value) ? value : []
        return items.map((item, i) => fillType(options.type, item, scopes, `${where}[${i}]`))
      }
      case 'count': return value
      case 'option': return value === undefined || value === null ? undefined : fillType(options, value, scopes, where)
      case 'switch': return fillType(branchOf(options, scopes, where), value, scopes, where)
      case 'mapper': return fillMapper(options, value, where)
      case 'bitflags': return fillBitflags(options, value, scopes, where)
      case 'encapsulated': return fillType(options.type, value, scopes, where)
      case 'pstring': return String(value ?? '')
      case 'buffer':
        if (value) return Buffer.from(value)
        return Buffer.alloc(typeof options.count === 'number' ? options.count : 0)
      case 'bitfield': {
        const out = { ...(value ?? {}) }
        for (const { name } of options) out[name] = Number(out[name] ?? 0)
        return out
      }
      case 'maybeIncompleteArray': return Array.isArray(value) ? value.map((item, i) => fillType(options.type, item, scopes, `${where}[${i}]`)) : []
      default:
        // (enum_size_based_on_values_len, entityMetadataLoop...: written from what they are given)
        if (value === undefined) fail(`${where}: no default for ${kind}`)
        return value
    }
  }

  // the type a switch writes, for the containers it is in
  function branchOf (options, scopes, where) {
    const compared = options.compareTo !== undefined ? resolve(options.compareTo, scopes, variables) : options.compareToValue
    for (const key in options.fields) {
      if (switchKey(key, variables) === compared) return options.fields[key]
    }
    return options.default ?? 'void'
  }

  function fillMapper (options, value, where) {
    const mappings = mappingsOf(options)
    const names = [...mappings.values()]
    if (value === undefined || value === null) return mappings.has(0) ? mappings.get(0) : names[0]
    if (names.includes(value)) return value
    // a number the game sends for a name
    const key = typeof value === 'bigint' ? Number(value) : (isNaN(value) ? value : Number(value))
    if (mappings.has(key)) return mappings.get(key)
    fail(`${where}: ${value} is none of ${names.join(', ')}`)
    return value
  }

  function fillBitflags (options, value, scopes, where) {
    const bits = flagBits(options)
    const zero = options.big ? 0n : 0
    if (value === undefined || value === null) return { _value: zero }
    if (typeof value !== 'object') return { _value: options.big ? toBigInt(value) : Number(value) }
    let flags = value._value === undefined ? zero : (options.big ? toBigInt(value._value) : Number(value._value))
    for (const name in bits) {
      if (!(name in value)) continue
      if (options.big) flags = value[name] ? flags | bits[name] : flags & ~bits[name]
      else flags = value[name] ? (flags | bits[name]) >>> 0 : (flags & ~bits[name]) >>> 0
    }
    return { ...value, _value: flags }
  }

  // a container's fields into `out`, the object the container writes from (an inlined one's is its parent's)
  function fillFields (fields, out, scopes, where) {
    for (const field of fields) {
      const [kind, options] = Array.isArray(field.type) ? field.type : []
      if (field.anon && kind === 'container') {
        fillFields(options, out, scopes, where)
      } else if (field.anon && kind === 'switch') {
        const branch = branchOf(options, scopes, where)
        const [branchKind, branchOptions] = Array.isArray(branch) ? branch : (types[branch] ?? [])
        if (branchKind === 'container') fillFields(branchOptions, out, [...scopes, out], where)
      } else if (field.anon && kind === 'bitfield') {
        for (const { name } of options) out[name] = Number(out[name] ?? 0)
      } else {
        out[field.name] = fillType(field.type, out[field.name], scopes, `${where}.${field.name}`)
        // a list whose length another field writes
        if (kind === 'array' && typeof options.count === 'string' && !options.count.includes('/')) out[options.count] = out[field.name].length
      }
    }
    // the fields that count another (protodef's count type)
    for (const field of fields) {
      if (Array.isArray(field.type) && field.type[0] === 'count') out[field.name] = (out[field.type[1].countFor] ?? []).length
    }
    return out
  }

  function fillContainer (fields, value, scopes, where) {
    const out = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
    return fillFields(fields, out, [...scopes, out], where)
  }

  return { fillType }
}

// `params` of the packet or type `typeName` with every field its schema writes. variables: the protocol's variables
// (ShieldItemID); strict: throw where a value has no default or a name is not the mapper's, rather than write it as
// protodef would (a name it does not know as 0)
function fill (types, typeName, params, options) {
  const type = types[typeName] ?? typeName
  return createFiller(types, options).fillType(type, params, [], typeName)
}

// The field list of a container type, its inlined fields among them
function fieldsOf (types, typeName) {
  let type = types[typeName] ?? typeName
  while (typeof type === 'string' && types[type] && types[type] !== 'native') type = types[type]
  if (!Array.isArray(type) || type[0] !== 'container') return []
  const out = []
  for (const field of type[1]) {
    if (field.anon && Array.isArray(field.type) && field.type[0] === 'container') out.push(...fieldsOf(types, field.type))
    else out.push(field)
  }
  return out
}

const hasPacket = (types, name) => types[`packet_${name}`] !== undefined
// The type of a field of a container type, or undefined
const fieldType = (types, typeName, name) => fieldsOf(types, typeName).find(field => field.name === name)?.type
const hasField = (types, typeName, name) => fieldType(types, typeName, name) !== undefined

// A type with the names of the schema's types it is followed through
function definitionOf (types, type) {
  while (typeof type === 'string' && types[type] && types[type] !== 'native') type = types[type]
  return type
}

// The names of a mapper type ('GameMode')
function mapperValues (types, typeName) {
  const type = definitionOf(types, typeName)
  return Array.isArray(type) && type[0] === 'mapper' ? [...mappingsOf(type[1]).values()] : []
}

// The flags of a bitflags type ('AbilitySet'), every one of them set
function allFlags (types, typeName) {
  const type = definitionOf(types, typeName)
  if (!Array.isArray(type) || type[0] !== 'bitflags') return {}
  return Object.fromEntries(Object.keys(flagBits(type[1])).map(name => [name, true]))
}

module.exports = { fill, fieldsOf, fieldType, hasField, hasPacket, mapperValues, allFlags, definitionOf, toBigInt, hashKey }
