// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { Box3, Vector3, type Mesh, type MeshStandardMaterial } from 'three'
import { injectPolypaint, loadDroppedFile } from './importDropped'

// jsdom's File is missing arrayBuffer()/text(); real browsers have them
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
  if (!File.prototype.text) {
    File.prototype.text = function (this: File) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
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

// ZBrush polypaint OBJ: one red, one green, one blue vertex
const POLYPAINT_OBJ = `# exported from zbrush
#MRGB 3
#MRGB ffff0000ff00ff00ff0000ff
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`

describe('polypaint (ZBrush #MRGB vertex colors)', () => {
  it('rewrites #MRGB blocks into extended vertex lines, sRGB→linear', () => {
    const out = injectPolypaint(POLYPAINT_OBJ)
    const vLines = out.split('\n').filter((l) => l.startsWith('v '))
    expect(vLines[0]).toBe('v 0 0 0 1.00000 0.00000 0.00000')
    expect(vLines[1]).toBe('v 1 0 0 0.00000 1.00000 0.00000')
    expect(vLines[2]).toBe('v 0 1 0 0.00000 0.00000 1.00000')
  })

  it('leaves OBJ untouched when there is no polypaint', () => {
    const plain = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'
    expect(injectPolypaint(plain)).toBe(plain)
  })

  it('produces a colored, vertexColors-enabled mesh through the full import', async () => {
    const file = new File([POLYPAINT_OBJ], 'painted.obj')
    const piece = await loadDroppedFile(file)
    let checked = 0
    piece.object.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      checked += 1
      expect(mesh.geometry.attributes.color).toBeDefined()
      const mat = mesh.material as MeshStandardMaterial
      expect(mat.vertexColors).toBe(true)
      expect(mat.color.getHexString()).toBe('ffffff')
    })
    expect(checked).toBeGreaterThan(0)
  })
})
