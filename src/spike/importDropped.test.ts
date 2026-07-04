// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { loadDroppedFile } from './importDropped'

// jsdom's File is missing arrayBuffer(); real browsers have it
beforeAll(() => {
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function (this: File) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  }
})

/** Minimal valid binary STL: one triangle, off-center and larger than 1. */
function makeBinarySTL(): File {
  const buf = new ArrayBuffer(84 + 50)
  const view = new DataView(buf)
  view.setUint32(80, 1, true) // triangle count
  const base = 84
  // normal
  view.setFloat32(base, 0, true)
  view.setFloat32(base + 4, 0, true)
  view.setFloat32(base + 8, 1, true)
  // vertices of a 4x4 triangle offset to x,y in [10,14], z=2
  const verts = [10, 10, 2, 14, 10, 2, 10, 14, 2]
  verts.forEach((v, i) => view.setFloat32(base + 12 + i * 4, v, true))
  return new File([buf], 'test-piece.stl')
}

describe('loadDroppedFile', () => {
  it('parses binary STL and normalizes: centered, grounded, max dimension 1', async () => {
    const piece = await loadDroppedFile(makeBinarySTL())
    expect(piece.triangles).toBe(1)

    piece.object.updateMatrixWorld(true)
    const box = new Box3().setFromObject(piece.object)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(1, 5)
    expect(center.x).toBeCloseTo(0, 5)
    expect(center.z).toBeCloseTo(0, 5)
    expect(box.min.y).toBeCloseTo(0, 5)
  })

  it('rejects unsupported formats with a clear message', async () => {
    const file = new File([new ArrayBuffer(8)], 'model.blend')
    await expect(loadDroppedFile(file)).rejects.toThrow(/unsupported format/i)
  })

  it('rejects files with no geometry', async () => {
    const empty = new ArrayBuffer(84)
    new DataView(empty).setUint32(80, 0, true)
    const file = new File([empty], 'empty.stl')
    await expect(loadDroppedFile(file)).rejects.toThrow(/no geometry/i)
  })
})
