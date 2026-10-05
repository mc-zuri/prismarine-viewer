/* global THREE, document, window, fetch */
// What both pages share: the viewer in the page with orbiting controls, and the Bedrock versions it has assets for
global.THREE = require('three')
require('three/examples/js/controls/OrbitControls')
const { Viewer } = require('../../../viewer')

// The Bedrock versions the viewer's assets show, newest first, from worldBounds.json: { version, files }, files the
// version whose assets it is drawn with when it has none of its own
async function bedrockVersions () {
  const bounds = await fetch('worldBounds.json').then(r => r.json())
  return Object.entries(bounds)
    .filter(([version]) => version.startsWith('bedrock_'))
    .map(([version, { files }]) => ({ version, files }))
    .reverse()
}

// a <select> of the versions; the page's ?version= picks the first one shown
function versionSelect (select, versions) {
  for (const { version, files } of versions) {
    const option = document.createElement('option')
    option.value = version
    option.textContent = version.replace('bedrock_', '') + (files ? ` (assets of ${files.replace('bedrock_', '')})` : '')
    select.appendChild(option)
  }
  const asked = new URLSearchParams(window.location.search).get('version')
  if (asked && versions.some(v => v.version === asked)) select.value = asked
}

// The viewer, drawing into container, its camera orbiting a target: { viewer, controls, renderer }. onFrame(dt) runs
// before every frame is drawn. orbit: false leaves the camera to the page (no controls).
function createViewer (container, onFrame = () => {}, { orbit = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setSize(container.clientWidth, container.clientHeight)
  container.appendChild(renderer.domElement)

  const viewer = new Viewer(renderer)
  const controls = orbit ? new THREE.OrbitControls(viewer.camera, renderer.domElement) : null
  if (controls) controls.autoRotateSpeed = 1

  let last = performance.now()
  function animate () {
    window.requestAnimationFrame(animate)
    const now = performance.now()
    onFrame((now - last) / 1000)
    last = now
    controls?.update()
    viewer.update()
    renderer.render(viewer.scene, viewer.camera)
  }
  animate()

  window.addEventListener('resize', () => {
    viewer.camera.aspect = container.clientWidth / container.clientHeight
    viewer.camera.updateProjectionMatrix()
    renderer.setSize(container.clientWidth, container.clientHeight)
  })
  return { viewer, controls, renderer }
}

// Looks at target from 45° around and above it, distance away, from its south-east (side [1, 1]) or another side
function viewFrom45 (viewer, controls, target, distance, [sx, sz] = [1, 1]) {
  controls.target.set(target.x, target.y, target.z)
  viewer.camera.position.set(target.x + sx * distance * 0.62, target.y + distance * 0.5, target.z + sz * distance * 0.62)
  controls.update()
}

// A text label: a sprite, each of its lines lineHeight blocks tall
function label (text, { height: lineHeight = 0.6, color = '#ffffff', background = 'rgba(0, 0, 0, 0.55)' } = {}) {
  const lines = String(text).split('\n')
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')
  const font = '28px sans-serif'
  g.font = font
  canvas.width = Math.ceil(Math.max(...lines.map(line => g.measureText(line).width))) + 16
  canvas.height = 36 * lines.length + 4
  g.font = font
  g.fillStyle = background
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = color
  g.textBaseline = 'middle'
  lines.forEach((line, i) => g.fillText(line, 8, 20 + i * 36))
  const texture = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }))
  const height = lineHeight * lines.length
  sprite.scale.set(height * canvas.width / canvas.height, height, 1)
  return sprite
}

// Looks at target from in front of it (+z), a little above, distance away
function viewFromFront (viewer, controls, target, distance) {
  controls.target.set(target.x, target.y, target.z)
  viewer.camera.position.set(target.x, target.y + distance * 0.25, target.z + distance)
  controls.update()
}

module.exports = { bedrockVersions, versionSelect, createViewer, viewFrom45, viewFromFront, label }
