import { CanvasTexture, SRGBColorSpace, RepeatWrapping } from 'three'
import { mulberry32 } from './rng'

/**
 * Generates a unique color texture per piece at the requested GPU size.
 * Noise is painted at 256px and upscaled — content doesn't matter for the
 * stress test, only the real VRAM footprint of a `size`×`size` texture.
 */
export function makeNoiseTexture(seed: number, size: number): CanvasTexture {
  const rand = mulberry32(seed)
  const base = 256
  const src = document.createElement('canvas')
  src.width = src.height = base
  const sctx = src.getContext('2d')!
  const img = sctx.createImageData(base, base)

  const hue = rand() * 360
  const [r0, g0, b0] = hslToRgb(hue, 0.25 + rand() * 0.3, 0.35 + rand() * 0.2)
  const [r1, g1, b1] = hslToRgb((hue + 40 + rand() * 60) % 360, 0.3, 0.6)
  for (let i = 0; i < img.data.length; i += 4) {
    const t = rand()
    img.data[i] = r0 + (r1 - r0) * t
    img.data[i + 1] = g0 + (g1 - g0) * t
    img.data[i + 2] = b0 + (b1 - b0) * t
    img.data[i + 3] = 255
  }
  sctx.putImageData(img, 0, 0)

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(src, 0, 0, size, size)

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.anisotropy = 4
  return tex
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}
