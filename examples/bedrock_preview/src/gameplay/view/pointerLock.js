/* global document, DOMException */
// The mouse locked to the view, as the game takes it (bedrock-demo packages/bedrock-client-viewer/web/three/camera:
// pointer-lock.ts, mouse-look.ts): raw movement where the browser has it, else the browser's own; the browser lets it
// go on Escape. A lock the browser refuses (it waits a moment after an Escape) says so. A move of more than 256 pixels
// at once (the cursor warped as the lock started) is dropped, not turned.
const JUMP = 256

// the browser waits a moment after an Escape, and locks only the window in front
const refusal = error => `The browser did not lock the mouse${error instanceof Error ? ` (${error.message})` : ''}: click the world again`

class PointerLock {
  // events: change(locked), turn(dx, dy) in pixels, refused(message)
  constructor (element, events) {
    this.element = element
    this.events = events
    this.wasLocked = false
    // a request that answers with a promise says itself why it failed
    this.asking = false
    this.onChange = () => {
      const locked = this.locked
      if (locked === this.wasLocked) return
      this.wasLocked = locked
      this.events.change(locked)
    }
    this.onError = () => { if (!this.asking) this.events.refused(refusal()) }
    this.onMove = event => {
      if (!this.locked) return
      const { movementX: dx, movementY: dy } = event
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.max(Math.abs(dx), Math.abs(dy)) > JUMP) return
      this.events.turn(dx, dy)
    }
    document.addEventListener('pointerlockchange', this.onChange)
    document.addEventListener('pointerlockerror', this.onError)
    document.addEventListener('mousemove', this.onMove)
  }

  get locked () {
    return document.pointerLockElement === this.element
  }

  async lock () {
    if (this.locked) return
    const request = raw => this.element.requestPointerLock(raw ? { unadjustedMovement: true } : undefined)
    this.asking = true
    try {
      await request(true)
    } catch (error) {
      // raw movement is optional: the ordinary lock only when the browser has no raw movement
      if (!(error instanceof DOMException && error.name === 'NotSupportedError')) return this.events.refused(refusal(error))
      try {
        await request(false)
      } catch (plain) {
        this.events.refused(refusal(plain))
      }
    } finally {
      this.asking = false
    }
  }

  unlock () {
    if (this.locked) document.exitPointerLock()
  }

  dispose () {
    this.unlock()
    document.removeEventListener('pointerlockchange', this.onChange)
    document.removeEventListener('pointerlockerror', this.onError)
    document.removeEventListener('mousemove', this.onMove)
  }
}

module.exports = { PointerLock }
