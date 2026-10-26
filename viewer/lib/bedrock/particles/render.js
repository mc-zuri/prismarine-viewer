// The particles' quads, drawn as the game draws them: one mesh per texture and material, its geometry filled anew
// every frame with the quads of all the emitters that draw with them (four corners each: position, uv, colour).
//
// The materials (the game's particles.material):
//  - particles_alpha: the texture's pixels under half opaque dropped, the rest opaque, times the colour
//  - particles_opaque: opaque, times the colour
//  - particles_blend: blended by alpha (the texture's times the colour's), behind what is drawn opaque
//  - particles_add: added onto what is behind
const THREE = require('three')

const VERTEX = `
attribute vec4 tint;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vUv = uv;
  vTint = tint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 diffuse = texture2D(map, vUv);
#ifdef ALPHA_TEST
  if (diffuse.a < 0.5) discard;
#endif
  vec4 color = diffuse * vTint;
#ifdef OPAQUE
  color.a = 1.0;
#endif
  gl_FragColor = color;
}
`

function particleMaterial (name, texture) {
  const blended = name === 'particles_blend' || name === 'particles_add'
  const defines = {}
  if (name === 'particles_alpha') defines.ALPHA_TEST = ''
  if (!blended) defines.OPAQUE = ''
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines,
    uniforms: { map: { value: texture } },
    side: THREE.DoubleSide,
    transparent: blended,
    depthWrite: !blended
  })
  if (name === 'particles_add') material.blending = THREE.AdditiveBlending
  return material
}

const QUAD = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

class Batch {
  // texture: a THREE.Texture, which may still be loading (userData.ready): nothing shows until it has
  constructor (scene, material, texture) {
    this.scene = scene
    this.capacity = 0
    this.count = 0
    this.geometry = new THREE.BufferGeometry()
    this.material = particleMaterial(material, texture)
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = material === 'particles_blend' || material === 'particles_add' ? 2 : 1
    this.mesh.name = 'particles ' + material
    this.ready = !texture?.userData?.ready || !!texture.userData.loaded
    if (!this.ready) {
      texture.userData.ready.then(() => { this.ready = true }, () => { this.ready = true })
    }
    scene.add(this.mesh)
    this.grow(64)
  }

  grow (capacity) {
    this.capacity = capacity
    this.positions = new Float32Array(capacity * 12)
    this.uvs = new Float32Array(capacity * 8)
    this.tints = new Float32Array(capacity * 16)
    const index = new (capacity * 4 > 65535 ? Uint32Array : Uint16Array)(capacity * 6)
    for (let i = 0; i < capacity; i++) index.set([0, 1, 2, 0, 2, 3].map(k => k + i * 4), i * 6)
    this.geometry.dispose()
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('tint', new THREE.BufferAttribute(this.tints, 4).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1))
    this.mesh.geometry = this.geometry
  }

  begin () {
    this.count = 0
  }

  // a quad about `center`, right and up its half sizes along its axes; uv: [u0, v0, u1, v1] (v0 its top); rgba
  quad (center, right, up, uv, rgba) {
    if (this.count >= this.capacity) {
      const old = { positions: this.positions, uvs: this.uvs, tints: this.tints }
      this.grow(this.capacity * 2)
      this.positions.set(old.positions)
      this.uvs.set(old.uvs)
      this.tints.set(old.tints)
    }
    const i = this.count++
    const p = this.positions
    const t = this.uvs
    const c = this.tints
    for (let k = 0; k < 4; k++) {
      const [sx, sy] = QUAD[k]
      const o = (i * 4 + k) * 3
      p[o] = center.x + right.x * sx + up.x * sy
      p[o + 1] = center.y + right.y * sx + up.y * sy
      p[o + 2] = center.z + right.z * sx + up.z * sy
      const q = (i * 4 + k) * 2
      t[q] = sx < 0 ? uv[0] : uv[2]
      t[q + 1] = sy < 0 ? uv[3] : uv[1]
      const r = (i * 4 + k) * 4
      c[r] = rgba[0]
      c[r + 1] = rgba[1]
      c[r + 2] = rgba[2]
      c[r + 3] = rgba[3]
    }
  }

  end () {
    const g = this.geometry
    g.setDrawRange(0, this.count * 6)
    for (const name of ['position', 'uv', 'tint']) {
      const attribute = g.attributes[name]
      attribute.needsUpdate = true
      // (only what was written goes to the GPU)
      attribute.updateRange.offset = 0
      attribute.updateRange.count = this.count * 4 * attribute.itemSize
    }
    this.mesh.visible = this.ready && this.count > 0
  }

  dispose () {
    this.scene.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
  }
}

module.exports = { Batch, particleMaterial }
