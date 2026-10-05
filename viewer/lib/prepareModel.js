// Turns a model whose textures are names into one whose faces carry their atlas coordinates. Run at build time on
// every model (modelsBuilder.js) and by the mesher on the models it draws (models.js).

// 'minecraft:block/stone', 'blocks/stone' -> 'stone': model names and texture names as the models refer to them, to
// the keys of blocks_models.json and of the atlas
function cleanupBlockName (name) {
  name = name.replace(/^minecraft:/, '')
  return name.replace(/^blocks?\//, '')
}

function unwrapTexture (ref) {
  // 26.x wraps some model texture refs in objects ({ sprite, force_translucent, ... })
  return typeof ref === 'object' && ref !== null ? ref.sprite : ref
}

// the UV a face takes when its model gives none
function defaultUv (sideName, _from, _to) {
  // taken from https://github.com/DragonDev1906/Minecraft-Overviewer/
  return {
    north: [_to[0], 16 - _to[1], _from[0], 16 - _from[1]],
    east: [_from[2], 16 - _to[1], _to[2], 16 - _from[1]],
    south: [_from[0], 16 - _to[1], _to[0], 16 - _from[1]],
    west: [_from[2], 16 - _to[1], _to[2], 16 - _from[1]],
    up: [_from[0], _from[2], _to[0], _to[2]],
    down: [_to[0], _from[2], _from[0], _to[2]]
  }[sideName]
}

function prepareModel (model, texturesJson) {
  // resolve texture names eg west: #all -> blocks/stone
  for (const tex in model.textures) {
    let root = unwrapTexture(model.textures[tex])
    while (root.charAt(0) === '#') {
      root = unwrapTexture(model.textures[root.substr(1)])
    }
    model.textures[tex] = root
  }
  for (const tex in model.textures) {
    let name = model.textures[tex]
    name = cleanupBlockName(name)
    model.textures[tex] = texturesJson[name]
  }
  for (const elem of model.elements) {
    for (const sideName of Object.keys(elem.faces)) {
      const face = elem.faces[sideName]

      if (face.texture.charAt(0) === '#') {
        face.texture = JSON.parse(JSON.stringify(model.textures[face.texture.substr(1)]))
      } else if (
        !(cleanupBlockName(face.texture) in texturesJson) &&
        face.texture in model.textures
      ) {
        face.texture = JSON.parse(JSON.stringify(model.textures[face.texture]))
      } else {
        let name = face.texture
        name = cleanupBlockName(name)
        face.texture = JSON.parse(JSON.stringify(texturesJson[name]))
      }

      const uv = face.uv ?? defaultUv(sideName, elem.from, elem.to)

      const su = (uv[2] - uv[0]) * face.texture.su / 16
      const sv = (uv[3] - uv[1]) * face.texture.sv / 16
      face.texture.bu = face.texture.u + 0.5 * face.texture.su
      face.texture.bv = face.texture.v + 0.5 * face.texture.sv
      face.texture.u += uv[0] * face.texture.su / 16
      face.texture.v += uv[1] * face.texture.sv / 16
      face.texture.su = su
      face.texture.sv = sv
    }
  }
}

module.exports = { prepareModel, cleanupBlockName, unwrapTexture, defaultUv }
