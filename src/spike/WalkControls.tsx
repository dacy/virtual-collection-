import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { COLLIDERS, EYE_HEIGHT, EYE_RANGE, FURNITURE_COLLIDERS, ROOM, type CircleCollider } from './layout'

const WALK_SPEED = 2.6
const EYE_SPEED = 0.7
const LOOK_SENSITIVITY = 0.0022
const TOUCH_LOOK_SENSITIVITY = 0.005
const WALL_MARGIN = 0.35

const DEFAULT_COLLIDERS = [...COLLIDERS, ...FURNITURE_COLLIDERS]

/**
 * First-person walk: pointer-lock mouse-look + WASD/arrows on desktop;
 * on touch, the left half of the screen is a virtual move joystick and the
 * right half drags to look. Q/E lowers/raises the eye height so any piece
 * can be studied from above, level, or below. Collision is room-bounds
 * clamping plus cylinder push-out around each pedestal and bench.
 *
 * With `pointerLockEnabled={false}` (edit mode) clicks are left to piece
 * selection; WASD/touch movement keeps working.
 */
export function WalkControls({
  pointerLockEnabled = true,
  colliders = DEFAULT_COLLIDERS,
}: {
  pointerLockEnabled?: boolean
  colliders?: CircleCollider[]
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const lockEnabled = useRef(pointerLockEnabled)
  lockEnabled.current = pointerLockEnabled
  const collidersRef = useRef(colliders)
  collidersRef.current = colliders

  useEffect(() => {
    if (!pointerLockEnabled && document.pointerLockElement) document.exitPointerLock()
  }, [pointerLockEnabled])
  const yaw = useRef(0)
  const pitch = useRef(0)
  const eye = useRef(EYE_HEIGHT)
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
      if (lockEnabled.current && !('ontouchstart' in window)) el.requestPointerLock()
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

    // debug/deep-link hook: window.dispatchEvent(new CustomEvent('vc-pose',
    // { detail: { x, z, yaw, pitch, eye } })) teleports the viewer
    const onPose = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {}
      if (typeof d.yaw === 'number') yaw.current = d.yaw
      if (typeof d.pitch === 'number') pitch.current = clampPitch(d.pitch)
      if (typeof d.eye === 'number') eye.current = clamp(d.eye, EYE_RANGE[0], EYE_RANGE[1])
      if (typeof d.x === 'number') camera.position.x = d.x
      if (typeof d.z === 'number') camera.position.z = d.z
    }

    window.addEventListener('vc-pose', onPose)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    el.addEventListener('click', onClick)
    window.addEventListener('mousemove', onMouseMove)
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      window.removeEventListener('vc-pose', onPose)
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

    // viewing-height adjust: crouch with Q, rise with E
    if (k.has('KeyQ')) eye.current = clamp(eye.current - EYE_SPEED * delta, EYE_RANGE[0], EYE_RANGE[1])
    if (k.has('KeyE')) eye.current = clamp(eye.current + EYE_SPEED * delta, EYE_RANGE[0], EYE_RANGE[1])

    const sin = Math.sin(yaw.current)
    const cos = Math.cos(yaw.current)
    let px = camera.position.x + (mx * cos + mz * sin) * WALK_SPEED * delta
    let pz = camera.position.z + (-mx * sin + mz * cos) * WALK_SPEED * delta

    px = clamp(px, -ROOM.width / 2 + WALL_MARGIN, ROOM.width / 2 - WALL_MARGIN)
    pz = clamp(pz, -ROOM.depth / 2 + WALL_MARGIN, ROOM.depth / 2 - WALL_MARGIN)
    for (const c of collidersRef.current) {
      const dx = px - c.x
      const dz = pz - c.z
      const d = Math.hypot(dx, dz)
      if (d < c.radius && d > 1e-4) {
        px = c.x + (dx / d) * c.radius
        pz = c.z + (dz / d) * c.radius
      }
    }
    camera.position.set(px, eye.current, pz)
  })

  return null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clampPitch = (p: number) => clamp(p, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
