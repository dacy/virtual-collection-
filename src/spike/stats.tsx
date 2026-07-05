import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Texture } from 'three'

export interface SpikeStats {
  fps: number
  onePercentLowFps: number
  drawCalls: number
  triangles: number
  textureCount: number
  geometryCount: number
  estTextureMB: number
}

export const emptyStats: SpikeStats = {
  fps: 0,
  onePercentLowFps: 0,
  drawCalls: 0,
  triangles: 0,
  textureCount: 0,
  geometryCount: 0,
  estTextureMB: 0,
}

const WINDOW = 240 // ~4s of frames

/** Lives inside the Canvas; writes measurements into a ref every frame so
 *  the DOM overlay outside the Canvas can poll without re-rendering R3F. */
export function StatsCollector({ out }: { out: MutableRefObject<SpikeStats> }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const frames = useRef<number[]>([])
  const last = useRef(performance.now())
  const lastVramScan = useRef(0)
  const estTextureMB = useRef(0)

  // the post-processing composer renders several passes per frame and
  // gl.info auto-resets between them, so only the final blit would be
  // counted; accumulate across the whole frame and reset manually instead
  useEffect(() => {
    gl.info.autoReset = false
    return () => {
      gl.info.autoReset = true
    }
  }, [gl])

  useFrame(() => {
    const now = performance.now()
    const dt = now - last.current
    last.current = now
    const buf = frames.current
    buf.push(dt)
    if (buf.length > WINDOW) buf.shift()

    if (now - lastVramScan.current > 2000) {
      lastVramScan.current = now
      estTextureMB.current = estimateTextureMB(scene)
    }

    const avg = buf.reduce((a, b) => a + b, 0) / buf.length
    const sorted = [...buf].sort((a, b) => b - a)
    const worst = sorted.slice(0, Math.max(1, Math.floor(buf.length / 100)))
    const worstAvg = worst.reduce((a, b) => a + b, 0) / worst.length

    out.current = {
      fps: 1000 / avg,
      onePercentLowFps: 1000 / worstAvg,
      // accumulated totals from the previous frame (all passes)
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      textureCount: gl.info.memory.textures,
      geometryCount: gl.info.memory.geometries,
      estTextureMB: estTextureMB.current,
    }
    gl.info.reset()
  })
  return null
}

function estimateTextureMB(scene: { traverse: (cb: (o: unknown) => void) => void }): number {
  const seen = new Set<Texture>()
  let bytes = 0
  scene.traverse((obj) => {
    const mats = (obj as { material?: unknown }).material
    for (const mat of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      for (const value of Object.values(mat as Record<string, unknown>)) {
        const tex = value as Texture | null
        if (!tex || typeof tex !== 'object' || !('isTexture' in tex) || seen.has(tex)) continue
        seen.add(tex)
        const img = tex.image as { width?: number; height?: number } | undefined
        if (img?.width && img?.height) {
          // RGBA8 + ~33% mipmap overhead
          bytes += img.width * img.height * 4 * 1.33
        }
      }
    }
  })
  return bytes / (1024 * 1024)
}

/** DOM overlay with pass/fail coloring against the spec budgets. */
export function StatsOverlay({
  statsRef,
  pieceCount,
  totalPieces,
}: {
  statsRef: MutableRefObject<SpikeStats>
  pieceCount: number
  totalPieces: number
}) {
  const [stats, setStats] = useState(emptyStats)
  useEffect(() => {
    const id = setInterval(() => setStats({ ...statsRef.current }), 250)
    return () => clearInterval(id)
  }, [statsRef])

  const isTouch = 'ontouchstart' in window
  const fpsTarget = isTouch ? 30 : 60
  const row = (label: string, value: string, ok?: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1.5rem' }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ color: ok === undefined ? '#e8e8ec' : ok ? '#6ee787' : '#ff7b72' }}>
        {value}
      </span>
    </div>
  )

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        padding: '10px 14px',
        background: 'rgba(10,10,14,0.75)',
        borderRadius: 8,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 1.7,
        pointerEvents: 'none',
        minWidth: 240,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        Milestone 0 — {pieceCount}/{totalPieces} pieces
      </div>
      {row(`FPS (target ≥${fpsTarget})`, stats.fps.toFixed(0), stats.fps >= fpsTarget - 1)}
      {row('1% low FPS', stats.onePercentLowFps.toFixed(0))}
      {row('Draw calls (≤250)', String(stats.drawCalls), stats.drawCalls <= 250)}
      {row(
        'Triangles',
        `${(stats.triangles / 1e6).toFixed(2)}M`,
        stats.triangles <= 3_000_000 * 1.15,
      )}
      {row(
        `Est. texture VRAM (≤${isTouch ? 256 : 500}MB)`,
        `${stats.estTextureMB.toFixed(0)}MB`,
        stats.estTextureMB <= (isTouch ? 256 : 500),
      )}
      {row('Textures / geometries', `${stats.textureCount} / ${stats.geometryCount}`)}
      <div style={{ opacity: 0.55, marginTop: 6, fontSize: 12 }}>
        {isTouch
          ? 'Left half: move · right half: look'
          : 'Click to walk (WASD + mouse, Q/E: eye height) · aim the dot at a display and click to edit it'}
      </div>
    </div>
  )
}
