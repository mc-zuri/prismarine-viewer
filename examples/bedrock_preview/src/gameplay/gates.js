// Fence gates, which a use opens and shuts (unless the player sneaks: then the use places the block in hand against
// it, as the game has it). The server changes the gate, and the client foretells it, alike.
const toggles = new WeakMap()

// The state of a gate with open_bit the other way, of a registry's states (hashed ids or not); null for any block that
// is not a fence gate
function gateToggle (registry) {
  if (toggles.has(registry)) return toggles.get(registry)
  const byId = new Map()
  const byKey = new Map()
  const keyOf = (name, props) => name + '|' + Object.keys(props).sort().map(k => `${k}=${props[k]}`).join(',')
  registry.blockStates.forEach((state, index) => {
    if (!/fence_gate$/.test(state.name)) return
    const id = state.stateId ?? index
    const props = Object.fromEntries(Object.entries(state.states ?? {}).map(([k, v]) => [k, String(v.value)]))
    byId.set(id, { name: state.name, props })
    byKey.set(keyOf(state.name, props), id)
  })
  const toggle = stateId => {
    const gate = byId.get(stateId)
    if (!gate || !('open_bit' in gate.props)) return null
    const open = gate.props.open_bit === '1' || gate.props.open_bit === 'true'
    const flipped = { ...gate.props, open_bit: gate.props.open_bit === 'true' || gate.props.open_bit === 'false' ? String(!open) : open ? '0' : '1' }
    return byKey.get(keyOf(gate.name, flipped)) ?? null
  }
  toggles.set(registry, toggle)
  return toggle
}

module.exports = { gateToggle }
