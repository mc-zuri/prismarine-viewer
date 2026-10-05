// Item stacks as each version writes them, in one object for all of them (schema.js fills the fields its version has,
// and the writer reads only those):
//
//   1.16.201, 1.16.210   Item { network_id, auxiliary_value: metadata << 8 | count, has_nbt, can_place_on, ... }, and
//                        an inventory list's entry an ItemStack { runtime_id (201) | stack_id (210), item }
//   1.16.220 on          Item { network_id, count, metadata, has_stack_id, stack_id?, block_runtime_id, extra }, an
//                        inventory list's entry the item itself
//   1.26.20 on           ItemV4, the same fields (its network_id 16 bits, has_stack_id a bool)

// An item stack (networkId 0: none) as every version's schema takes it
function itemWire ({ networkId = 0, count = 1, metadata = 0, blockRuntimeId = 0 } = {}) {
  if (!networkId) return { network_id: 0 }
  return {
    network_id: networkId,
    count,
    metadata,
    block_runtime_id: blockRuntimeId,
    has_stack_id: 0,
    auxiliary_value: (metadata << 8) | (count & 0xff)
  }
}

// An inventory list's entry: the item, also as the ItemStack wrapping it before 1.16.220 (slot: its stack's id there)
function stackWire (item, slot) {
  const wire = itemWire(item)
  return { ...wire, runtime_id: slot + 1, stack_id: slot + 1, item: wire }
}

// An item read back: { networkId, count, metadata, blockRuntimeId, raw: the item as read }
function itemOf (raw) {
  const item = raw?.item ?? raw ?? {}
  const networkId = item.network_id ?? 0
  if (!networkId) return { networkId: 0, count: 0, metadata: 0, blockRuntimeId: 0, raw: item }
  if (item.auxiliary_value !== undefined) {
    return { networkId, count: item.auxiliary_value & 0xff, metadata: item.auxiliary_value >> 8, blockRuntimeId: 0, raw: item }
  }
  return { networkId, count: item.count ?? 0, metadata: item.metadata ?? 0, blockRuntimeId: item.block_runtime_id ?? 0, raw: item }
}

// An item as a client sends what it holds: the stack it was given, without the server's stack id
function heldItemWire (raw) {
  if (!raw?.network_id) return { network_id: 0 }
  const held = { ...raw, has_stack_id: 0 }
  delete held.stack_id
  return held
}

module.exports = { itemWire, stackWire, itemOf, heldItemWire }
