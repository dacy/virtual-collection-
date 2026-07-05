import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
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
  type BufferAttribute,
  type BufferGeometry,
  type InstancedMesh,
  type SpotLight as SpotLightImpl,
} from 'three'
import { mulberry32 } from './rng'
import { useFlags } from './quality'
import {
  BENCHES,
  BENCH_SEAT,
  PEDESTAL_SLOTS,
  ROOM,
  SLOTS,
  WALL_FIT_BOX,
  type PedestalConfig,
} from './layout'
import { PedestalUnit } from './pedestals'
import {
  makePlaqueTexture,
  makeRugTexture,
  makeShaftTexture,
  makeSkyTexture,
  makeSlatTexture,
  makeTreelineTexture,
  makeWainscotTexture,
  makeWoodTexture,
} from './textures'

// Everything the tests and the rest of the app need from the layout is
// re-exported here so `./room` stays the module of record for the scene.
export * from './layout'

// HDR (>1) colors so the bloom pass picks these up as light sources
const COVE_HDR = new Color('#ffc98f').multiplyScalar(1.6)
const FIXTURE_LENS_HDR = new Color('#ffe3c2').multiplyScalar(4)
const SKY_HDR = new Color('#cfe6ff').multiplyScalar(2.4)
const SUN_HDR = new Color('#fff3d2').multiplyScalar(18)

/** Direction of parallel sunlight (matches the directional light below). */
const SUN_POSITION: [number, number, number] = [3.5, 6, 8]
const SUN_DIR = new Vector3(-SUN_POSITION[0], -SUN_POSITION[1], -SUN_POSITION[2]).normalize()

/** The three tall south-wall windows: center x, width, sill and head heights. */
const WINDOWS = { xs: [-3.4, 0, 3.4], width: 1.9, sill: 0.8, head: 3.4 }

/** Daylight rig baked into the environment map: a wide window band on the
 *  south side, a hot sun disc, an overhead skylight strip, bright shell and
 *  warm floor bounce. This is what glass, brass, marble and glossy pieces
 *  reflect. Basic materials act as emitters in the PMREM bake; colors above
 *  1.0 are intentional. */
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

  // tall window band through the south wall + a hot sun disc
  emitter(new PlaneGeometry(13, 4), new Color('#cfe6ff').multiplyScalar(3), [0, 2.2, 9.8], [0, Math.PI, 0])
  emitter(new PlaneGeometry(2, 2), new Color('#fff3d2').multiplyScalar(22), [4, 6.5, 9.7], [0, Math.PI, 0])
  // skylight strip overhead, warm ceiling wash, floor bounce
  emitter(new PlaneGeometry(5, 2.4), new Color('#dceafc').multiplyScalar(3.2), [0, 9.8, 0], [Math.PI / 2, 0, 0])
  emitter(new PlaneGeometry(8, 8), new Color('#fff0dc').multiplyScalar(1.4), [3, 9.7, 3], [Math.PI / 2, 0, 0])
  emitter(new PlaneGeometry(18, 18), new Color('#b3a48f').multiplyScalar(1.2), [0, -1.9, 0], [-Math.PI / 2, 0, 0])

  return scene
}

/** Bakes the environment map; re-bakes when `epoch` changes (the render
 *  target's contents are GPU-only, so a context loss wipes it — the guard
 *  bumps epoch on restore). */
export function EnvironmentLight({ epoch = 0 }: { epoch?: number }) {
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
  }, [gl, scene, epoch])
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
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(110, 108, 100, ${0.07 + rand() * 0.09})`
    ctx.lineWidth = 0.6 + rand() * 1.1
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
  ctx.strokeStyle = 'rgba(40, 40, 42, 0.18)'
  ctx.lineWidth = 2
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
  tex.repeat.set(6, 4)
  tex.anisotropy = 8
  return tex
}

/** Marble floor; on ultra it becomes a real planar reflector (extra scene
 *  render) so pedestals, glass and the windows mirror in the polish. */
function Floor({ reflections }: { reflections: boolean }) {
  const floorMap = useMemo(makeMarbleFloorTexture, [])
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[ROOM.width, ROOM.depth]} />
      {reflections ? (
        <MeshReflectorMaterial
          map={floorMap}
          resolution={1024}
          mirror={0.55}
          mixStrength={0.65}
          mixBlur={0.9}
          blur={[280, 80]}
          depthScale={0.6}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          roughness={0.35}
          metalness={0.02}
        />
      ) : (
        <meshStandardMaterial map={floorMap} roughness={0.2} metalness={0.05} />
      )}
    </mesh>
  )
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
        distance={8}
        decay={2}
      />
    </>
  )
}

/** Museum-style lighting: every display gets its own narrow overhead spot,
 *  aimed at the top of its (possibly per-slot adjusted) pedestal. */
function DisplaySpots({ pedestals }: { pedestals: Record<number, PedestalConfig> }) {
  return (
    <>
      {SLOTS.map((s, i) => {
        if (s.kind === 'pedestal') {
          const cfg = pedestals[i]
          if (!cfg) return null
          return (
            <CeilingSpot
              key={`spot_${s.id}`}
              position={[s.position[0], ROOM.height - 0.3, s.position[2]]}
              target={[s.position[0], cfg.height, s.position[2]]}
              intensity={6}
              angle={0.5}
            />
          )
        }
        // hang the accent light out along the art's facing normal
        const nx = Math.sin(s.rotationY)
        const nz = Math.cos(s.rotationY)
        return (
          <CeilingSpot
            key={`spot_${s.id}`}
            position={[s.position[0] + nx * 1.4, ROOM.height - 0.2, s.position[2] + nz * 1.4]}
            target={[s.position[0], s.position[1], s.position[2]]}
            intensity={5}
            angle={0.38}
          />
        )
      })}
    </>
  )
}

/** Ceiling-mounted track fixtures over every pedestal: stem, housing and a
 *  glowing lens (HDR so bloom halos it). Instanced — 3 draws for all 16. */
function Fixtures() {
  const stem = useRef<InstancedMesh>(null)
  const housing = useRef<InstancedMesh>(null)
  const lens = useRef<InstancedMesh>(null)
  const n = PEDESTAL_SLOTS.length

  useEffect(() => {
    const m = new Matrix4()
    const lensM = new Matrix4()
    const faceDown = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    const one = new Vector3(1, 1, 1)
    PEDESTAL_SLOTS.forEach((s, i) => {
      const [x, , z] = s.position
      stem.current!.setMatrixAt(i, m.makeTranslation(x, ROOM.height - 0.075, z))
      housing.current!.setMatrixAt(i, m.makeTranslation(x, ROOM.height - 0.22, z))
      lensM.compose(new Vector3(x, ROOM.height - 0.292, z), faceDown, one)
      lens.current!.setMatrixAt(i, lensM)
    })
    for (const ref of [stem, housing, lens]) ref.current!.instanceMatrix.needsUpdate = true
  }, [])

  return (
    <>
      <instancedMesh ref={stem} args={[undefined, undefined, n]}>
        <cylinderGeometry args={[0.012, 0.012, 0.15, 8]} />
        <meshStandardMaterial color="#141518" roughness={0.5} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={housing} args={[undefined, undefined, n]}>
        <cylinderGeometry args={[0.055, 0.075, 0.14, 16]} />
        <meshStandardMaterial color="#0c0d0f" roughness={0.5} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={lens} args={[undefined, undefined, n]}>
        <circleGeometry args={[0.05, 16]} />
        <meshBasicMaterial color={FIXTURE_LENS_HDR} />
      </instancedMesh>
    </>
  )
}

/** South wall: three tall mullioned windows with real glass, deep piers,
 *  and a layered exterior (lawn, treeline, gradient sky, HDR sun disc). */
function WindowWall() {
  const { width, depth, height } = ROOM
  const { xs, width: ww, sill, head } = WINDOWS
  const z = depth / 2
  const wallMat = <meshStandardMaterial color="#e8e3d9" roughness={0.85} />
  const skyMap = useMemo(makeSkyTexture, [])
  const treeMap = useMemo(makeTreelineTexture, [])
  const spans: Array<[number, number]> = []
  let cursor = -width / 2
  for (const x of xs) {
    spans.push([cursor, x - ww / 2])
    cursor = x + ww / 2
  }
  spans.push([cursor, width / 2])

  return (
    <group>
      {/* solid band below the sills and above the heads */}
      <mesh position={[0, sill / 2, z + 0.075]} receiveShadow castShadow>
        <boxGeometry args={[width, sill, 0.15]} />
        {wallMat}
      </mesh>
      <mesh position={[0, (head + height) / 2, z + 0.075]} receiveShadow>
        <boxGeometry args={[width, height - head, 0.15]} />
        {wallMat}
      </mesh>
      {/* piers between and beside the windows */}
      {spans.map(([a, b], i) => (
        <mesh
          key={`pier${i}`}
          position={[(a + b) / 2, (sill + head) / 2, z + 0.075]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[Math.max(b - a, 0.01), head - sill, 0.15]} />
          {wallMat}
        </mesh>
      ))}
      {/* each window: casing, protruding sill board, muntin grid, glass */}
      {xs.map((x) => (
        <group key={`win${x}`} position={[x, 0, z]}>
          <mesh position={[0, head + 0.045, 0.06]} castShadow>
            <boxGeometry args={[ww + 0.18, 0.09, 0.2]} />
            <meshStandardMaterial color="#f2efe8" roughness={0.7} />
          </mesh>
          <mesh position={[0, sill - 0.03, 0.03]} castShadow>
            <boxGeometry args={[ww + 0.18, 0.07, 0.26]} />
            <meshStandardMaterial color="#f2efe8" roughness={0.7} />
          </mesh>
          {[-ww / 2 - 0.035, ww / 2 + 0.035].map((jx) => (
            <mesh key={`jamb${jx}`} position={[jx, (sill + head) / 2, 0.06]} castShadow>
              <boxGeometry args={[0.09, head - sill + 0.1, 0.2]} />
              <meshStandardMaterial color="#f2efe8" roughness={0.7} />
            </mesh>
          ))}
          {/* muntins: one vertical, two horizontal — six panes */}
          <mesh position={[0, (sill + head) / 2, 0.05]} castShadow>
            <boxGeometry args={[0.045, head - sill, 0.09]} />
            <meshStandardMaterial color="#3d3f44" roughness={0.4} metalness={0.4} />
          </mesh>
          {[1 / 3, 2 / 3].map((f) => (
            <mesh key={`mh${f}`} position={[0, sill + (head - sill) * f, 0.05]} castShadow>
              <boxGeometry args={[ww, 0.045, 0.09]} />
              <meshStandardMaterial color="#3d3f44" roughness={0.4} metalness={0.4} />
            </mesh>
          ))}
          <mesh position={[0, (sill + head) / 2, 0.02]}>
            <planeGeometry args={[ww, head - sill]} />
            <meshPhysicalMaterial
              color="#dfeef2"
              transparent
              opacity={0.12}
              roughness={0.02}
              metalness={0}
              clearcoat={1}
              clearcoatRoughness={0.03}
              envMapIntensity={2.5}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
      {/* the outdoors, layered back to front */}
      <mesh position={[0, -0.02, z + 8]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[34, 16]} />
        <meshStandardMaterial color="#67784e" roughness={1} />
      </mesh>
      <mesh position={[0, 2.2, z + 5.5]} rotation-y={Math.PI}>
        <planeGeometry args={[26, 4.4]} />
        <meshBasicMaterial map={treeMap} transparent side={DoubleSide} />
      </mesh>
      <mesh position={[0, 5.4, z + 9]} rotation-y={Math.PI}>
        <planeGeometry args={[34, 15]} />
        <meshBasicMaterial map={skyMap} />
      </mesh>
      <mesh position={[4, 6, z + 7]} rotation-y={Math.PI}>
        <circleGeometry args={[0.75, 24]} />
        <meshBasicMaterial color={SUN_HDR} />
      </mesh>
      <mesh position={[0, 3.4, z + 8.9]} rotation-y={Math.PI}>
        <planeGeometry args={[34, 1.2]} />
        <meshBasicMaterial color={SKY_HDR} />
      </mesh>
    </group>
  )
}

/** North / east / west walls with baked-relief wainscot, chair rail,
 *  baseboard and crown molding; pilasters give the long walls rhythm. */
function Walls() {
  const { width, depth, height } = ROOM
  const wainscotH = 1.06

  const walls: Array<{
    key: string
    pos: [number, number, number]
    rotY: number
    len: number
  }> = [
    { key: 'n', pos: [0, 0, -depth / 2], rotY: 0, len: width },
    { key: 'w', pos: [-width / 2, 0, 0], rotY: Math.PI / 2, len: depth },
    { key: 'e', pos: [width / 2, 0, 0], rotY: -Math.PI / 2, len: depth },
  ]

  return (
    <group>
      {walls.map((w) => (
        <group key={w.key} position={w.pos} rotation-y={w.rotY}>
          {/* plaster field */}
          <mesh position-y={height / 2} receiveShadow>
            <planeGeometry args={[w.len, height]} />
            <meshStandardMaterial color="#e6e1d6" roughness={0.85} />
          </mesh>
          <Wainscot len={w.len} height={wainscotH} />
          {/* chair rail + crown molding */}
          <mesh position={[0, wainscotH + 0.014, 0.045]}>
            <boxGeometry args={[w.len, 0.028, 0.028]} />
            <meshStandardMaterial color="#b08d57" roughness={0.3} metalness={0.85} />
          </mesh>
          <mesh position={[0, height - 0.09, 0.035]}>
            <boxGeometry args={[w.len, 0.18, 0.07]} />
            <meshStandardMaterial color="#f2efe8" roughness={0.7} />
          </mesh>
        </group>
      ))}
      {/* baseboards on all four walls */}
      {([
        [0, -depth / 2 + 0.015, width, 0],
        [0, depth / 2 - 0.015, width, 0],
        [-width / 2 + 0.015, 0, depth, Math.PI / 2],
        [width / 2 - 0.015, 0, depth, Math.PI / 2],
      ] as const).map(([x, z, len, rot], i) => (
        <mesh key={`bb${i}`} position={[x, 0.07, z]} rotation-y={rot}>
          <boxGeometry args={[len, 0.14, 0.032]} />
          <meshStandardMaterial color="#f2efe8" roughness={0.6} />
        </mesh>
      ))}
      {/* pilasters framing the feature wall and the east door */}
      {([
        [-1.75, -depth / 2 + 0.07, 0],
        [1.75, -depth / 2 + 0.07, 0],
        [width / 2 - 0.07, -1.3, Math.PI / 2],
        [width / 2 - 0.07, 1.3, Math.PI / 2],
      ] as const).map(([x, z, rot], i) => (
        <group key={`pil${i}`} position={[x, 0, z]} rotation-y={rot}>
          <mesh position-y={height / 2 - 0.1} castShadow receiveShadow>
            <boxGeometry args={[0.24, height - 0.2, 0.12]} />
            <meshStandardMaterial color="#efece4" roughness={0.75} />
          </mesh>
          <mesh position-y={height - 0.24}>
            <boxGeometry args={[0.32, 0.09, 0.18]} />
            <meshStandardMaterial color="#f2efe8" roughness={0.7} />
          </mesh>
          <mesh position-y={0.1}>
            <boxGeometry args={[0.32, 0.2, 0.18]} />
            <meshStandardMaterial color="#f2efe8" roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Wainscot band with panel relief baked into the texture (one draw). */
function Wainscot({ len, height }: { len: number; height: number }) {
  const map = useMemo(() => {
    const tex = makeWainscotTextureCached()
    const t = tex.clone()
    t.repeat.set(Math.round(len / 0.75), 1)
    t.needsUpdate = true
    return t
  }, [len])
  return (
    <mesh position={[0, height / 2, 0.02]} receiveShadow>
      <planeGeometry args={[len, height]} />
      <meshStandardMaterial map={map} roughness={0.6} />
    </mesh>
  )
}

let wainscotTex: CanvasTexture | null = null
function makeWainscotTextureCached(): CanvasTexture {
  if (!wainscotTex) wainscotTex = makeWainscotTexture()
  return wainscotTex
}

/** Coffered ceiling with a recessed linear skylight and warm cove strips. */
function Ceiling() {
  const { width, depth, height } = ROOM
  const sky = { w: 4.6, d: 1.8, shaft: 0.5 }
  const mat = <meshStandardMaterial color="#f4f2ec" roughness={0.95} />

  return (
    <group>
      {/* ceiling field in four planes around the skylight opening */}
      <mesh rotation-x={Math.PI / 2} position={[0, height, -(sky.d / 2 + (depth / 2 - sky.d / 2) / 2)]}>
        <planeGeometry args={[width, depth / 2 - sky.d / 2]} />
        {mat}
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, height, sky.d / 2 + (depth / 2 - sky.d / 2) / 2]}>
        <planeGeometry args={[width, depth / 2 - sky.d / 2]} />
        {mat}
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`cf${side}`}
          rotation-x={Math.PI / 2}
          position={[side * (sky.w / 2 + (width / 2 - sky.w / 2) / 2), height, 0]}
        >
          <planeGeometry args={[width / 2 - sky.w / 2, sky.d]} />
          {mat}
        </mesh>
      ))}
      {/* skylight shaft walls + sky above */}
      {[-1, 1].map((side) => (
        <mesh key={`sw${side}`} position={[0, height + sky.shaft / 2, side * (sky.d / 2)]}>
          <boxGeometry args={[sky.w, sky.shaft, 0.04]} />
          <meshStandardMaterial color="#f7f5ef" roughness={0.9} side={DoubleSide} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`se${side}`} position={[side * (sky.w / 2), height + sky.shaft / 2, 0]}>
          <boxGeometry args={[0.04, sky.shaft, sky.d]} />
          <meshStandardMaterial color="#f7f5ef" roughness={0.9} side={DoubleSide} />
        </mesh>
      ))}
      <mesh rotation-x={Math.PI / 2} position={[0, height + sky.shaft - 0.01, 0]}>
        <planeGeometry args={[sky.w, sky.d]} />
        <meshBasicMaterial color={SKY_HDR} />
      </mesh>
      {/* skylight trim */}
      {[-1, 1].map((side) => (
        <mesh key={`st${side}`} position={[0, height - 0.02, side * (sky.d / 2 + 0.05)]}>
          <boxGeometry args={[sky.w + 0.2, 0.06, 0.1]} />
          <meshStandardMaterial color="#e7e4dc" roughness={0.9} />
        </mesh>
      ))}
      {/* coffer beam grid, clear of the skylight */}
      {[-2.9, -1.4, 1.4, 2.9].map((z) => (
        <mesh key={`bx${z}`} position={[0, height - 0.09, z]}>
          <boxGeometry args={[width, 0.18, 0.22]} />
          <meshStandardMaterial color="#e7e4dc" roughness={0.9} />
        </mesh>
      ))}
      {[-4.9, -2.9, 2.9, 4.9].map((x) => (
        <mesh key={`bz${x}`} position={[x, height - 0.09, 0]}>
          <boxGeometry args={[0.22, 0.18, depth]} />
          <meshStandardMaterial color="#e7e4dc" roughness={0.9} />
        </mesh>
      ))}
      {/* warm cove strips at the ceiling perimeter */}
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
      {/* lighting track rails above the pedestal rows */}
      {[-3.1, 0, 3.1].map((z) => (
        <mesh key={`rail${z}`} position={[0, height - 0.045, z]}>
          <boxGeometry args={[width - 0.8, 0.05, 0.09]} />
          <meshStandardMaterial color="#17181a" roughness={0.45} metalness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

/** Walnut slat feature panel with an engraved brass plaque, north center. */
function FeatureWall() {
  const { depth } = ROOM
  const slatMap = useMemo(() => {
    const t = makeSlatTexture()
    t.repeat.set(4, 2)
    return t
  }, [])
  const plaqueMap = useMemo(() => makePlaqueTexture('THE COLLECTION'), [])
  return (
    <group position={[0, 0, -depth / 2 + 0.04]}>
      <mesh position-y={1.85} receiveShadow>
        <boxGeometry args={[2.9, 3.7, 0.07]} />
        <meshStandardMaterial map={slatMap} roughness={0.55} />
      </mesh>
      <mesh position={[0, 2.15, 0.045]}>
        <boxGeometry args={[1.15, 0.29, 0.02]} />
        <meshStandardMaterial map={plaqueMap} roughness={0.3} metalness={0.75} />
      </mesh>
    </group>
  )
}

/** Closed double door with casing and brass pulls, east wall center. */
function DoorEast() {
  const { width } = ROOM
  const woodMap = useMemo(() => makeWoodTexture(6, false), [])
  return (
    <group position={[width / 2 - 0.03, 0, 0]} rotation-y={-Math.PI / 2}>
      <mesh position={[0, 2.46, 0.02]}>
        <boxGeometry args={[2.0, 0.16, 0.12]} />
        <meshStandardMaterial color="#f2efe8" roughness={0.7} />
      </mesh>
      {[-0.97, 0.97].map((x) => (
        <mesh key={`case${x}`} position={[x, 1.2, 0.02]}>
          <boxGeometry args={[0.14, 2.4, 0.12]} />
          <meshStandardMaterial color="#f2efe8" roughness={0.7} />
        </mesh>
      ))}
      {[-0.45, 0.45].map((x) => (
        <mesh key={`leaf${x}`} position={[x, 1.19, -0.01]} receiveShadow>
          <boxGeometry args={[0.88, 2.38, 0.05]} />
          <meshStandardMaterial map={woodMap} roughness={0.5} />
        </mesh>
      ))}
      {[-0.09, 0.09].map((x) => (
        <mesh key={`pull${x}`} position={[x, 1.05, 0.035]}>
          <boxGeometry args={[0.025, 0.28, 0.025]} />
          <meshStandardMaterial color="#b08d57" roughness={0.25} metalness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

/** Visitor benches: walnut slab, leather cushion, brass side frames. */
function Benches() {
  const woodMap = useMemo(() => makeWoodTexture(4, false), [])
  return (
    <>
      {BENCHES.map((b, i) => (
        <group key={`bench${i}`} position={[b.x, 0, b.z]} rotation-y={b.rotationY}>
          <mesh position-y={BENCH_SEAT.height - 0.06} castShadow receiveShadow>
            <boxGeometry args={[BENCH_SEAT.length, 0.06, BENCH_SEAT.width]} />
            <meshStandardMaterial map={woodMap} roughness={0.45} />
          </mesh>
          <mesh position-y={BENCH_SEAT.height - 0.005} castShadow>
            <boxGeometry args={[BENCH_SEAT.length - 0.06, 0.05, BENCH_SEAT.width - 0.05]} />
            <meshStandardMaterial color="#3b332b" roughness={0.85} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={`leg${side}`}
              position={[side * (BENCH_SEAT.length / 2 - 0.1), (BENCH_SEAT.height - 0.09) / 2, 0]}
              castShadow
            >
              <boxGeometry args={[0.04, BENCH_SEAT.height - 0.09, BENCH_SEAT.width - 0.08]} />
              <meshStandardMaterial color="#a98a55" roughness={0.35} metalness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  )
}

/** Wool rug anchoring the center pedestal row. */
function Rug() {
  const map = useMemo(makeRugTexture, [])
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.006} receiveShadow>
      <planeGeometry args={[6.8, 2.2]} />
      <meshStandardMaterial map={map} roughness={1} polygonOffset polygonOffsetFactor={-1} />
    </mesh>
  )
}

/** Fake volumetric sun shafts: crossed additive gradient quads aligned with
 *  the sun direction, falling from each window and the skylight. */
function LightShafts() {
  const map = useMemo(makeShaftTexture, [])
  const shafts = useMemo(() => {
    const up = SUN_DIR.clone().negate()
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), up)
    const qCross = q
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))
    const list: Array<{ pos: Vector3; quat: Quaternion; w: number; l: number; o: number }> = []
    for (const x of WINDOWS.xs) {
      const wc = new Vector3(x, 2.2, ROOM.depth / 2 - 0.05)
      for (const quat of [q, qCross]) {
        list.push({ pos: wc.clone().addScaledVector(SUN_DIR, 1.9), quat, w: 1.8, l: 4.4, o: 0.28 })
      }
    }
    const sc = new Vector3(0, ROOM.height - 0.05, 0)
    for (const quat of [q, qCross]) {
      list.push({ pos: sc.clone().addScaledVector(SUN_DIR, 1.8), quat, w: 4.2, l: 4.0, o: 0.2 })
    }
    return list
  }, [])
  return (
    <>
      {shafts.map((s, i) => (
        <mesh key={`shaft${i}`} position={s.pos} quaternion={s.quat} renderOrder={20}>
          <planeGeometry args={[s.w, s.l]} />
          <meshBasicMaterial
            map={map}
            transparent
            opacity={s.o}
            depthWrite={false}
            side={DoubleSide}
            blending={AdditiveBlending}
          />
        </mesh>
      ))}
    </>
  )
}

/** Dust motes drifting in the sunlit half of the room — cheap life. */
function DustMotes() {
  const geomRef = useRef<BufferGeometry>(null)
  const data = useMemo(() => {
    const n = 320
    const rand = mulberry32(77)
    const base = new Float32Array(n * 3)
    const phase = new Float32Array(n)
    const speed = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      base[i * 3] = (rand() * 2 - 1) * 5.4
      base[i * 3 + 1] = 0.3 + rand() * 3.6
      base[i * 3 + 2] = -2 + rand() * 5.8
      phase[i] = rand() * Math.PI * 2
      speed[i] = 0.4 + rand() * 0.8
    }
    return { n, base, phase, speed, pos: base.slice() }
  }, [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const { n, base, phase, speed, pos } = data
    for (let i = 0; i < n; i++) {
      pos[i * 3] = base[i * 3] + Math.sin(t * speed[i] * 0.5 + phase[i]) * 0.18
      pos[i * 3 + 1] = 0.25 + ((((base[i * 3 + 1] - t * 0.025 * speed[i]) % 3.7) + 3.7) % 3.7)
      pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * speed[i] * 0.4 + phase[i]) * 0.14
    }
    const attr = geomRef.current?.attributes.position as BufferAttribute | undefined
    if (attr) {
      ;(attr.array as Float32Array).set(pos)
      attr.needsUpdate = true
    }
  })

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#ffe9c9"
        size={0.013}
        sizeAttenuation
        transparent
        opacity={0.3}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  )
}

export function Room({
  pedestals,
  onPedestalClick,
}: {
  pedestals: Record<number, PedestalConfig>
  onPedestalClick?: (slotIndex: number) => void
}) {
  const q = useFlags()
  const wallSlots = SLOTS.filter((s) => s.kind === 'wall')

  return (
    <group>
      <Floor reflections={q.floorReflections} />
      <Walls />
      <WindowWall />
      <Ceiling />
      <FeatureWall />
      <DoorEast />
      <Benches />
      <Rug />

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

      {SLOTS.map((s, i) =>
        s.kind === 'pedestal' && pedestals[i] ? (
          <PedestalUnit key={s.id} slotIndex={i} config={pedestals[i]} onClick={onPedestalClick} />
        ) : null,
      )}
      <Fixtures />

      {/* daylight: warm sun through the tall windows (one static shadow map,
          re-baked only when the scene changes), bright sky hemisphere with a
          warm floor-bounce ground color, plus soft display spots as accent */}
      <directionalLight
        key={`sun_${q.shadowMapSize}`}
        position={SUN_POSITION}
        color="#fff1da"
        intensity={3.0}
        castShadow={q.shadows}
        shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
      />
      <hemisphereLight color="#dfe9f3" groundColor="#d6c9b2" intensity={0.5} />
      <DisplaySpots pedestals={pedestals} />

      {q.lightShafts && <LightShafts />}
      {q.dustMotes && <DustMotes />}
    </group>
  )
}
