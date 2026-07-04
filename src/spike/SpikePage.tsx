import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { CanvasTexture, type WebGLRenderer } from 'three'
import { buildPedestalPiece, buildWallPiece, type StressPiece } from './pieces'
import { disposeObject, loadDroppedFile, type DroppedPiece } from './importDropped'
import { EnvironmentLight, PEDESTAL, Room, SLOTS, WALL_FIT_BOX } from './room'
import { WalkControls } from './WalkControls'
import { emptyStats, StatsCollector, StatsOverlay, type SpikeStats } from './stats'

const params = new URLSearchParams(window.location.search)
const TEX_SIZE = Number(params.get('tex')) || 2048
const SLOT_LIMIT = Math.min(Number(params.get('pieces')) || SLOTS.length, SLOTS.length)
const PEDESTAL_SLOT_COUNT = SLOTS.filter((s) => s.kind === 'pedestal').length

function makeContactShadowTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128)
  g.addColorStop(0, 'rgba(0,0,0,0.45)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  return new CanvasTexture(c)
}

/**
 * Milestone 0: the populated-room performance proof from the design spec.
 * 20 slots filled with heavy procedural stand-ins for photogrammetry scans
 * (~3.3M triangles, unique 2k textures), walked in first person with a
 * live budget meter. Tune with ?tex=1024 and ?pieces=N.
 *
 * Drop your own GLB/GLTF/FBX/OBJ/STL files (or use the button) to replace
 * the stand-ins pedestal by pedestal and measure your real collection.
 */
export default function SpikePage() {
  const [pieces, setPieces] = useState<StressPiece[]>([])
  const [dropped, setDropped] = useState<ReadonlyArray<DroppedPiece | null>>(() =>
    new Array<DroppedPiece | null>(SLOTS.length).fill(null),
  )
  const [messages, setMessages] = useState<string[]>([])
  const nextDropSlot = useRef(0)
  const rendererRef = useRef<WebGLRenderer>()
  const piecesRef = useRef<StressPiece[]>([])
  const statsRef = useRef<SpikeStats>({ ...emptyStats })
  const shadowMap = useMemo(makeContactShadowTexture, [])
  const slots = useMemo(() => SLOTS.slice(0, SLOT_LIMIT), [])

  useEffect(() => {
    let cancelled = false
    const built: StressPiece[] = []
    const buildNext = (i: number) => {
      if (cancelled || i >= slots.length) return
      const slot = slots[i]
      built.push(
        slot.kind === 'pedestal'
          ? buildPedestalPiece(i, TEX_SIZE, PEDESTAL.fitBox)
          : buildWallPiece(i, TEX_SIZE, WALL_FIT_BOX),
      )
      piecesRef.current = built
      setPieces([...built])
      // yield to the frame loop so the page stays responsive while building
      setTimeout(() => buildNext(i + 1), 0)
    }
    buildNext(0)
    return () => {
      cancelled = true
      for (const p of built) {
        p.geometry.dispose()
        p.map.dispose()
      }
    }
  }, [slots])

  const note = useCallback((text: string) => {
    setMessages((prev) => [...prev.slice(-3), text])
  }, [])

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        try {
          const piece = await loadDroppedFile(file, rendererRef.current)
          // fill pedestals in order, cycling once all are taken
          const slot = nextDropSlot.current % Math.min(PEDESTAL_SLOT_COUNT, SLOT_LIMIT)
          nextDropSlot.current += 1
          setDropped((prev) => {
            const replaced = prev[slot]
            if (replaced) {
              disposeObject(replaced.object)
            } else {
              // free the procedural stand-in this drop displaces, so the
              // VRAM readout reflects only what's actually in the room
              const proc = piecesRef.current[slot]
              proc?.geometry.dispose()
              proc?.map.dispose()
            }
            const next = [...prev]
            next[slot] = piece
            return next
          })
          note(`${file.name}: ${(piece.triangles / 1000).toFixed(0)}k triangles → pedestal ${slot + 1}`)
        } catch (err) {
          note(err instanceof Error ? err.message : String(err))
        }
      }
    },
    [note],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files)
    },
    [importFiles],
  )

  return (
    <div
      style={{ height: '100%', position: 'relative' }}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <Canvas
        dpr={Math.min(window.devicePixelRatio, 2)}
        camera={{ fov: 70, near: 0.05, far: 60 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={(state) => {
          rendererRef.current = state.gl
        }}
      >
        <EnvironmentLight />
        <Room />
        {pieces.map((piece, i) => {
          const slot = slots[i]
          const [x, y, z] = slot.position
          const droppedHere = dropped[i]
          return (
            <group key={slot.id} position={[x, y, z]} rotation-y={slot.rotationY}>
              {droppedHere ? (
                <primitive
                  object={droppedHere.object}
                  scale={PEDESTAL.fitBox}
                  position-y={PEDESTAL.height}
                />
              ) : (
                <mesh
                  geometry={piece.geometry}
                  scale={piece.scale}
                  position-y={
                    piece.kind === 'pedestal' ? PEDESTAL.height + piece.yOffset : undefined
                  }
                >
                  <meshStandardMaterial map={piece.map} roughness={0.5} envMapIntensity={0.9} />
                </mesh>
              )}
              {slot.kind === 'pedestal' && (
                <mesh rotation-x={-Math.PI / 2} position-y={PEDESTAL.height + 0.005}>
                  <planeGeometry args={[PEDESTAL.fitBox * 1.6, PEDESTAL.fitBox * 1.6]} />
                  <meshBasicMaterial map={shadowMap} transparent depthWrite={false} />
                </mesh>
              )}
            </group>
          )
        })}
        <WalkControls />
        <StatsCollector out={statsRef} />
      </Canvas>
      <StatsOverlay statsRef={statsRef} pieceCount={pieces.length} totalPieces={slots.length} />
      <DropPanel messages={messages} onFiles={importFiles} />
    </div>
  )
}

function DropPanel({
  messages,
  onFiles,
}: {
  messages: string[]
  onFiles: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        maxWidth: 'min(440px, 90vw)',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {messages.map((m, i) => (
        <div
          key={i}
          style={{
            background: 'rgba(10,10,14,0.75)',
            borderRadius: 6,
            padding: '4px 10px',
            marginBottom: 4,
          }}
        >
          {m}
        </div>
      ))}
      <button
        onClick={() => inputRef.current?.click()}
        style={{
          background: '#b08d57',
          color: '#16130e',
          border: 'none',
          borderRadius: 6,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Display your own models…
      </button>
      <span style={{ opacity: 0.6, marginLeft: 10 }}>or drag files anywhere</span>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".glb,.gltf,.fbx,.obj,.stl"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}
