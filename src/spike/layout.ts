/**
 * Room + display layout data: slot positions, per-pedestal display configs
 * (height / top size / material style — the knobs the edit panel exposes),
 * and the walk-collision shapes derived from them. Pure data, no three/react
 * imports beyond types, so tests can load it without a GL context.
 */

export const ROOM = { width: 12, depth: 8, height: 4.2 }
export const EYE_HEIGHT = 1.65
/** Eye-height range for the Q/E crouch–rise viewing-angle adjustment. */
export const EYE_RANGE: [number, number] = [1.15, 2.05]

/** Legacy uniform pedestal dims — kept as the reference "medium" display
 *  and for the spike tests; live pedestals use per-slot configs below. */
export const PEDESTAL = { size: 0.55, height: 1.0, fitBox: 0.5 }
export const WALL_FIT_BOX = 0.9
/** Thickness of the slab a piece actually stands on. */
export const SLAB_THICKNESS = 0.026

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
  // the south wall is now floor-to-header glass, so these two hang on the
  // west wall center and the east wall north of the door
  {
    id: `wall_w_0`,
    kind: 'wall',
    position: [-ROOM.width / 2 + 0.06, 1.75, 0],
    rotationY: Math.PI / 2,
  },
  {
    id: `wall_e_0`,
    kind: 'wall',
    position: [ROOM.width / 2 - 0.06, 1.75, -2.6],
    rotationY: -Math.PI / 2,
  },
]

export const PEDESTAL_SLOTS = SLOTS.filter((s) => s.kind === 'pedestal')

export type PedestalStyle = 'gallery' | 'charcoal' | 'walnut' | 'travertine' | 'brass'

export const PEDESTAL_STYLE_NAMES: Record<PedestalStyle, string> = {
  gallery: 'Gallery white',
  charcoal: 'Charcoal stone',
  walnut: 'Walnut wood',
  travertine: 'Travertine',
  brass: 'Brushed brass',
}

export interface PedestalConfig {
  /** column height in meters (edit range PEDESTAL_HEIGHT_RANGE) */
  height: number
  /** square top dimension in meters (edit range PEDESTAL_SIZE_RANGE) */
  size: number
  style: PedestalStyle
}

export const PEDESTAL_HEIGHT_RANGE: [number, number] = [0.4, 1.4]
export const PEDESTAL_SIZE_RANGE: [number, number] = [0.35, 0.9]

/** Cube a piece is normalized into, from the pedestal's top size. */
export const fitBoxFor = (c: PedestalConfig) => c.size * 0.86
/** y of the surface pieces actually stand on (top of the slab). */
export const pedestalTopFor = (c: PedestalConfig) => c.height + SLAB_THICKNESS

/**
 * Default display mix, keyed by slot id. Deliberately varied — tall & slim
 * columns lift small pieces toward standing eye level (~1.65 m), a few low
 * & wide plinths stage larger statement pieces — so the room doesn't read
 * as rows of identical boxes and sightlines vary as you walk.
 */
export const DEFAULT_PEDESTALS: Record<string, PedestalConfig> = {
  ped_n_0: { height: 1.15, size: 0.5, style: 'gallery' },
  ped_n_1: { height: 1.0, size: 0.62, style: 'travertine' },
  ped_n_2: { height: 1.3, size: 0.4, style: 'charcoal' },
  ped_n_3: { height: 1.15, size: 0.5, style: 'gallery' },
  ped_s_0: { height: 0.62, size: 0.85, style: 'travertine' },
  ped_s_1: { height: 1.2, size: 0.46, style: 'gallery' },
  ped_s_2: { height: 1.05, size: 0.55, style: 'walnut' },
  ped_s_3: { height: 1.25, size: 0.42, style: 'charcoal' },
  ped_w_0: { height: 1.3, size: 0.4, style: 'brass' },
  ped_w_1: { height: 1.3, size: 0.4, style: 'brass' },
  ped_e_0: { height: 1.0, size: 0.58, style: 'charcoal' },
  ped_e_1: { height: 1.1, size: 0.5, style: 'walnut' },
  ped_c_0: { height: 0.68, size: 0.8, style: 'walnut' },
  ped_c_1: { height: 1.22, size: 0.44, style: 'gallery' },
  ped_c_2: { height: 1.22, size: 0.44, style: 'gallery' },
  ped_c_3: { height: 0.68, size: 0.8, style: 'walnut' },
}

const FALLBACK_PEDESTAL: PedestalConfig = {
  height: PEDESTAL.height,
  size: PEDESTAL.size,
  style: 'gallery',
}

/** Default pedestal configs keyed by index into SLOTS (wall slots skipped). */
export const DEFAULT_PEDESTALS_BY_INDEX: Record<number, PedestalConfig> = Object.fromEntries(
  SLOTS.flatMap((s, i) =>
    s.kind === 'pedestal' ? [[i, DEFAULT_PEDESTALS[s.id] ?? FALLBACK_PEDESTAL]] : [],
  ),
)

export interface CircleCollider {
  x: number
  z: number
  radius: number
}

const colliderRadius = (size: number) => size * 0.72 + 0.3

/** Colliders for the current pedestal configs (keyed by SLOTS index). */
export function pedestalColliders(configs: Record<number, PedestalConfig>): CircleCollider[] {
  return SLOTS.flatMap((s, i) => {
    if (s.kind !== 'pedestal') return []
    const cfg = configs[i] ?? FALLBACK_PEDESTAL
    return [{ x: s.position[0], z: s.position[2], radius: colliderRadius(cfg.size) }]
  })
}

/** Default-config colliders — what the walk controller starts from. */
export const COLLIDERS = pedestalColliders(DEFAULT_PEDESTALS_BY_INDEX)

/** Gallery benches (visitor seating) — position + yaw, seat along local x. */
export const BENCHES: Array<{ x: number; z: number; rotationY: number }> = [
  { x: -2.2, z: 1.7, rotationY: 0 },
  { x: 2.2, z: -1.7, rotationY: 0 },
]

export const BENCH_SEAT = { length: 1.5, width: 0.45, height: 0.45 }

/** Furniture the walk controller also pushes out of. */
export const FURNITURE_COLLIDERS: CircleCollider[] = BENCHES.map((b) => ({
  x: b.x,
  z: b.z,
  radius: 0.8,
}))
