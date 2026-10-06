/* global THREE */
// The walk view's mouse (bedrock-demo packages/bedrock-client-viewer/web/three: walk.ts, pick.ts): a right drag turns
// the camera around the player, a left click (a press and release that did not move) walks the player to the block
// under the cursor: a ray from the camera through it, against the section meshes the viewer drew (water's surface and
// plants too, as they are drawn).
const DEGREES_PER_PIXEL = 0.25
// a press that moved more than this is a drag, not a click
const CLICK_PIXELS = 5
// a point this far inside the face hit, so it is the block's
const INSIDE = 0.01

// The block under a point of the view: { block, face (its outward normal), point }, or undefined
function pick (viewer, element, clientX, clientY) {
  const rect = element.getBoundingClientRect()
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(pointer, viewer.camera)
  const [hit] = raycaster.intersectObjects(Object.values(viewer.world.sectionMeshs))
  if (!hit?.face) return
  const { point, face: { normal } } = hit
  const face = { x: Math.round(normal.x), y: Math.round(normal.y), z: Math.round(normal.z) }
  return {
    block: { x: Math.floor(point.x - face.x * INSIDE), y: Math.floor(point.y - face.y * INSIDE), z: Math.floor(point.z - face.z * INSIDE) },
    face,
    point: { x: point.x, y: point.y, z: point.z }
  }
}

// rig: the camera (its mode and turn); walk(clientX, clientY): a click. Returns what stops it listening.
function walkInput (element, rig, walk) {
  let drag
  let press
  const down = event => {
    if (rig.mode !== 'walk' || event.pointerType !== 'mouse') return
    if (event.button === 2) {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
      element.setPointerCapture(event.pointerId)
    } else if (event.button === 0) {
      press = { x: event.clientX, y: event.clientY }
    }
  }
  const move = event => {
    if (!drag || event.pointerId !== drag.id) return
    rig.turn((event.clientX - drag.x) * DEGREES_PER_PIXEL, (event.clientY - drag.y) * DEGREES_PER_PIXEL)
    drag.x = event.clientX
    drag.y = event.clientY
  }
  const up = event => {
    if (event.button === 2 && drag) {
      element.releasePointerCapture(drag.id)
      drag = undefined
    } else if (event.button === 0 && press) {
      const clicked = Math.hypot(event.clientX - press.x, event.clientY - press.y) <= CLICK_PIXELS
      press = undefined
      if (clicked && rig.mode === 'walk') walk(event.clientX, event.clientY)
    }
  }
  element.addEventListener('pointerdown', down)
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  return () => {
    element.removeEventListener('pointerdown', down)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
  }
}

module.exports = { pick, walkInput }
