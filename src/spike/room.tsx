import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector3,
  type InstancedMesh,
  type SpotLight as SpotLightImpl,
} from 'three'
import { mulberry32 } from './rng'
import { AAA_FX } from './quality'

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

// HDR (>1) colors so the bloom pass picks these up as light sources
const COVE_HDR = new Color('#ffc98f').multiplyScalar(1.6)
const FIXTURE_LENS_HDR = new Color('#ffe3c2').multiplyScalar(4)
const SKY_HDR = new Color('#cfe6ff').multiplyScalar(2.6)
const SUN_HDR = new Color('#fff3d2').multiplyScalar(18)

/** y of the surface pieces actually stand on (top of the steel slab). */
export const PEDESTAL_TOP = PEDESTAL.height + 0.026

/** Cylinder colliders the walk controller pushes out of. */
export const COLLIDERS = PEDESTAL_SLOTS.map((s) => ({
  x: s.position[0],
  z: s.position[2],
  radius: PEDESTAL.size * 0.75 + 0.25,
}))

/** Daylight rig baked into the environment map: a big cool sky panel on the
 *  window side, a small hot sun disc, bright shell, warm floor bounce.
 *  This is what glass, steel, and glossy pieces reflect. Basic materials
 *  act as emitters in the PMREM bake; colors above 1.0 are intentional. */
function makeDaylightEnvScene(): Scene {
  const scene = new Scene()
  const emitter = (
    geometry: PlaneGeometry | BoxGeometry,
    color: Color,
    position: [number, number, number],
    rotation: [number, number, number],
  ) => {
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ color }))
    mesh.position.set(...position)
    mesh.rotation.set(...rotation)
    scene.add(mesh)
  }

  const shell = new Mesh(
    new BoxGeometry(20, 12, 20),
    new MeshBasicMaterial({ color: new Color('#c9c7c0'), side: BackSide }),
  )
  shell.position.y = 4
  scene.add(shell)

  // sky through the window wall + a hot sun disc
  emitter(new PlaneGeometry(14, 6), new Color('#cfe6ff').multiplyScalar(3), [0, 5, 9.8], [0, Math.PI, 0])
  emitter(new PlaneGeometry(2, 2), new Color('#fff3d2').multiplyScalar(22), [4, 7.5, 9.7], [0, Math.PI, 0])
  // soft warm ceiling wash and floor bounce
  emitter(new PlaneGeometry(8, 8), new Color('#fff0dc').multiplyScalar(1.6), [0, 9.8, 0], [Math.PI / 2, 0, 0])
  emitter(new PlaneGeometry(18, 18), new Color('#b3a48f').multiplyScalar(1.2), [0, -1.9, 0], [-Math.PI / 2, 0, 0])

  return scene
}

export function EnvironmentLight() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(makeDaylightEnvScene(), 0.035).texture
    scene.environment = env
    scene.environmentIntensity = 0.6
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
        penumbra={1}
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
          intensity={14}
          angle={0.62}
        />
      ))}
      {SLOTS.filter((s) => s.kind === 'wall').map((s) => {
        const inward = s.position[2] < 0 ? 1 : -1
        return (
          <CeilingSpot
            key={`spot_${s.id}`}
            position={[s.position[0], ROOM.height - 0.14, s.position[2] + inward * 1.3]}
            target={[s.position[0], s.position[1], s.position[2]]}
            intensity={12}
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
  const lens = useRef<InstancedMesh>(null)
  const n = PEDESTAL_SLOTS.length

  useLayoutEffect(() => {
    // makeTranslation resets the whole matrix each time — setPosition would
    // keep a previously composed rotation and topple every later instance
    const m = new Matrix4()
    const lensM = new Matrix4()
    const faceDown = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    const one = new Vector3(1, 1, 1)
    PEDESTAL_SLOTS.forEach((s, i) => {
      const [x, , z] = s.position
      body.current!.setMatrixAt(i, m.makeTranslation(x, PEDESTAL.height / 2, z))
      slab.current!.setMatrixAt(i, m.makeTranslation(x, PEDESTAL.height + 0.012, z))
      strip.current!.setMatrixAt(i, m.makeTranslation(x, PEDESTAL.height - 0.03, z))
      fixture.current!.setMatrixAt(i, m.makeTranslation(x, ROOM.height - 0.07, z))
      lensM.compose(new Vector3(x, ROOM.height - 0.142, z), faceDown, one)
      lens.current!.setMatrixAt(i, lensM)
    })
    for (const ref of [body, slab, strip, fixture, lens]) {
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
        castShadow
        receiveShadow
      >
        <boxGeometry args={[PEDESTAL.size, PEDESTAL.height, PEDESTAL.size]} />
        <meshStandardMaterial color="#e2dfd8" roughness={0.55} metalness={0.02} />
      </instancedMesh>
      <instancedMesh
        ref={slab}
        args={[undefined, undefined, n]}
        onClick={click}
        userData={{ pedestalInstance: true }}
        castShadow
        receiveShadow
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
      {/* glowing lens under each fixture — HDR so bloom halos it */}
      <instancedMesh ref={lens} args={[undefined, undefined, n]}>
        <circleGeometry args={[0.05, 16]} />
        <meshBasicMaterial color={FIXTURE_LENS_HDR} />
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
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={floorMap} roughness={0.22} metalness={0.05} />
      </mesh>

      {/* warm gallery-white walls; the south wall carries the clerestory */}
      <mesh position={[0, height / 2, -depth / 2]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#e8e3d9" roughness={0.85} />
      </mesh>
      <mesh position={[-width / 2, height / 2, 0]} rotation-y={Math.PI / 2} receiveShadow>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color="#e3ded4" roughness={0.85} />
      </mesh>
      <mesh position={[width / 2, height / 2, 0]} rotation-y={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color="#e3ded4" roughness={0.85} />
      </mesh>

      {/* south wall: solid below, clerestory ribbon windows above letting
          the sun in, header on top; sky + sun visible outside */}
      <group>
        <mesh position={[0, 1.15, depth / 2 + 0.075]} receiveShadow>
          <boxGeometry args={[width, 2.3, 0.15]} />
          <meshStandardMaterial color="#e8e3d9" roughness={0.85} />
        </mesh>
        <mesh position={[0, 3.45, depth / 2 + 0.075]}>
          <boxGeometry args={[width, 0.3, 0.15]} />
          <meshStandardMaterial color="#e8e3d9" roughness={0.85} />
        </mesh>
        {[-5.7, 5.7].map((x) => (
          <mesh key={`wend${x}`} position={[x, 2.8, depth / 2 + 0.075]}>
            <boxGeometry args={[0.6, 1.0, 0.15]} />
            <meshStandardMaterial color="#e8e3d9" roughness={0.85} />
          </mesh>
        ))}
        {[-1.8, 1.8].map((x) => (
          <mesh key={`wpil${x}`} position={[x, 2.8, depth / 2 + 0.075]}>
            <boxGeometry args={[0.24, 1.0, 0.15]} />
            <meshStandardMaterial color="#f2efe8" roughness={0.7} />
          </mesh>
        ))}
        <mesh position={[0, 2.33, depth / 2 + 0.06]}>
          <boxGeometry args={[width - 1.0, 0.06, 0.22]} />
          <meshStandardMaterial color="#f2efe8" roughness={0.7} />
        </mesh>
        {/* the outdoors: HDR sky sheet and sun disc (bloom catches both) */}
        <mesh position={[0, 3, depth / 2 + 2.2]} rotation-y={Math.PI}>
          <planeGeometry args={[17, 7]} />
          <meshBasicMaterial color={SKY_HDR} />
        </mesh>
        <mesh position={[4, 5.4, depth / 2 + 2.1]} rotation-y={Math.PI}>
          <circleGeometry args={[0.7, 24]} />
          <meshBasicMaterial color={SUN_HDR} />
        </mesh>
      </group>

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
            <meshStandardMaterial color="#f2efe8" roughness={0.6} />
          </mesh>
          <mesh position-y={1.02}>
            <boxGeometry args={[len, 0.028, 0.028]} />
            <meshStandardMaterial color="#b08d57" roughness={0.3} metalness={0.85} />
          </mesh>
        </group>
      ))}

      {/* coffered ceiling: bright field, white beam grid, warm cove strips */}
      <mesh rotation-x={Math.PI / 2} position={[0, height, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#f4f2ec" roughness={0.95} />
      </mesh>
      {[-3, -1.5, 0, 1.5, 3].map((z) => (
        <mesh key={`bx${z}`} position={[0, height - 0.09, z]}>
          <boxGeometry args={[width, 0.18, 0.22]} />
          <meshStandardMaterial color="#e7e4dc" roughness={0.9} />
        </mesh>
      ))}
      {[-4.5, -1.5, 1.5, 4.5].map((x) => (
        <mesh key={`bz${x}`} position={[x, height - 0.09, 0]}>
          <boxGeometry args={[0.22, 0.18, depth]} />
          <meshStandardMaterial color="#e7e4dc" roughness={0.9} />
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
          <meshBasicMaterial color={COVE_HDR} />
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

      {/* daylight: warm sun through the clerestory (one static shadow map,
          re-baked only when pieces change), bright sky hemisphere with a
          warm floor-bounce ground color, plus soft display spots as accent */}
      <directionalLight
        position={[4, 7.5, 9]}
        color="#fff1da"
        intensity={3.2}
        castShadow={AAA_FX}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
      />
      <hemisphereLight color="#dfe9f3" groundColor="#d6c9b2" intensity={0.65} />
      <DisplaySpots />
    </group>
  )
}
