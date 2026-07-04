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
