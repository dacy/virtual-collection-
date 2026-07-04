import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { CanvasTexture, type WebGLRenderer } from 'three'
import { buildPedestalPiece, buildWallPiece, type StressPiece } from './pieces'
import { disposeObject, loadDroppedFile, orientPiece, type DroppedPiece } from './importDropped'
import { EnvironmentLight, PEDESTAL, Room, SLOTS, WALL_FIT_BOX } from './room'
import { WalkControls } from './WalkControls'
import { emptyStats, StatsCollector, StatsOverlay, type SpikeStats } from './stats'

const params = new URLSearchParams(window.location.search)
const TEX_SIZE = Number(params.get('tex')) || 2048
const SLOT_LIMIT = Math.min(Number(params.get('pieces')) || SLOTS.length, SLOTS.length)
const PEDESTAL_SLOT_COUNT = SLOTS.filter((s) => s.kind === 'pedestal').length

/** Per-slot manual placement tweaks, the same knobs the v1 slot editor
 *  will expose (rotationY, scaleAdjust, offsetY per the spec data model). */
interface Placement {
  rotationY: number
  scaleAdjust: number
  offsetY: number
}
const DEFAULT_PLACEMENT: Placement = { rotationY: 0, scaleAdjust: 1, offsetY: 0 }

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
 * the stand-ins pedestal by pedestal; Edit mode adjusts placement.
 */
export default function SpikePage() {
  const [pieces, setPieces] = useState<StressPiece[]>([])
  const [dropped, setDropped] = useState<ReadonlyArray<DroppedPiece | null>>(() =>
    new Array<DroppedPiece | null>(SLOTS.length).fill(null),
  )
  const [placements, setPlacements] = useState<Record<number, Placement>>({})
  const [mode, setMode] = useState<'walk' | 'edit'>('walk')
  const [selected, setSelected] = useState<number | null>(null)
  const [messages, setMessages] = useState<string[]>([])
  // orientation lives on the piece object itself; tick forces panel refresh
  const [, orientTick] = useState(0)
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
          setPlacements((prev) => ({ ...prev, [slot]: DEFAULT_PLACEMENT }))
          note(
            `${file.name}: ${(piece.triangles / 1000).toFixed(0)}k triangles → pedestal ${slot + 1}`,
          )
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

  const updatePlacement = useCallback(
    (slot: number, patch: Partial<Placement>) => {
      setPlacements((prev) => ({
        ...prev,
        [slot]: { ...(prev[slot] ?? DEFAULT_PLACEMENT), ...patch },
      }))
    },
    [],
  )

  /** Move the selected dropped piece to another pedestal (swap if taken). */
  const movePiece = useCallback((from: number, to: number) => {
    if (from === to) return
    setDropped((prev) => {
      const next = [...prev]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    setPlacements((prev) => ({
      ...prev,
      [from]: prev[to] ?? DEFAULT_PLACEMENT,
      [to]: prev[from] ?? DEFAULT_PLACEMENT,
    }))
    setSelected(to)
  }, [])

  const removePiece = useCallback((slot: number) => {
    setDropped((prev) => {
      const piece = prev[slot]
      if (!piece) return prev
      disposeObject(piece.object)
      const next = [...prev]
      next[slot] = null
      return next
    })
    setSelected(null)
  }, [])

  const onPedestalClick = useCallback(
    (slotIndex: number) => {
      if (mode !== 'edit') return
      if (selected !== null && dropped[selected] && slotIndex !== selected) {
        movePiece(selected, slotIndex)
      } else {
        setSelected(slotIndex)
      }
    },
    [mode, selected, dropped, movePiece],
  )

  const toggleMode = useCallback(() => {
    setMode((m) => (m === 'walk' ? 'edit' : 'walk'))
    setSelected(null)
  }, [])

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
          state.gl.toneMappingExposure = 1.15
        }}
        onPointerMissed={() => {
          if (mode === 'edit') setSelected(null)
        }}
      >
        <EnvironmentLight />
        <Room onPedestalClick={onPedestalClick} />
        {pieces.map((piece, i) => {
          const slot = slots[i]
          const [x, y, z] = slot.position
          const droppedHere = dropped[i]
          const adj = placements[i] ?? DEFAULT_PLACEMENT
          const selectable = mode === 'edit' && slot.kind === 'pedestal'
          return (
            <group key={slot.id} position={[x, y, z]} rotation-y={slot.rotationY}>
              <group
                rotation-y={adj.rotationY}
                onClick={
                  selectable
                    ? (e) => {
                        e.stopPropagation()
                        onPedestalClick(i)
                      }
                    : undefined
                }
              >
                {droppedHere ? (
                  <primitive
                    object={droppedHere.object}
                    scale={PEDESTAL.fitBox * adj.scaleAdjust}
                    position-y={PEDESTAL.height + adj.offsetY}
                  />
                ) : (
                  <mesh
                    geometry={piece.geometry}
                    scale={piece.scale * adj.scaleAdjust}
                    position-y={
                      piece.kind === 'pedestal'
                        ? PEDESTAL.height + piece.yOffset * adj.scaleAdjust + adj.offsetY
                        : undefined
                    }
                  >
                    <meshStandardMaterial map={piece.map} roughness={0.5} envMapIntensity={0.9} />
                  </mesh>
                )}
              </group>
              {slot.kind === 'pedestal' && (
                <mesh rotation-x={-Math.PI / 2} position-y={PEDESTAL.height + 0.005}>
                  <planeGeometry args={[PEDESTAL.fitBox * 1.6, PEDESTAL.fitBox * 1.6]} />
                  <meshBasicMaterial map={shadowMap} transparent depthWrite={false} />
                </mesh>
              )}
              {selected === i && (
                <mesh rotation-x={-Math.PI / 2} position-y={PEDESTAL.height + 0.01}>
                  <ringGeometry args={[PEDESTAL.fitBox * 0.62, PEDESTAL.fitBox * 0.72, 48]} />
                  <meshBasicMaterial color="#b08d57" transparent opacity={0.9} depthWrite={false} />
                </mesh>
              )}
            </group>
          )
        })}
        <WalkControls pointerLockEnabled={mode === 'walk'} />
        <StatsCollector out={statsRef} />
      </Canvas>
      <StatsOverlay statsRef={statsRef} pieceCount={pieces.length} totalPieces={slots.length} />
      <ModeToggle mode={mode} onToggle={toggleMode} />
      {mode === 'edit' && (
        <EditPanel
          selected={selected}
          piece={selected !== null ? (dropped[selected] ?? null) : null}
          placement={selected !== null ? (placements[selected] ?? DEFAULT_PLACEMENT) : null}
          onChange={(patch) => selected !== null && updatePlacement(selected, patch)}
          onOrient={(x, z) => {
            if (selected === null) return
            const piece = dropped[selected]
            if (!piece) return
            orientPiece(piece, x, z)
            orientTick((t) => t + 1)
          }}
          onRemove={() => selected !== null && removePiece(selected)}
        />
      )}
      <DropPanel messages={messages} onFiles={importFiles} />
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: 'rgba(10,10,14,0.82)',
  borderRadius: 8,
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
  padding: '10px 14px',
}

function ModeToggle({ mode, onToggle }: { mode: 'walk' | 'edit'; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        background: mode === 'edit' ? '#b08d57' : 'rgba(10,10,14,0.82)',
        color: mode === 'edit' ? '#16130e' : '#e8e8ec',
        border: '1px solid #b08d57',
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {mode === 'edit' ? 'Done editing' : 'Edit pieces'}
    </button>
  )
}

function EditPanel({
  selected,
  piece,
  placement,
  onChange,
  onOrient,
  onRemove,
}: {
  selected: number | null
  piece: DroppedPiece | null
  placement: Placement | null
  onChange: (patch: Partial<Placement>) => void
  onOrient: (x: number, z: number) => void
  onRemove: () => void
}) {
  if (selected === null || !placement) {
    return (
      <div style={{ ...panelStyle, position: 'fixed', top: 60, right: 12, opacity: 0.85 }}>
        Click a piece to select it
      </div>
    )
  }
  const isDropped = piece !== null
  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    key: keyof Placement,
  ) => (
    <label style={{ display: 'block', marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8 }}>
        <span>{label}</span>
        <span>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange({ [key]: Number(e.target.value) })}
        style={{ width: 200, accentColor: '#b08d57' }}
      />
    </label>
  )
  return (
    <div style={{ ...panelStyle, position: 'fixed', top: 60, right: 12 }}>
      <div style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {piece?.name ?? `Pedestal ${selected + 1} (stand-in)`}
      </div>
      {slider(
        'Turn',
        placement.rotationY,
        0,
        2 * Math.PI,
        Math.PI / 90,
        (v) => `${Math.round((v * 180) / Math.PI)}°`,
        'rotationY',
      )}
      {isDropped && (
        <>
          <OrientSlider
            label="Stand up (X)"
            value={piece.orientation.x}
            onChange={(x) => onOrient(x, piece.orientation.z)}
          />
          <OrientSlider
            label="Tilt (Z)"
            value={piece.orientation.z}
            onChange={(z) => onOrient(piece.orientation.x, z)}
          />
        </>
      )}
      {slider('Scale', placement.scaleAdjust, 0.4, 1.8, 0.02, (v) => `${Math.round(v * 100)}%`, 'scaleAdjust')}
      {slider('Height', placement.offsetY, 0, 0.3, 0.005, (v) => `${Math.round(v * 100)}cm`, 'offsetY')}
      {isDropped && (
        <>
          <div style={{ opacity: 0.6, marginTop: 8, maxWidth: 220 }}>
            Click another pedestal to move this piece there.
          </div>
          <button
            onClick={onRemove}
            style={{
              marginTop: 8,
              background: 'transparent',
              color: '#ff7b72',
              border: '1px solid #ff7b72',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            Remove piece
          </button>
        </>
      )}
    </div>
  )
}

/** X/Z upright-fix slider in degrees; snaps near the common 90° stops. */
function OrientSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (radians: number) => void
}) {
  const deg = (value * 180) / Math.PI
  return (
    <label style={{ display: 'block', marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8 }}>
        <span>{label}</span>
        <span>{Math.round(deg)}°</span>
      </div>
      <input
        type="range"
        min={-180}
        max={180}
        step={1}
        value={deg}
        onChange={(e) => {
          let d = Number(e.target.value)
          const snap = [-180, -90, 0, 90, 180].find((s) => Math.abs(d - s) <= 4)
          if (snap !== undefined) d = snap
          onChange((d * Math.PI) / 180)
        }}
        style={{ width: 200, accentColor: '#b08d57' }}
      />
    </label>
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
