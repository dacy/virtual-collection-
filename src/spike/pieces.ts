import {
  BufferGeometry,
  IcosahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusKnotGeometry,
  Vector3,
  type Texture,
} from 'three'
import { makeNoiseTexture } from './textures'
import { noise3 } from './rng'

export interface StressPiece {
  name: string
  geometry: BufferGeometry
  map: Texture
  triangles: number
  /** uniform scale that fits the piece into the slot's fit box */
  scale: number
  /** lift so the scaled piece's lowest point sits on the slot surface */
  yOffset: number
  kind: 'pedestal' | 'wall'
}

/**
 * Stand-in for heavy photogrammetry scans: displaced dense meshes in the
 * same triangle class (~80k–330k each), each with its own full-size color
 * texture. Deliberately heavier in total (~3.3M tris for 20 pieces) than
 * the spec's scene budget so the spike measures the worst case.
 */
// icosahedron detail d yields 20*(d+1)^2 faces: d63 → ~82k, d127 → ~328k
const PEDESTAL_VARIANTS: Array<() => BufferGeometry> = [
  () => displace(new IcosahedronGeometry(0.5, 63), 0.09, 4.0), // ~82k tris
  () => new TorusKnotGeometry(0.34, 0.12, 600, 96, 2, 3), // ~115k
  () => displace(new SphereGeometry(0.5, 400, 200), 0.07, 5.0), // ~160k
  () => new TorusKnotGeometry(0.32, 0.13, 500, 128, 3, 4), // ~128k
  () => displace(new SphereGeometry(0.5, 640, 256), 0.08, 3.0), // ~328k
]

export function buildPedestalPiece(index: number, texSize: number, fitBox: number): StressPiece {
  const geometry = PEDESTAL_VARIANTS[index % PEDESTAL_VARIANTS.length]()
  return finalize(`piece_${index}`, geometry, index, texSize, fitBox, 'pedestal')
}

/** Wall pieces are dense displaced reliefs (~131k tris each). */
export function buildWallPiece(index: number, texSize: number, fitBox: number): StressPiece {
  const geometry = displace(new PlaneGeometry(1, 1, 256, 256), 0.06, 6.0, 'z')
  return finalize(`wall_${index}`, geometry, index, texSize, fitBox, 'wall')
}

function finalize(
  name: string,
  geometry: BufferGeometry,
  seed: number,
  texSize: number,
  fitBox: number,
  kind: StressPiece['kind'],
): StressPiece {
  geometry.computeBoundingBox()
  const size = geometry.boundingBox!.getSize(new Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = fitBox / maxDim
  const yOffset = -geometry.boundingBox!.min.y * scale
  const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3
  return { name, geometry, map: makeNoiseTexture(seed + 1, texSize), triangles, scale, yOffset, kind }
}

function displace(
  geometry: BufferGeometry,
  amplitude: number,
  frequency: number,
  mode: 'radial' | 'z' = 'radial',
): BufferGeometry {
  const pos = geometry.attributes.position
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const n = noise3(v.x * frequency, v.y * frequency, v.z * frequency)
    if (mode === 'z') {
      v.z += n * amplitude
    } else {
      const len = v.length() || 1
      v.multiplyScalar(1 + (n * amplitude) / len)
    }
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}
