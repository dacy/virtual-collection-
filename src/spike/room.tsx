import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import {
  CanvasTexture,
  Matrix4,
  Object3D,
  PMREMGenerator,
  RepeatWrapping,
  SRGBColorSpace,
  type InstancedMesh,
  type SpotLight as SpotLightImpl,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mulberry32 } from './rng'

export const ROOM = { width: 12, depth: 8, height: 3.6 }
export const EYE_HEIGHT = 1.65
export const PEDESTAL = { size: 0.55, height: 1.0, fitBox: 0.5 }
export const WALL_FIT_BOX = 0.9

export interface SpikeSlot {
  id: string
  kind: 'pedestal' | 'wall'
  position: [number, number, number]
  rotationY: number
}

/** 16 pedestals (perimeter + center row) and 4 wall reliefs = 20 slots. */
export const SLOTS: SpikeSlot[] = [
  ...[-4.5, -1.5, 1.5, 4.5].map<SpikeSlot>((x, i) => ({
    id: `ped_n_${i}`,
    kind: 'pedestal',
    position: [x, 0, -3.1],
    rotationY: 0,
  })),
  ...[-4.5, -1.5, 1.5, 4.5].map<SpikeSlot>((x, i) => ({
    id: `ped_s_${i}`,
    kind: 'pedestal',
    position: [x, 0, 3.1],
    rotationY: Math.PI,
  })),
  ...[-1.6, 1.6].map<SpikeSlot>((z, i) => ({
    id: `ped_w_${i}`,
    kind: 'pedestal',
    position: [-5.2, 0, z],
    rotationY: Math.PI / 2,
  })),
  ...[-1.6, 1.6].map<SpikeSlot>((z, i) => ({
    id: `ped_e_${i}`,
    kind: 'pedestal',
    position: [5.2, 0, z],
    rotationY: -Math.PI / 2,
  })),
  ...[-3.3, -1.1, 1.1, 3.3].map<SpikeSlot>((x, i) => ({
    id: `ped_c_${i}`,
    kind: 'pedestal',
    position: [x, 0, 0],
    rotationY: 0,
  })),
  ...[-3, 3].map<SpikeSlot>((x, i) => ({
    id: `wall_n_${i}`,
    kind: 'wall',
    position: [x, 1.7, -ROOM.depth / 2 + 0.06],
    rotationY: 0,
  })),
  ...[-3, 3].map<SpikeSlot>((x, i) => ({
    id: `wall_s_${i}`,
    kind: 'wall',
    position: [x, 1.7, ROOM.depth / 2 - 0.06],
    rotationY: Math.PI,
  })),
]

export const PEDESTAL_SLOTS = SLOTS.filter((s) => s.kind === 'pedestal')

/** y of the surface pieces actually stand on (top of the steel slab). */
export const PEDESTAL_TOP = PEDESTAL.height + 0.026

/** Cylinder colliders the walk controller pushes out of. */
export const COLLIDERS = PEDESTAL_SLOTS.map((s) => ({
  x: s.position[0],
  z: s.position[2],
  radius: PEDESTAL.size * 0.75 + 0.25,
}))

/** Procedural IBL (three's RoomEnvironment) — believable reflections on the
 *  dynamic pieces with zero network fetches, standing in for the baked room's
 *  environment map. Kept dim so the warm spotlights dominate (cinematic
 *  key/fill contrast). */
export function EnvironmentLight() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.45
    return () => {
      scene.environment = null
      scene.environmentIntensity = 1
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

/** Polished marble tiles: pale base, soft mottling, thin veins, tile joints. */
function makeMarbleFloorTexture(): CanvasTexture {
  const rand = mulberry32(11)
  const s = 1024
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#e9e5dd'
  ctx.fillRect(0, 0, s, s)

  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${150 + rand() * 60}, ${148 + rand() * 55}, ${140 + rand() * 50}, 0.05)`
    ctx.beginPath()
    ctx.ellipse(rand() * s, rand() * s, 20 + rand() * 90, 12 + rand() * 60, rand() * Math.PI, 0, 2 * Math.PI)
    ctx.fill()
  }
  for (let i = 0; i < 42; i++) {
    ctx.strokeStyle = `rgba(110, 108, 100, ${0.08 + rand() * 0.1})`
    ctx.lineWidth = 0.8 + rand() * 1.4
    ctx.beginPath()
    let x = rand() * s
    let y = rand() * s
    ctx.moveTo(x, y)
    for (let k = 0; k < 3; k++) {
      const nx = x + (rand() - 0.5) * 320
      const ny = y + (rand() - 0.5) * 320
      ctx.quadraticCurveTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 120, nx, ny)
      x = nx
      y = ny
    }
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(40, 40, 42, 0.22)'
  ctx.lineWidth = 3
  for (let t = 0; t <= s; t += 256) {
    ctx.beginPath()
    ctx.moveTo(t, 0)
    ctx.lineTo(t, s)
    ctx.moveTo(0, t)
    ctx.lineTo(s, t)
    ctx.stroke()
  }

  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.repeat.set(3, 2)
  tex.anisotropy = 8
  return tex
}

/** Warm ceiling spot with an aimable target (no shadow maps, per spec). */
function CeilingSpot({
  position,
  target,
  intensity = 30,
  angle = 0.5,
}: {
  position: [number, number, number]
  target: [number, number, number]
  intensity?: number
  angle?: number
}) {
  const light = useRef<SpotLightImpl>(null)
  const [targetObj] = useState(() => new Object3D())
  useEffect(() => {
    targetObj.position.set(...target)
    if (light.current) light.current.target = targetObj
  }, [targetObj, target])
  return (
    <>
      <primitive object={targetObj} />
      <spotLight
        ref={light}
        position={position}
        color="#ffe3c2"
        intensity={intensity}
        angle={angle}
        penumbra={0.6}
        distance={7}
        decay={2}
      />
    </>
  )
}

/** Museum-style lighting: every display gets its own narrow overhead spot
 *  (16 pedestals from their ceiling fixtures + 4 wall pieces from angled
 *  spots). Deliberately many dynamic lights — the overlay tells us what
 *  that really costs, which informs the baked-lighting design of the real
 *  Gallery room. */
function DisplaySpots() {
  return (
    <>
      {PEDESTAL_SLOTS.map((s) => (
        <CeilingSpot
          key={`spot_${s.id}`}
          position={[s.position[0], ROOM.height - 0.14, s.position[2]]}
          target={[s.position[0], PEDESTAL.height, s.position[2]]}
        />
      ))}
      {SLOTS.filter((s) => s.kind === 'wall').map((s) => {
        const inward = s.position[2] < 0 ? 1 : -1
        return (
          <CeilingSpot
            key={`spot_${s.id}`}
            position={[s.position[0], ROOM.height - 0.14, s.position[2] + inward * 1.3]}
            target={[s.position[0], s.position[1], s.position[2]]}
            intensity={22}
            angle={0.42}
          />
        )
      })}
    </>
  )
}

/** All 16 pedestals as 4 instanced draws: body, brushed-steel top slab,
 *  warm LED strip under the slab, and a ceiling spot fixture above. */
function Pedestals({ onPedestalClick }: { onPedestalClick?: (slotIndex: number) => void }) {
  const body = useRef<InstancedMesh>(null)
  const slab = useRef<InstancedMesh>(null)
  const strip = useRef<InstancedMesh>(null)
  const fixture = useRef<InstancedMesh>(null)
  const n = PEDESTAL_SLOTS.length

  useLayoutEffect(() => {
    const m = new Matrix4()
    PEDESTAL_SLOTS.forEach((s, i) => {
      const [x, , z] = s.position
      m.setPosition(x, PEDESTAL.height / 2, z)
      body.current!.setMatrixAt(i, m)
      m.setPosition(x, PEDESTAL.height + 0.012, z)
      slab.current!.setMatrixAt(i, m)
      m.setPosition(x, PEDESTAL.height - 0.03, z)
      strip.current!.setMatrixAt(i, m)
      m.setPosition(x, ROOM.height - 0.07, z)
      fixture.current!.setMatrixAt(i, m)
    })
    for (const ref of [body, slab, strip, fixture]) {
      ref.current!.instanceMatrix.needsUpdate = true
    }
  }, [])

  const click =
    onPedestalClick &&
    ((e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      if (e.instanceId !== undefined) {
        onPedestalClick(SLOTS.indexOf(PEDESTAL_SLOTS[e.instanceId]))
      }
    })

  return (
    <>
      <instancedMesh
        ref={body}
        args={[undefined, undefined, n]}
        onClick={click}
        userData={{ pedestalInstance: true }}
      >
        <boxGeometry args={[PEDESTAL.size, PEDESTAL.height, PEDESTAL.size]} />
        <meshStandardMaterial color="#212226" roughness={0.35} metalness={0.15} />
      </instancedMesh>
      <instancedMesh
        ref={slab}
        args={[undefined, undefined, n]}
        onClick={click}
        userData={{ pedestalInstance: true }}
      >
        <boxGeometry args={[PEDESTAL.size + 0.05, 0.024, PEDESTAL.size + 0.05]} />
        <meshStandardMaterial color="#8d9094" roughness={0.35} metalness={0.85} />
      </instancedMesh>
      {/* subtle warm reveal only — bright underlight made pieces look lit
          from below */}
      <instancedMesh ref={strip} args={[undefined, undefined, n]}>
        <boxGeometry args={[PEDESTAL.size + 0.02, 0.008, PEDESTAL.size + 0.02]} />
        <meshBasicMaterial color="#5e492c" />
      </instancedMesh>
      <instancedMesh ref={fixture} args={[undefined, undefined, n]}>
        <cylinderGeometry args={[0.055, 0.075, 0.14, 16]} />
        <meshStandardMaterial color="#0c0d0f" roughness={0.5} metalness={0.6} />
      </instancedMesh>
    </>
  )
}

export function Room({ onPedestalClick }: { onPedestalClick?: (slotIndex: number) => void }) {
  const floorMap = useMemo(makeMarbleFloorTexture, [])
  const { width, depth, height } = ROOM
  const wallSlots = SLOTS.filter((s) => s.kind === 'wall')

  return (
    <group>
      {/* polished marble floor — low roughness so the IBL gives it sheen */}
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={floorMap} roughness={0.22} metalness={0.05} />
      </mesh>

      {/* deep charcoal-green gallery walls */}
      <mesh position={[0, height / 2, -depth / 2]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#272c2b" roughness={0.85} />
      </mesh>
      <mesh position={[0, height / 2, depth / 2]} rotation-y={Math.PI}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#272c2b" roughness={0.85} />
      </mesh>
      <mesh position={[-width / 2, height / 2, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color="#232827" roughness={0.85} />
      </mesh>
      <mesh position={[width / 2, height / 2, 0]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color="#232827" roughness={0.85} />
      </mesh>

      {/* baseboards and a brass chair rail on all four walls */}
      {([
        [0, -depth / 2 + 0.015, width, 0],
        [0, depth / 2 - 0.015, width, 0],
        [-width / 2 + 0.015, 0, depth, Math.PI / 2],
        [width / 2 - 0.015, 0, depth, Math.PI / 2],
      ] as const).map(([x, z, len, rot], i) => (
        <group key={i} position={[x, 0, z]} rotation-y={rot}>
          <mesh position-y={0.06}>
            <boxGeometry args={[len, 0.12, 0.03]} />
            <meshStandardMaterial color="#121314" roughness={0.5} />
          </mesh>
          <mesh position-y={1.02}>
            <boxGeometry args={[len, 0.028, 0.028]} />
            <meshStandardMaterial color="#b08d57" roughness={0.3} metalness={0.85} />
          </mesh>
        </group>
      ))}

      {/* coffered ceiling: dark field, beam grid, warm cove strips */}
      <mesh rotation-x={Math.PI / 2} position={[0, height, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#17181a" roughness={0.95} />
      </mesh>
      {[-3, -1.5, 0, 1.5, 3].map((z) => (
        <mesh key={`bx${z}`} position={[0, height - 0.09, z]}>
          <boxGeometry args={[width, 0.18, 0.22]} />
          <meshStandardMaterial color="#101214" roughness={0.9} />
        </mesh>
      ))}
      {[-4.5, -1.5, 1.5, 4.5].map((x) => (
        <mesh key={`bz${x}`} position={[x, height - 0.09, 0]}>
          <boxGeometry args={[0.22, 0.18, depth]} />
          <meshStandardMaterial color="#101214" roughness={0.9} />
        </mesh>
      ))}
      {([
        [0, -depth / 2 + 0.12, width - 0.5, 0],
        [0, depth / 2 - 0.12, width - 0.5, 0],
        [-width / 2 + 0.12, 0, depth - 0.5, Math.PI / 2],
        [width / 2 - 0.12, 0, depth - 0.5, Math.PI / 2],
      ] as const).map(([x, z, len, rot], i) => (
        <mesh key={`cove${i}`} position={[x, height - 0.22, z]} rotation-y={rot}>
          <boxGeometry args={[len, 0.05, 0.05]} />
          <meshBasicMaterial color="#ffc98f" />
        </mesh>
      ))}

      {/* gold frames + mat boards behind the wall pieces */}
      {wallSlots.map((s) => (
        <group key={`frame_${s.id}`} position={s.position} rotation-y={s.rotationY}>
          <mesh position-z={-0.045}>
            <boxGeometry args={[WALL_FIT_BOX + 0.16, WALL_FIT_BOX + 0.16, 0.05]} />
            <meshStandardMaterial color="#a8874f" roughness={0.35} metalness={0.8} />
          </mesh>
          <mesh position-z={-0.032}>
            <boxGeometry args={[WALL_FIT_BOX + 0.06, WALL_FIT_BOX + 0.06, 0.05]} />
            <meshStandardMaterial color="#14161a" roughness={0.9} />
          </mesh>
        </group>
      ))}

      <Pedestals onPedestalClick={onPedestalClick} />

      {/* cinematic lighting: dim cool ambient fill, one warm spot per
          display as key */}
      <ambientLight intensity={0.22} color="#b9c6d8" />
      <DisplaySpots />
    </group>
  )
}
