// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'

// jsdom has no canvas 2D; stub just enough for the noise-texture generator.
beforeAll(() => {
  const fakeCtx = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {},
    drawImage: () => {},
    fillRect: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
    imageSmoothingEnabled: true,
    fillStyle: '',
  }
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never
})

describe('spike slot layout', async () => {
  const { SLOTS, COLLIDERS, ROOM, PEDESTAL } = await import('./room')

  it('has exactly 20 slots with unique ids', () => {
    expect(SLOTS).toHaveLength(20)
    expect(new Set(SLOTS.map((s) => s.id)).size).toBe(20)
  })

  it('is 16 pedestals and 4 wall positions, per the spec slot mix', () => {
    expect(SLOTS.filter((s) => s.kind === 'pedestal')).toHaveLength(16)
    expect(SLOTS.filter((s) => s.kind === 'wall')).toHaveLength(4)
  })

  it('keeps every slot inside the room', () => {
    for (const s of SLOTS) {
      expect(Math.abs(s.position[0])).toBeLessThanOrEqual(ROOM.width / 2)
      expect(Math.abs(s.position[2])).toBeLessThanOrEqual(ROOM.depth / 2)
    }
  })

  it('has a collider for every pedestal, sized past the pedestal footprint', () => {
    expect(COLLIDERS).toHaveLength(16)
    for (const c of COLLIDERS) {
      expect(c.radius).toBeGreaterThan(PEDESTAL.size / 2)
    }
  })
})

describe('pedestal display defaults', async () => {
  const {
    DEFAULT_PEDESTALS_BY_INDEX,
    EYE_HEIGHT,
    PEDESTAL_HEIGHT_RANGE,
    PEDESTAL_SIZE_RANGE,
    PEDESTAL_SLOTS,
    SLOTS,
    fitBoxFor,
    pedestalColliders,
    pedestalTopFor,
  } = await import('./layout')

  const configs = SLOTS.flatMap((s, i) =>
    s.kind === 'pedestal' ? [DEFAULT_PEDESTALS_BY_INDEX[i]] : [],
  )

  it('every pedestal slot has a default config within the editor ranges', () => {
    expect(configs).toHaveLength(PEDESTAL_SLOTS.length)
    for (const c of configs) {
      expect(c).toBeDefined()
      expect(c.height).toBeGreaterThanOrEqual(PEDESTAL_HEIGHT_RANGE[0])
      expect(c.height).toBeLessThanOrEqual(PEDESTAL_HEIGHT_RANGE[1])
      expect(c.size).toBeGreaterThanOrEqual(PEDESTAL_SIZE_RANGE[0])
      expect(c.size).toBeLessThanOrEqual(PEDESTAL_SIZE_RANGE[1])
    }
  })

  it('varies heights and sizes so the room reads dynamic, not uniform', () => {
    expect(new Set(configs.map((c) => c.height)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(configs.map((c) => c.size)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(configs.map((c) => c.style)).size).toBeGreaterThanOrEqual(4)
  })

  it('puts typical piece centers in a comfortable viewing band near eye level', () => {
    const centers = configs.map((c) => pedestalTopFor(c) + fitBoxFor(c) / 2)
    for (const y of centers) {
      expect(y).toBeGreaterThan(0.95)
      expect(y).toBeLessThan(EYE_HEIGHT)
    }
    // most displays should sit close to eye level (within ~40cm)
    const nearEye = centers.filter((y) => EYE_HEIGHT - y < 0.4)
    expect(nearEye.length).toBeGreaterThanOrEqual(configs.length / 2)
  })

  it('derives a collider from each pedestal config, sized past its footprint', () => {
    const colliders = pedestalColliders(DEFAULT_PEDESTALS_BY_INDEX)
    expect(colliders).toHaveLength(PEDESTAL_SLOTS.length)
    colliders.forEach((c, i) => {
      expect(c.radius).toBeGreaterThan(configs[i].size / 2)
    })
  })
})

describe('stress piece generation', async () => {
  const { buildPedestalPiece, buildWallPiece } = await import('./pieces')
  const { SLOTS, PEDESTAL, WALL_FIT_BOX } = await import('./room')

  it('every pedestal variant lands in the heavy-scan triangle class', () => {
    for (let variant = 0; variant < 5; variant++) {
      const piece = buildPedestalPiece(variant, 256, PEDESTAL.fitBox)
      expect(piece.triangles).toBeGreaterThan(50_000)
      expect(piece.triangles).toBeLessThan(400_000)
    }
  })

  it('fits pieces to the slot fit-box and seats them on the surface', () => {
    const piece = buildPedestalPiece(0, 256, PEDESTAL.fitBox)
    const size = new Box3()
      .setFromBufferAttribute(piece.geometry.attributes.position as never)
      .getSize(new Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) * piece.scale
    expect(maxDim).toBeCloseTo(PEDESTAL.fitBox, 3)
    expect(piece.yOffset).toBeGreaterThanOrEqual(0)
  })

  it('the fully populated room totals ~3M+ triangles (a real stress load)', () => {
    let total = 0
    SLOTS.forEach((slot, i) => {
      const piece =
        slot.kind === 'pedestal'
          ? buildPedestalPiece(i, 256, PEDESTAL.fitBox)
          : buildWallPiece(i, 256, WALL_FIT_BOX)
      total += piece.triangles
    })
    expect(total).toBeGreaterThan(2_500_000)
    expect(total).toBeLessThan(4_500_000)
  })
})
