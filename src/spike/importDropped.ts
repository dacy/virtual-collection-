import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { createGLTFLoader } from '../engine/loaders'

export interface DroppedPiece {
  name: string
  /** normalized: bbox centered on origin, base at y=0, max dimension = 1 */
  object: Object3D
  triangles: number
}

/**
 * Spike-grade preview of the v1 import pipeline: parse a dropped file
 * entirely in the browser and normalize it for slot placement. External
 * texture references (OBJ/FBX) load untextured here; the full pipeline
 * with MTL resolution, STL material presets, and GLB re-export is Phase 3.
 */
export async function loadDroppedFile(
  file: File,
  renderer?: WebGLRenderer,
): Promise<DroppedPiece> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  let object: Object3D

  if (ext === 'glb' || ext === 'gltf') {
    const { gltfLoader } = createGLTFLoader(renderer)
    const gltf = await gltfLoader.parseAsync(await file.arrayBuffer(), '')
    object = gltf.scene
  } else if (ext === 'fbx') {
    object = new FBXLoader().parse(await file.arrayBuffer(), '')
  } else if (ext === 'obj') {
    object = new OBJLoader().parse(injectPolypaint(await file.text()))
    // without the MTL there are no usable materials; show clean gray
    applyDefaultMaterial(object)
  } else if (ext === 'stl') {
    const geometry = new STLLoader().parse(await file.arrayBuffer())
    geometry.computeVertexNormals()
    object = new Mesh(geometry, defaultMaterial())
  } else {
    throw new Error(`"${file.name}": unsupported format — use GLB/GLTF, FBX, OBJ, or STL`)
  }

  enableVertexColors(object)
  return normalize(object, file.name)
}

/**
 * ZBrush exports polypaint in OBJ files as `#MRGB` comment blocks (2 hex
 * chars of mask + RGB per vertex, in vertex order) that three's OBJLoader
 * ignores. Rewrite them as extended `v x y z r g b` vertex lines, which
 * OBJLoader does parse into a color attribute. Values are converted
 * sRGB → linear, since three treats vertex colors as linear.
 */
export function injectPolypaint(objText: string): string {
  const hex = (objText.match(/^#MRGB\s+[0-9a-fA-F]+\s*$/gm) ?? [])
    .map((line) => line.replace(/^#MRGB\s+/, '').trim())
    // each vertex is exactly 8 hex chars; skip malformed/header lines
    .filter((payload) => payload.length % 8 === 0)
    .join('')
  if (!hex) return objText

  const colors: number[] = []
  for (let i = 0; i + 8 <= hex.length; i += 8) {
    colors.push(
      srgbToLinear(parseInt(hex.slice(i + 2, i + 4), 16) / 255),
      srgbToLinear(parseInt(hex.slice(i + 4, i + 6), 16) / 255),
      srgbToLinear(parseInt(hex.slice(i + 6, i + 8), 16) / 255),
    )
  }

  const num = '(-?[\\d.]+(?:[eE][+-]?\\d+)?)'
  let vertex = 0
  return objText.replace(
    new RegExp(`^v\\s+${num}\\s+${num}\\s+${num}.*$`, 'gm'),
    (line, x, y, z) => {
      const c = vertex * 3
      vertex += 1
      if (c + 3 > colors.length) return line
      return `v ${x} ${y} ${z} ${colors[c].toFixed(5)} ${colors[c + 1].toFixed(5)} ${colors[c + 2].toFixed(5)}`
    },
  )
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Polypaint / vertex colors: if geometry carries a color attribute, make
 *  the material actually show it (GLTFLoader does this itself; FBX, STL,
 *  and our OBJ rewrite need it enabled). */
function enableVertexColors(object: Object3D): void {
  object.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh || !(mesh.geometry as BufferGeometry | undefined)?.attributes?.color) return
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = mat as MeshStandardMaterial
      if (!std.vertexColors) {
        std.vertexColors = true
        std.color?.set('#ffffff')
        std.needsUpdate = true
      }
    }
  })
}

function normalize(object: Object3D, name: string): DroppedPiece {
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) throw new Error(`"${name}": no geometry found in file`)
  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1

  const inner = new Group()
  inner.add(object)
  object.position.set(-center.x, -box.min.y, -center.z)
  const group = new Group()
  group.add(inner)
  inner.scale.setScalar(1 / maxDim)

  return { name, object: group, triangles: countTriangles(object) }
}

function countTriangles(object: Object3D): number {
  let tris = 0
  object.traverse((node) => {
    const geometry = (node as Mesh).geometry as BufferGeometry | undefined
    if ((node as Mesh).isMesh && geometry) {
      tris += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3
    }
  })
  return Math.round(tris)
}

function defaultMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: '#9a9aa0', roughness: 0.55, metalness: 0.05 })
}

function applyDefaultMaterial(object: Object3D): void {
  object.traverse((node) => {
    if ((node as Mesh).isMesh) (node as Mesh).material = defaultMaterial()
  })
}

/** Free GPU resources of a replaced piece. */
export function disposeObject(object: Object3D): void {
  object.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
        if (value && typeof value === 'object' && 'isTexture' in (value as object)) {
          ;(value as { dispose: () => void }).dispose()
        }
      }
      mat.dispose()
    }
  })
}
