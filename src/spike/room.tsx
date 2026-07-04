import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { CanvasTexture, PMREMGenerator, RepeatWrapping, SRGBColorSpace } from 'three'
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
    position: [x, 1.7, -ROOM.depth / 2 + 0.03],
    rotationY: 0,
  })),
  ...[-3, 3].map<SpikeSlot>((x, i) => ({
    id: `wall_s_${i}`,
    kind: 'wall',
    position: [x, 1.7, ROOM.depth / 2 - 0.03],
    rotationY: Math.PI,
  })),
]

/** Cylinder colliders the walk controller pushes out of. */
export const COLLIDERS = SLOTS.filter((s) => s.kind === 'pedestal').map((s) => ({
  x: s.position[0],
  z: s.position[2],
  radius: PEDESTAL.size * 0.75 + 0.25,
}))

/** Procedural IBL (three's RoomEnvironment) — believable reflections on the
 *  dynamic pieces with zero network fetches, standing in for the baked room's
 *  environment map. */
export function EnvironmentLight() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

function makeFloorTexture(): CanvasTexture {
  const rand = mulberry32(7)
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#8a7a68'
  ctx.fillRect(0, 0, 512, 512)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const l = 46 + rand() * 10
      ctx.fillStyle = `hsl(${28 + rand() * 8}, ${18 + rand() * 8}%, ${l}%)`
      ctx.fillRect(x * 64 + 1, y * 64 + 1, 62, 62)
    }
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.repeat.set(6, 4)
  tex.anisotropy = 8
  return tex
}

export function Room() {
  const floorMap = useMemo(makeFloorTexture, [])
  const { width, depth, height } = ROOM
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={floorMap} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, height, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#e6e2da" roughness={0.95} />
      </mesh>
      {/* four walls */}
      <mesh position={[0, height / 2, -depth / 2]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#ded9d0" roughness={0.9} />
      </mesh>
      <mesh position={[0, height / 2, depth / 2]} rotation-y={Math.PI}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#ded9d0" roughness={0.9} />
      </mesh>
      <mesh position={[-width / 2, height / 2, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color="#d5d0c7" roughness={0.9} />
      </mesh>
      <mesh position={[width / 2, height / 2, 0]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color="#d5d0c7" roughness={0.9} />
      </mesh>
      {/* pedestals */}
      {SLOTS.filter((s) => s.kind === 'pedestal').map((s) => (
        <mesh key={s.id} position={[s.position[0], PEDESTAL.height / 2, s.position[2]]}>
          <boxGeometry args={[PEDESTAL.size, PEDESTAL.height, PEDESTAL.size]} />
          <meshStandardMaterial color="#2e2e33" roughness={0.4} metalness={0.1} />
        </mesh>
      ))}
      {/* no realtime shadows, per spec: a few plain lights + IBL */}
      <ambientLight intensity={0.35} />
      <pointLight position={[-3, height - 0.3, 0]} intensity={22} decay={2} />
      <pointLight position={[3, height - 0.3, 0]} intensity={22} decay={2} />
      <pointLight position={[0, height - 0.3, -2.2]} intensity={14} decay={2} />
      <pointLight position={[0, height - 0.3, 2.2]} intensity={14} decay={2} />
    </group>
  )
}
