import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing'
import {
  CanvasTexture,
  Raycaster,
  Vector2,
  type Intersection,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import { buildPedestalPiece, buildWallPiece, type StressPiece } from './pieces'
import { disposeObject, loadDroppedFile, orientPiece, type DroppedPiece } from './importDropped'
import {
  DEFAULT_PEDESTALS_BY_INDEX,
  FURNITURE_COLLIDERS,
  PEDESTAL_HEIGHT_RANGE,
  PEDESTAL_SIZE_RANGE,
  PEDESTAL_STYLE_NAMES,
  SLOTS,
  WALL_FIT_BOX,
  fitBoxFor,
  pedestalColliders,
  pedestalTopFor,
  type PedestalConfig,
  type PedestalStyle,
} from './layout'
import { EnvironmentLight, Room } from './room'
import { WalkControls } from './WalkControls'
import {
  PRESET_NAMES,
  PRESET_ORDER,
  PRESETS,
  useFlags,
  useQuality,
  type QualityFlags,
  type QualityPreset,
} from './quality'
import { emptyStats, StatsCollector, StatsOverlay, type SpikeStats } from './stats'

const params = new URLSearchParams(window.location.search)
const TEX_SIZE = Number(params.get('tex')) || 2048
const SLOT_LIMIT = Math.min(Number(params.get('pieces')) || SLOTS.length, SLOTS.length)
const PEDESTAL_SLOT_COUNT = SLOTS.filter((s) => s.kind === 'pedestal').length

/** Per-slot manual placement tweaks, the same knobs the v1 slot editor
 *  will expose (rotationY, scaleAdjust, offsetY per the spec data model),
 *  plus the vitrine toggle. */
interface Placement {
  rotationY: number
  scaleAdjust: number
  offsetY: number
  glass: boolean
}
const DEFAULT_PLACEMENT: Placement = { rotationY: 0, scaleAdjust: 1, offsetY: 0, glass: true }

function makeContactShadowTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128)
  g.addColorStop(0, 'rgba(0,0,0,0.3)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  return new CanvasTexture(c)
}

/** Map a raycast hit to a slot index: pieces and pedestals carry slotIndex
 *  on an ancestor group. */
function slotFromHit(hit: Intersection): number | null {
  let node: Object3D | null = hit.object
  while (node) {
    if (typeof node.userData.slotIndex === 'number') return node.userData.slotIndex
    node = node.parent
  }
  return null
}

const SCREEN_CENTER = new Vector2(0, 0)

/** The sun and room are static, so the shadow map is baked once and only
 *  re-rendered when this component re-commits — i.e. whenever the page
 *  re-renders because pieces, pedestals or placements changed. */
function ShadowRefresh() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.shadowMap.needsUpdate = true
  })
  return null
}

/** Applies quality flags that live on the renderer itself. */
function QualityApplier({ epoch }: { epoch: number }) {
  const gl = useThree((s) => s.gl)
  const q = useFlags()
  useEffect(() => {
    gl.shadowMap.enabled = q.shadows
    gl.shadowMap.needsUpdate = true
  }, [gl, q.shadows, q.shadowMapSize, epoch])
  return null
}

/**
 * The fix for "screen flickers, then goes black and stays black": that is a
 * GPU driver reset (WebGL context loss) under load. preventDefault on the
 * lost event tells the browser we can recover; on restore we bump `epoch`,
 * which re-bakes the PMREM environment (its render target lives only in
 * GPU memory), re-renders the shadow map, and remounts the post stack.
 */
function ContextGuard({
  onLost,
  onRestored,
}: {
  onLost: () => void
  onRestored: () => void
}) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const canvas = gl.domElement
    const lost = (e: Event) => {
      e.preventDefault()
      onLost()
    }
    const restored = () => {
      gl.shadowMap.needsUpdate = true
      onRestored()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }, [gl, onLost, onRestored])
  return null
}

/** Watches sustained frame rate and steps the quality preset down before
 *  the GPU gets driven hard enough to flicker or reset. */
function PerfGovernor({ ready }: { ready: boolean }) {
  const acc = useRef({ time: 0, frames: 0, readySince: null as number | null, lastDrop: 0 })
  useFrame((_, delta) => {
    const s = useQuality.getState()
    if (!ready || !s.autoAdjust || s.preset === 'low') return
    const a = acc.current
    const now = performance.now()
    if (a.readySince === null) a.readySince = now
    a.time += delta
    a.frames += 1
    if (a.time < 4) return
    const fps = a.frames / a.time
    a.time = 0
    a.frames = 0
    // let load-in jank settle, and give each drop time to take effect
    if (now - a.readySince < 10_000 || now - a.lastDrop < 12_000) return
    if (fps < 25) {
      a.lastDrop = now
      s.dropPreset()
    }
  })
  return null
}

/** Walk-mode editing entry point: while pointer-locked, a click raycasts
 *  from the screen-center dot; hitting a piece or pedestal opens the edit
 *  panel for that slot without a trip through Esc + buttons. */
function ReticlePicker({ onPick }: { onPick: (slot: number) => void }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const raycaster = useMemo(() => {
    const r = new Raycaster()
    r.far = 10
    return r
  }, [])

  useEffect(() => {
    const el = gl.domElement
    const onDown = () => {
      if (document.pointerLockElement !== el) return
      raycaster.setFromCamera(SCREEN_CENTER, camera)
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        const slot = slotFromHit(hit)
        if (slot !== null) {
          onPick(slot)
          return
        }
      }
    }
    el.addEventListener('mousedown', onDown)
    return () => el.removeEventListener('mousedown', onDown)
  }, [gl, camera, scene, raycaster, onPick])
  return null
}

/** Display vitrine sized to its pedestal and piece. On high/ultra it is
 *  physically refractive glass (transmission); otherwise a cheap
 *  clearcoat-fresnel pane that still catches the environment. */
function GlassCase({
  config,
  caseHeight,
  refractive,
}: {
  config: PedestalConfig
  caseHeight: number
  refractive: boolean
}) {
  const top = pedestalTopFor(config)
  const w = config.size + 0.06
  return (
    <group>
      <mesh position-y={top + caseHeight / 2}>
        <boxGeometry args={[w, caseHeight, w]} />
        {refractive ? (
          <meshPhysicalMaterial
            color="#f4fbfd"
            transmission={1}
            thickness={0.02}
            ior={1.5}
            roughness={0.03}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.04}
            specularIntensity={1}
            envMapIntensity={1.2}
          />
        ) : (
          <meshPhysicalMaterial
            color="#eaf4f8"
            transparent
            opacity={0.12}
            roughness={0.03}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.06}
            specularIntensity={1}
            envMapIntensity={1.4}
            depthWrite={false}
          />
        )}
      </mesh>
      {/* slim dark base skirt grounds the pane on the slab */}
      <mesh position-y={top + 0.008}>
        <boxGeometry args={[w + 0.015, 0.016, w + 0.015]} />
        <meshStandardMaterial color="#1a1b1e" roughness={0.4} metalness={0.6} />
      </mesh>
    </group>
  )
}

/**
 * Milestone 0: the populated-room performance proof from the design spec.
 * 20 slots filled with heavy procedural stand-ins for photogrammetry scans
 * (~3.3M triangles, unique 2k textures), walked in first person with a
 * live budget meter. Tune with ?tex=1024, ?pieces=N and ?quality=low|…|ultra.
 *
 * Drop your own GLB/GLTF/FBX/OBJ/STL files (or use the button) to replace
 * the stand-ins; aim the center dot at a display and click to edit it.
 */
export default function SpikePage() {
  const [pieces, setPieces] = useState<StressPiece[]>([])
  const [dropped, setDropped] = useState<ReadonlyArray<DroppedPiece | null>>(() =>
    new Array<DroppedPiece | null>(SLOTS.length).fill(null),
  )
  const [placements, setPlacements] = useState<Record<number, Placement>>({})
  const [pedestals, setPedestals] = useState<Record<number, PedestalConfig>>(
    () => ({ ...DEFAULT_PEDESTALS_BY_INDEX }),
  )
  const [mode, setMode] = useState<'walk' | 'edit'>('walk')
  const [selected, setSelected] = useState<number | null>(null)
  const [messages, setMessages] = useState<string[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [contextLost, setContextLost] = useState(false)
  // bumped on context restore: re-bakes the environment, remounts the post stack
  const [glEpoch, setGlEpoch] = useState(0)
  // orientation lives on the piece object itself; tick forces panel refresh
  const [, orientTick] = useState(0)
  const nextDropSlot = useRef(0)
  const rendererRef = useRef<WebGLRenderer>()
  const piecesRef = useRef<StressPiece[]>([])
  const statsRef = useRef<SpikeStats>({ ...emptyStats })
  const shadowMap = useMemo(makeContactShadowTexture, [])
  const slots = useMemo(() => SLOTS.slice(0, SLOT_LIMIT), [])
  const q = useFlags()

  const colliders = useMemo(
    () => [...pedestalColliders(pedestals), ...FURNITURE_COLLIDERS],
    [pedestals],
  )

  useEffect(() => {
    let cancelled = false
    const built: StressPiece[] = []
    const buildNext = (i: number) => {
      if (cancelled || i >= slots.length) return
      const slot = slots[i]
      built.push(
        slot.kind === 'pedestal'
          ? // normalized to a unit box; scaled to each pedestal's fit box at render
            buildPedestalPiece(i, TEX_SIZE, 1)
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
    async (files: FileList | File[], targetSlot?: number) => {
      for (const file of Array.from(files)) {
        try {
          const piece = await loadDroppedFile(file, rendererRef.current)
          const slot =
            targetSlot ?? nextDropSlot.current % Math.min(PEDESTAL_SLOT_COUNT, SLOT_LIMIT)
          if (targetSlot === undefined) nextDropSlot.current += 1
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
          setPlacements((prev) => ({
            ...prev,
            [slot]: { ...DEFAULT_PLACEMENT, glass: prev[slot]?.glass ?? true },
          }))
          note(
            `${file.name}: ${(piece.triangles / 1000).toFixed(0)}k triangles → pedestal ${slot + 1}`,
          )
          // replacing via the panel: only the first file goes to the slot
          if (targetSlot !== undefined) break
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

  const updatePlacement = useCallback((slot: number, patch: Partial<Placement>) => {
    setPlacements((prev) => ({
      ...prev,
      [slot]: { ...(prev[slot] ?? DEFAULT_PLACEMENT), ...patch },
    }))
  }, [])

  const updatePedestal = useCallback((slot: number, patch: Partial<PedestalConfig>) => {
    setPedestals((prev) => ({
      ...prev,
      [slot]: { ...(prev[slot] ?? DEFAULT_PEDESTALS_BY_INDEX[slot]), ...patch },
    }))
  }, [])

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

  const onReticlePick = useCallback((slot: number) => {
    if (SLOTS[slot].kind !== 'pedestal') return
    document.exitPointerLock()
    setMode('edit')
    setSelected(slot)
  }, [])

  const toggleMode = useCallback(() => {
    setMode((m) => (m === 'walk' ? 'edit' : 'walk'))
    setSelected(null)
  }, [])

  const onContextLost = useCallback(() => setContextLost(true), [])
  const onContextRestored = useCallback(() => {
    setContextLost(false)
    setGlEpoch((e) => e + 1)
  }, [])

  // the composer is needed whenever any post effect is on; SMAA rides along
  // because the composer bypasses canvas MSAA
  const composerOn = q.post || q.ao !== 'off' || q.bloom
  const dpr = Math.min(window.devicePixelRatio || 1, q.dprCap)

  return (
    <div
      style={{ height: '100%', position: 'relative' }}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <Canvas
        dpr={dpr}
        camera={{ fov: 70, near: 0.05, far: 60 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        shadows="soft"
        onCreated={(state) => {
          rendererRef.current = state.gl
          state.gl.toneMappingExposure = 1.0
          // static sun: bake the shadow map on demand, not every frame
          state.gl.shadowMap.autoUpdate = false
          state.gl.shadowMap.needsUpdate = true
        }}
        onPointerMissed={() => {
          if (mode === 'edit') setSelected(null)
        }}
      >
        <ContextGuard onLost={onContextLost} onRestored={onContextRestored} />
        <QualityApplier epoch={glEpoch} />
        <PerfGovernor ready={pieces.length >= slots.length} />
        <EnvironmentLight epoch={glEpoch} />
        <Room pedestals={pedestals} onPedestalClick={onPedestalClick} />
        {pieces.map((piece, i) => {
          const slot = slots[i]
          const [x, y, z] = slot.position
          const droppedHere = dropped[i]
          const adj = placements[i] ?? DEFAULT_PLACEMENT
          const isPedestal = slot.kind === 'pedestal'
          const cfg = isPedestal ? pedestals[i] : undefined
          const fit = cfg ? fitBoxFor(cfg) : WALL_FIT_BOX
          const top = cfg ? pedestalTopFor(cfg) : 0
          const selectable = mode === 'edit' && isPedestal
          const caseHeight = Math.max(0.42, fit * adj.scaleAdjust + 0.18)
          return (
            <group
              key={slot.id}
              position={[x, y, z]}
              rotation-y={slot.rotationY}
              userData={{ slotIndex: i }}
              onClick={
                selectable
                  ? (e) => {
                      e.stopPropagation()
                      onPedestalClick(i)
                    }
                  : undefined
              }
            >
              <group rotation-y={adj.rotationY}>
                {droppedHere ? (
                  // the piece root's own transform holds the import
                  // normalization — fit/lift on a wrapper, never on the root
                  <group scale={fit * adj.scaleAdjust} position-y={top + adj.offsetY}>
                    <primitive object={droppedHere.object} />
                  </group>
                ) : (
                  <mesh
                    geometry={piece.geometry}
                    scale={piece.scale * (isPedestal ? fit : 1) * adj.scaleAdjust}
                    castShadow
                    position-y={
                      isPedestal
                        ? top + piece.yOffset * fit * adj.scaleAdjust + adj.offsetY
                        : undefined
                    }
                  >
                    <meshStandardMaterial map={piece.map} roughness={0.5} envMapIntensity={0.9} />
                  </mesh>
                )}
              </group>
              {isPedestal && (
                <mesh rotation-x={-Math.PI / 2} position-y={top + 0.003}>
                  <planeGeometry args={[fit * 1.6, fit * 1.6]} />
                  <meshBasicMaterial map={shadowMap} transparent depthWrite={false} />
                </mesh>
              )}
              {isPedestal && cfg && adj.glass && (
                <GlassCase config={cfg} caseHeight={caseHeight} refractive={q.refractiveGlass} />
              )}
              {selected === i && (
                <mesh rotation-x={-Math.PI / 2} position-y={top + 0.006}>
                  <ringGeometry args={[fit * 0.72, fit * 0.82, 48]} />
                  <meshBasicMaterial color="#b08d57" transparent opacity={0.9} depthWrite={false} />
                </mesh>
              )}
            </group>
          )
        })}
        <WalkControls pointerLockEnabled={mode === 'walk'} colliders={colliders} />
        <ReticlePicker onPick={onReticlePick} />
        <StatsCollector out={statsRef} />
        <ShadowRefresh />
        {composerOn && (
          // multisampling stays 0: composer MSAA + half-res AO is a known
          // flicker source on many GPUs — SMAA covers the edges instead
          <EffectComposer key={`fx_${glEpoch}`} multisampling={0}>
            {[
              ...(q.ao !== 'off'
                ? [<N8AO key="ao" aoRadius={0.35} intensity={3} halfRes={q.ao === 'half'} />]
                : []),
              ...(q.bloom
                ? [<Bloom key="bloom" mipmapBlur luminanceThreshold={1.2} intensity={0.35} />]
                : []),
              <Vignette key="vignette" offset={0.22} darkness={0.5} />,
              <SMAA key="smaa" />,
            ]}
          </EffectComposer>
        )}
      </Canvas>
      {mode === 'walk' && <Crosshair />}
      <StatsOverlay statsRef={statsRef} pieceCount={pieces.length} totalPieces={slots.length} />
      <ModeToggle mode={mode} onToggle={toggleMode} />
      {mode === 'edit' && (
        <EditPanel
          selected={selected}
          piece={selected !== null ? (dropped[selected] ?? null) : null}
          placement={selected !== null ? (placements[selected] ?? DEFAULT_PLACEMENT) : null}
          pedestal={selected !== null ? (pedestals[selected] ?? null) : null}
          onChange={(patch) => selected !== null && updatePlacement(selected, patch)}
          onPedestalChange={(patch) => selected !== null && updatePedestal(selected, patch)}
          onOrient={(x, z) => {
            if (selected === null) return
            const piece = dropped[selected]
            if (!piece) return
            orientPiece(piece, x, z)
            orientTick((t) => t + 1)
          }}
          onReplace={(files) => selected !== null && importFiles(files, selected)}
          onRemove={() => selected !== null && removePiece(selected)}
        />
      )}
      <DropPanel messages={messages} onFiles={importFiles} />
      <SettingsButton open={settingsOpen} onToggle={() => setSettingsOpen((o) => !o)} />
      {settingsOpen && <SettingsPanel />}
      <QualityToast />
      {contextLost && <ContextLostOverlay />}
    </div>
  )
}

function Crosshair() {
  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        width: 6,
        height: 6,
        marginLeft: -3,
        marginTop: -3,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.85)',
        boxShadow: '0 0 4px rgba(0,0,0,0.8)',
        pointerEvents: 'none',
      }}
    />
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

/** Generic labelled range input used by both panels. */
function RangeRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
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
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 200, accentColor: '#b08d57' }}
      />
    </label>
  )
}

function EditPanel({
  selected,
  piece,
  placement,
  pedestal,
  onChange,
  onPedestalChange,
  onOrient,
  onReplace,
  onRemove,
}: {
  selected: number | null
  piece: DroppedPiece | null
  placement: Placement | null
  pedestal: PedestalConfig | null
  onChange: (patch: Partial<Placement>) => void
  onPedestalChange: (patch: Partial<PedestalConfig>) => void
  onOrient: (x: number, z: number) => void
  onReplace: (files: File[]) => void
  onRemove: () => void
}) {
  const replaceInput = useRef<HTMLInputElement>(null)
  if (selected === null || !placement) {
    return (
      <div style={{ ...panelStyle, position: 'fixed', top: 60, right: 12, opacity: 0.85 }}>
        Click a piece to select it
      </div>
    )
  }
  const isDropped = piece !== null
  return (
    <div
      style={{
        ...panelStyle,
        position: 'fixed',
        top: 60,
        right: 12,
        maxHeight: 'calc(100vh - 84px)',
        overflowY: 'auto',
      }}
    >
      <div style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {piece?.name ?? `Pedestal ${selected + 1} (stand-in)`}
      </div>
      <button
        onClick={() => replaceInput.current?.click()}
        style={{
          marginTop: 8,
          background: '#b08d57',
          color: '#16130e',
          border: 'none',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          width: '100%',
        }}
      >
        {isDropped ? 'Change model…' : 'Display your model here…'}
      </button>
      <input
        ref={replaceInput}
        type="file"
        accept=".glb,.gltf,.fbx,.obj,.stl"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) onReplace(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
      <RangeRow
        label="Turn"
        value={placement.rotationY}
        min={0}
        max={2 * Math.PI}
        step={Math.PI / 90}
        format={(v) => `${Math.round((v * 180) / Math.PI)}°`}
        onChange={(v) => onChange({ rotationY: v })}
      />
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
      <RangeRow
        label="Scale"
        value={placement.scaleAdjust}
        min={0.4}
        max={1.8}
        step={0.02}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => onChange({ scaleAdjust: v })}
      />
      <RangeRow
        label="Lift"
        value={placement.offsetY}
        min={0}
        max={0.3}
        step={0.005}
        format={(v) => `${Math.round(v * 100)}cm`}
        onChange={(v) => onChange({ offsetY: v })}
      />
      <label style={{ display: 'flex', gap: 8, marginTop: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={placement.glass}
          onChange={(e) => onChange({ glass: e.target.checked })}
          style={{ accentColor: '#b08d57' }}
        />
        Glass case
      </label>
      {pedestal && (
        <>
          <div
            style={{
              marginTop: 12,
              paddingTop: 8,
              borderTop: '1px solid rgba(255,255,255,0.15)',
              fontWeight: 600,
            }}
          >
            Pedestal
          </div>
          <RangeRow
            label="Height"
            value={pedestal.height}
            min={PEDESTAL_HEIGHT_RANGE[0]}
            max={PEDESTAL_HEIGHT_RANGE[1]}
            step={0.01}
            format={(v) => `${v.toFixed(2)}m`}
            onChange={(v) => onPedestalChange({ height: v })}
          />
          <RangeRow
            label="Top size"
            value={pedestal.size}
            min={PEDESTAL_SIZE_RANGE[0]}
            max={PEDESTAL_SIZE_RANGE[1]}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}cm`}
            onChange={(v) => onPedestalChange({ size: v })}
          />
          <label style={{ display: 'block', marginTop: 8 }}>
            <div style={{ opacity: 0.8, marginBottom: 4 }}>Style</div>
            <select
              value={pedestal.style}
              onChange={(e) => onPedestalChange({ style: e.target.value as PedestalStyle })}
              style={{
                width: '100%',
                background: '#1c1d22',
                color: '#e8e8ec',
                border: '1px solid #b08d57',
                borderRadius: 6,
                padding: '5px 8px',
                fontSize: 13,
              }}
            >
              {Object.entries(PEDESTAL_STYLE_NAMES).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
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

function SettingsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        background: open ? '#b08d57' : 'rgba(10,10,14,0.82)',
        color: open ? '#16130e' : '#e8e8ec',
        border: '1px solid #b08d57',
        borderRadius: 8,
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      ⚙ Graphics
    </button>
  )
}

const FLAG_TOGGLES: Array<{ key: keyof QualityFlags; label: string; hint?: string }> = [
  { key: 'shadows', label: 'Sun shadows' },
  { key: 'bloom', label: 'Bloom glow' },
  { key: 'refractiveGlass', label: 'Realistic glass' },
  { key: 'floorReflections', label: 'Floor reflections', hint: 'expensive' },
  { key: 'lightShafts', label: 'Light shafts' },
  { key: 'dustMotes', label: 'Dust motes' },
]

function SettingsPanel() {
  const preset = useQuality((s) => s.preset)
  const overrides = useQuality((s) => s.overrides)
  const autoAdjust = useQuality((s) => s.autoAdjust)
  const setPreset = useQuality((s) => s.setPreset)
  const setOverride = useQuality((s) => s.setOverride)
  const setAutoAdjust = useQuality((s) => s.setAutoAdjust)
  const flags = { ...PRESETS[preset], ...overrides }

  return (
    <div style={{ ...panelStyle, position: 'fixed', bottom: 56, right: 12, width: 236 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Graphics quality</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {PRESET_ORDER.map((p: QualityPreset) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            style={{
              flex: 1,
              background: p === preset ? '#b08d57' : 'transparent',
              color: p === preset ? '#16130e' : '#e8e8ec',
              border: '1px solid #b08d57',
              borderRadius: 6,
              padding: '4px 0',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {PRESET_NAMES[p]}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ display: 'flex', gap: 8, cursor: 'pointer', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={flags.ao !== 'off'}
            onChange={(e) =>
              setOverride('ao', e.target.checked ? (PRESETS[preset].ao === 'off' ? 'half' : PRESETS[preset].ao) : 'off')
            }
            style={{ accentColor: '#b08d57' }}
          />
          Ambient occlusion
        </label>
        {FLAG_TOGGLES.map((t) => (
          <label
            key={t.key}
            style={{ display: 'flex', gap: 8, cursor: 'pointer', alignItems: 'center', marginTop: 4 }}
          >
            <input
              type="checkbox"
              checked={Boolean(flags[t.key])}
              onChange={(e) => setOverride(t.key, e.target.checked as never)}
              style={{ accentColor: '#b08d57' }}
            />
            {t.label}
            {t.hint && <span style={{ opacity: 0.5, fontSize: 11 }}>({t.hint})</span>}
          </label>
        ))}
      </div>
      <RangeRow
        label="Render resolution"
        value={flags.dprCap}
        min={0.75}
        max={2}
        step={0.25}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => setOverride('dprCap', v)}
      />
      <label
        style={{
          display: 'flex',
          gap: 8,
          cursor: 'pointer',
          alignItems: 'center',
          marginTop: 10,
          paddingTop: 8,
          borderTop: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        <input
          type="checkbox"
          checked={autoAdjust}
          onChange={(e) => setAutoAdjust(e.target.checked)}
          style={{ accentColor: '#b08d57' }}
        />
        Auto-lower when slow
      </label>
    </div>
  )
}

/** Bottom-center toast for quality notices (e.g. the governor stepped down). */
function QualityToast() {
  const notice = useQuality((s) => s.notice)
  const clearNotice = useQuality((s) => s.clearNotice)
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(clearNotice, 8000)
    return () => clearTimeout(id)
  }, [notice, clearNotice])
  if (!notice) return null
  return (
    <div
      style={{
        ...panelStyle,
        position: 'fixed',
        bottom: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 420,
        border: '1px solid #b08d57',
      }}
    >
      {notice}
    </div>
  )
}

function ContextLostOverlay() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,6,9,0.88)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        zIndex: 20,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div style={{ fontSize: 15 }}>Graphics device was reset — recovering…</div>
      <div style={{ opacity: 0.6, fontSize: 13, maxWidth: 380, textAlign: 'center' }}>
        If this screen doesn't clear in a few seconds, reload the page. Consider a lower
        graphics preset if it happens again.
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: '#b08d57',
          color: '#16130e',
          border: 'none',
          borderRadius: 6,
          padding: '8px 18px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Reload now
      </button>
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
