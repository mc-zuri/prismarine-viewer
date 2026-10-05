// What bedrock-protocol's datatypes use of uuid-1345 (its uuid type: a UUID read as text and written from it), for
// the bundles, which alias uuid-1345 to this: the module itself draws random bytes from Node's crypto when it loads,
// and asks the OS for a MAC address.

// 16 bytes -> 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
function stringify (buffer) {
  let text = ''
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) text += '-'
    text += (buffer[i] + 0x100).toString(16).slice(1)
  }
  return text
}

// 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' -> 16 bytes
function parse (string) {
  const hex = string.replace(/-/g, '')
  const buffer = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) buffer[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return buffer
}

module.exports = { stringify, parse }
