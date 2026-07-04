/** Deterministic RNG (mulberry32) so every spike run renders the identical
 *  scene — measurements stay comparable across devices and runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cheap value noise in 3D built from hashed sines; good enough to give
 *  stress geometry an organic, scan-like surface. */
export function noise3(x: number, y: number, z: number): number {
  return (
    (Math.sin(x * 3.1 + y * 1.7) + Math.sin(y * 2.3 + z * 2.9) + Math.sin(z * 3.7 + x * 1.3)) / 3
  )
}
