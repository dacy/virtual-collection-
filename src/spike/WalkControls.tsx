import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { COLLIDERS, EYE_HEIGHT, ROOM } from './room'

const WALK_SPEED = 2.6
const LOOK_SENSITIVITY = 0.0022
const TOUCH_LOOK_SENSITIVITY = 0.005
const WALL_MARGIN = 0.35

/**
 * First-person walk: pointer-lock mouse-look + WASD/arrows on desktop;
 * on touch, the left half of the screen is a virtual move joystick and the
 * right half drags to look. Collision is room-bounds clamping plus
 * cylinder push-out around each pedestal — enough to tune the close-viewing
 * feel the spec cares about.
 */
export function WalkControls() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const yaw = useRef(0)
  const pitch = useRef(0)
  const keys = useRef(new Set<string>())
  const touchMove = useRef({ x: 0, y: 0 })
  const touchState = useRef(
    new Map<number, { zone: 'move' | 'look'; x: number; y: number; ox: number; oy: number }>(),
  )

  useEffect(() => {
    camera.rotation.order = 'YXZ'
    camera.position.set(0, EYE_HEIGHT, 2.6)

    const el = gl.domElement
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      if (down) keys.current.add(e.code)
      else keys.current.delete(e.code)
    }
    const keyDown = onKey(true)
    const keyUp = onKey(false)
    const onClick = () => {
      if (!('ontouchstart' in window)) el.requestPointerLock()
    }
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return
      yaw.current -= e.movementX * LOOK_SENSITIVITY
      pitch.current = clampPitch(pitch.current - e.movementY * LOOK_SENSITIVITY)
    }

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        const zone = t.clientX < window.innerWidth / 2 ? 'move' : 'look'
        touchState.current.set(t.identifier, {
          zone,
          x: t.clientX,
          y: t.clientY,
          ox: t.clientX,
          oy: t.clientY,
        })
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        const s = touchState.current.get(t.identifier)
        if (!s) continue
        if (s.zone === 'move') {
          touchMove.current = {
            x: clamp((t.clientX - s.ox) / 60, -1, 1),
            y: clamp((t.clientY - s.oy) / 60, -1, 1),
          }
        } else {
          yaw.current -= (t.clientX - s.x) * TOUCH_LOOK_SENSITIVITY
          pitch.current = clampPitch(pitch.current - (t.clientY - s.y) * TOUCH_LOOK_SENSITIVITY)
          s.x = t.clientX
          s.y = t.clientY
        }
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const s = touchState.current.get(t.identifier)
        if (s?.zone === 'move') touchMove.current = { x: 0, y: 0 }
        touchState.current.delete(t.identifier)
      }
    }

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    el.addEventListener('click', onClick)
    window.addEventListener('mousemove', onMouseMove)
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      el.removeEventListener('click', onClick)
      window.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [camera, gl])

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1)
    camera.rotation.set(pitch.current, yaw.current, 0)

    const k = keys.current
    let mx = touchMove.current.x
    let mz = touchMove.current.y
    if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1
    if (k.has('KeyS') || k.has('ArrowDown')) mz += 1
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1
    const len = Math.hypot(mx, mz)
    if (len > 1) {
      mx /= len
      mz /= len
    }

    const sin = Math.sin(yaw.current)
    const cos = Math.cos(yaw.current)
    let px = camera.position.x + (mx * cos + mz * sin) * WALK_SPEED * delta
    let pz = camera.position.z + (-mx * sin + mz * cos) * WALK_SPEED * delta

    px = clamp(px, -ROOM.width / 2 + WALL_MARGIN, ROOM.width / 2 - WALL_MARGIN)
    pz = clamp(pz, -ROOM.depth / 2 + WALL_MARGIN, ROOM.depth / 2 - WALL_MARGIN)
    for (const c of COLLIDERS) {
      const dx = px - c.x
      const dz = pz - c.z
      const d = Math.hypot(dx, dz)
      if (d < c.radius && d > 1e-4) {
        px = c.x + (dx / d) * c.radius
        pz = c.z + (dz / d) * c.radius
      }
    }
    camera.position.set(px, EYE_HEIGHT, pz)
  })

  return null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clampPitch = (p: number) => clamp(p, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
