import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

/**
 * Graphics quality system. Every expensive feature sits behind a flag so
 * weaker PCs can turn things off (or have them turned off automatically when
 * the frame rate craters) while stronger ones get the full treatment.
 *
 * Preset picks the defaults; individual flags can be overridden from the
 * settings panel. Persisted to localStorage; `?quality=low|medium|high|ultra`
 * overrides for A/B runs (legacy `?fx=off` maps to low).
 */

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra'

export interface QualityFlags {
  /** devicePixelRatio cap — the render-resolution knob */
  dprCap: number
  shadows: boolean
  shadowMapSize: number
  ao: 'off' | 'half' | 'full'
  bloom: boolean
  smaa: boolean
  /** post-processing composer at all */
  post: boolean
  /** planar reflections on the marble floor (extra scene render) */
  floorReflections: boolean
  /** physically refractive vitrine glass (transmission pass) */
  refractiveGlass: boolean
  lightShafts: boolean
  dustMotes: boolean
}

export const PRESET_ORDER: QualityPreset[] = ['low', 'medium', 'high', 'ultra']

export const PRESET_NAMES: Record<QualityPreset, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
}

export const PRESETS: Record<QualityPreset, QualityFlags> = {
  low: {
    dprCap: 1,
    shadows: false,
    shadowMapSize: 1024,
    ao: 'off',
    bloom: false,
    smaa: false,
    post: false,
    floorReflections: false,
    refractiveGlass: false,
    lightShafts: false,
    dustMotes: false,
  },
  medium: {
    dprCap: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    ao: 'off',
    bloom: false,
    smaa: false,
    post: false,
    floorReflections: false,
    refractiveGlass: false,
    lightShafts: true,
    dustMotes: false,
  },
  high: {
    dprCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    ao: 'half',
    bloom: true,
    smaa: true,
    post: true,
    floorReflections: false,
    refractiveGlass: true,
    lightShafts: true,
    dustMotes: true,
  },
  ultra: {
    dprCap: 2,
    shadows: true,
    shadowMapSize: 4096,
    ao: 'full',
    bloom: true,
    smaa: true,
    post: true,
    floorReflections: true,
    refractiveGlass: true,
    lightShafts: true,
    dustMotes: true,
  },
}

export function resolveFlags(
  preset: QualityPreset,
  overrides: Partial<QualityFlags>,
): QualityFlags {
  return { ...PRESETS[preset], ...overrides }
}

function urlPreset(): QualityPreset | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('fx') === 'off') return 'low'
  const q = params.get('quality')
  return q && (PRESET_ORDER as string[]).includes(q) ? (q as QualityPreset) : null
}

function detectPreset(): QualityPreset {
  if (typeof window === 'undefined') return 'high'
  return 'ontouchstart' in window ? 'low' : 'high'
}

interface QualityState {
  preset: QualityPreset
  overrides: Partial<QualityFlags>
  /** allow the FPS governor to lower the preset on sustained low FPS */
  autoAdjust: boolean
  /** one-shot user-facing message (e.g. "quality lowered"), cleared by UI */
  notice: string | null
  setPreset: (preset: QualityPreset) => void
  setOverride: <K extends keyof QualityFlags>(key: K, value: QualityFlags[K]) => void
  setAutoAdjust: (on: boolean) => void
  dropPreset: () => void
  clearNotice: () => void
}

export const useQuality = create<QualityState>()(
  persist(
    (set, get) => ({
      preset: detectPreset(),
      overrides: {},
      autoAdjust: true,
      notice: null,
      setPreset: (preset) => set({ preset, overrides: {} }),
      setOverride: (key, value) =>
        set((s) => ({ overrides: { ...s.overrides, [key]: value } })),
      setAutoAdjust: (autoAdjust) => set({ autoAdjust }),
      dropPreset: () => {
        const i = PRESET_ORDER.indexOf(get().preset)
        if (i <= 0) return
        const next = PRESET_ORDER[i - 1]
        set({
          preset: next,
          overrides: {},
          notice: `Frame rate was low — graphics lowered to ${PRESET_NAMES[next]}. Change it any time in Graphics settings.`,
        })
      },
      clearNotice: () => set({ notice: null }),
    }),
    {
      name: 'vc-quality-v1',
      partialize: (s) => ({ preset: s.preset, overrides: s.overrides, autoAdjust: s.autoAdjust }),
    },
  ),
)

/** The resolved flag set components actually render from. */
export const useFlags = (): QualityFlags =>
  useQuality(useShallow((s) => resolveFlags(s.preset, s.overrides)))

// URL param wins over whatever was persisted, and pins the choice for the
// session (no auto-drop) so ?quality= A/B runs measure what they claim to.
const pinned = urlPreset()
if (pinned) useQuality.setState({ preset: pinned, overrides: {}, autoAdjust: false })
