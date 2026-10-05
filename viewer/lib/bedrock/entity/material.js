// Bedrock's entity shader (shaders/glsl/entity.vertex and entity.fragment of the 1.16 client) as a three.js
// ShaderMaterial: the features its materials switch on with defines, and their states.
//
// Uniforms, as the game's:
//  - CHANGE_COLOR: the render controller's `color` (else the engine's: a sheep's wool, a fish's base colour), the tint
//    of USE_COLOR_MASK / MULTI_COLOR_TINT / COLOR_SECOND_TEXTURE
//  - MULTIPLICATIVE_TINT_CHANGE_COLOR: the second tint (a tropical fish's pattern colour)
//  - OVERLAY_COLOR: the render controller's `overlay_color` (USE_OVERLAY)
//  - UV_ANIM: offset xy, scale zw (USE_UV_ANIM)
//  - LIGHT: the light at the entity times light_color_multiplier; LIT: 0 for ignore_lighting
// The alpha test of a blended material drops only the pixels nothing shows of, and leaves the rest to the blend: all
// of a wind charge's wind is under half opaque (breeze_wind), and the test of an opaque material would drop it whole.
const THREE = require('three')

const VERTEX = `
varying vec2 vUv;
varying float vLight;
uniform vec4 OVERLAY_COLOR;
uniform vec4 UV_ANIM;
uniform float LIT;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  vec3 N = normalize(mat3(modelMatrix) * normal);
  float yLight = (1.0 + N.y) * 0.5;
  float L = yLight * (1.0 - 0.45) + N.x * N.x * -0.1 + N.z * N.z * 0.1 + 0.45;
#ifdef USE_OVERLAY
  L += OVERLAY_COLOR.a * 0.35;
#endif
  vLight = mix(1.0, L, LIT);
  vUv = uv;
#ifdef USE_UV_ANIM
  vUv = UV_ANIM.xy + uv * UV_ANIM.zw;
#endif
}
`

const FRAGMENT = `
uniform sampler2D TEXTURE_0;
uniform sampler2D TEXTURE_1;
uniform sampler2D TEXTURE_2;
uniform vec4 CHANGE_COLOR;
uniform vec4 MULTIPLICATIVE_TINT_CHANGE_COLOR;
uniform vec4 OVERLAY_COLOR;
uniform vec3 LIGHT;
varying vec2 vUv;
varying float vLight;

#ifdef USE_EMISSIVE
#ifdef USE_ONLY_EMISSIVE
#define NEEDS_DISCARD(C) (C.a == 0.0 || C.a == 1.0)
#else
#define NEEDS_DISCARD(C) (C.a + C.r + C.g + C.b == 0.0)
#endif
#else
#if !defined(USE_COLOR_MASK) && !defined(BLENDED)
#define NEEDS_DISCARD(C) (C.a < 0.5)
#else
#define NEEDS_DISCARD(C) (C.a == 0.0)
#endif
#endif

void main() {
  vec4 color = texture2D(TEXTURE_0, vUv);

#ifdef MASKED_MULTITEXTURE
  vec4 tex1m = texture2D(TEXTURE_1, vUv);
  float maskedTexture = ceil(dot(tex1m.rgb, vec3(1.0, 1.0, 1.0)) * (1.0 - tex1m.a));
  color = mix(tex1m, color, clamp(maskedTexture, 0.0, 1.0));
#endif

#if defined(ALPHA_TEST) && !defined(USE_MULTITEXTURE) && !defined(MULTIPLICATIVE_TINT)
  if (NEEDS_DISCARD(color)) discard;
#endif

#ifdef MULTI_COLOR_TINT
  vec2 colorMask = color.rg;
  color.rgb = colorMask.rrr * CHANGE_COLOR.rgb;
  color.rgb = mix(color, colorMask.gggg * MULTIPLICATIVE_TINT_CHANGE_COLOR, ceil(colorMask.g)).rgb;
#else
#ifdef USE_COLOR_MASK
  color.rgb = mix(color.rgb, color.rgb * CHANGE_COLOR.rgb, color.a);
  color.a *= CHANGE_COLOR.a;
#endif
#endif

#ifdef USE_MULTITEXTURE
  vec4 tex1 = texture2D(TEXTURE_1, vUv);
  vec4 tex2 = texture2D(TEXTURE_2, vUv);
  color.rgb = mix(color.rgb, tex1.rgb, tex1.a);
#ifdef ALPHA_TEST
  if (color.a < 0.5 && tex1.a == 0.0) discard;
#endif
#ifdef COLOR_SECOND_TEXTURE
  if (tex2.a > 0.0) color.rgb = tex2.rgb + (tex2.rgb * CHANGE_COLOR.rgb - tex2.rgb) * tex2.a;
#else
  color.rgb = mix(color.rgb, tex2.rgb, tex2.a);
#endif
#endif

#ifdef MULTIPLICATIVE_TINT
  vec4 tintTex = texture2D(TEXTURE_1, vUv);
#ifdef MULTIPLICATIVE_TINT_COLOR
  tintTex.rgb = tintTex.rgb * MULTIPLICATIVE_TINT_CHANGE_COLOR.rgb;
#endif
#ifdef ALPHA_TEST
  color.rgb = mix(color.rgb, tintTex.rgb, tintTex.a);
  if (color.a + tintTex.a <= 0.0) discard;
#endif
#endif

#ifdef USE_OVERLAY
  color.rgb = mix(color, OVERLAY_COLOR, OVERLAY_COLOR.a).rgb;
#endif

  vec4 light = vec4(vec3(vLight) * LIGHT, 1.0);
#ifdef USE_EMISSIVE
  color *= mix(vec4(1.0), light, color.a);
#else
  color *= light;
#endif

#ifndef BLENDED
  color.a = 1.0;
#endif
  gl_FragColor = color;
}
`

const BLEND_FACTORS = {
  Zero: THREE.ZeroFactor,
  One: THREE.OneFactor,
  SourceColor: THREE.SrcColorFactor,
  OneMinusSrcColor: THREE.OneMinusSrcColorFactor,
  SourceAlpha: THREE.SrcAlphaFactor,
  OneMinusSrcAlpha: THREE.OneMinusSrcAlphaFactor,
  DestColor: THREE.DstColorFactor,
  OneMinusDestColor: THREE.OneMinusDstColorFactor,
  DestAlpha: THREE.DstAlphaFactor,
  OneMinusDestAlpha: THREE.OneMinusDstAlphaFactor
}

// defines the shader above knows
const KNOWN = ['ALPHA_TEST', 'USE_COLOR_MASK', 'MULTI_COLOR_TINT', 'MASKED_MULTITEXTURE', 'USE_MULTITEXTURE',
  'COLOR_SECOND_TEXTURE', 'MULTIPLICATIVE_TINT', 'MULTIPLICATIVE_TINT_COLOR', 'USE_OVERLAY', 'USE_EMISSIVE',
  'USE_ONLY_EMISSIVE', 'USE_UV_ANIM']

let blank = null
// a texture to sample until the real one has loaded (fully transparent: alpha-tested layers draw nothing)
function blankTexture () {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat)
    blank.needsUpdate = true
  }
  return blank
}

// flags: { defines, states, blendSrc, blendDst } from the export; textures: up to three THREE.Textures (or null)
function entityMaterial (flags = { defines: [], states: [] }) {
  const defines = {}
  for (const d of flags.defines ?? []) if (KNOWN.includes(d)) defines[d] = ''
  const states = new Set(flags.states ?? [])
  const blended = states.has('Blending')
  if (blended) defines.BLENDED = ''
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines,
    uniforms: {
      TEXTURE_0: { value: blankTexture() },
      TEXTURE_1: { value: blankTexture() },
      TEXTURE_2: { value: blankTexture() },
      CHANGE_COLOR: { value: new THREE.Vector4(1, 1, 1, 1) },
      MULTIPLICATIVE_TINT_CHANGE_COLOR: { value: new THREE.Vector4(1, 1, 1, 1) },
      OVERLAY_COLOR: { value: new THREE.Vector4(0, 0, 0, 0) },
      UV_ANIM: { value: new THREE.Vector4(0, 0, 1, 1) },
      LIGHT: { value: new THREE.Vector3(1, 1, 1) },
      LIT: { value: 1 }
    },
    side: states.has('DisableCulling') ? THREE.DoubleSide : THREE.FrontSide,
    transparent: blended,
    depthWrite: !states.has('DisableDepthWrite') && !blended,
    colorWrite: !states.has('DisableColorWrite')
  })
  if (blended) {
    material.blending = THREE.CustomBlending
    material.blendSrc = BLEND_FACTORS[flags.blendSrc] ?? THREE.SrcAlphaFactor
    material.blendDst = BLEND_FACTORS[flags.blendDst] ?? THREE.OneMinusSrcAlphaFactor
  }
  return material
}

// the material's textures (a texture still loading carries userData.ready, a promise); the material stays hidden
// until all of them have loaded
function setTextures (material, textures) {
  let pending = 0
  textures.slice(0, 3).forEach((t, i) => {
    const uniform = material.uniforms['TEXTURE_' + i]
    if (!t) { uniform.value = blankTexture(); return }
    if (!t.userData?.ready || t.userData.loaded) {
      uniform.value = t
      return
    }
    pending++
    t.userData.ready.then(() => {
      uniform.value = t
      if (--pending === 0) material.visible = true
    }, () => {
      if (--pending === 0) material.visible = true
    })
  })
  material.visible = pending === 0
}

module.exports = { entityMaterial, setTextures, blankTexture }
