import { CanvasTexture, SRGBColorSpace, RepeatWrapping, ClampToEdgeWrapping } from 'three'
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

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  repeat = true,
): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping
  tex.anisotropy = 8
  return tex
}

/** Walnut planks: warm dark base, long grain streaks, occasional knots. */
export function makeWoodTexture(seed = 3, plank = true): CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const rand = mulberry32(seed)
    ctx.fillStyle = '#59422e'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 220; i++) {
      const y = rand() * s
      const w = 40 + rand() * 300
      const light = rand() > 0.5
      ctx.strokeStyle = light
        ? `rgba(122, 94, 62, ${0.1 + rand() * 0.18})`
        : `rgba(38, 26, 16, ${0.1 + rand() * 0.2})`
      ctx.lineWidth = 0.6 + rand() * 2.4
      ctx.beginPath()
      ctx.moveTo(rand() * s, y)
      ctx.bezierCurveTo(
        rand() * s, y + (rand() - 0.5) * 8,
        rand() * s, y + (rand() - 0.5) * 8,
        rand() * s + w, y + (rand() - 0.5) * 14,
      )
      ctx.stroke()
    }
    for (let i = 0; i < 7; i++) {
      const x = rand() * s
      const y = rand() * s
      ctx.strokeStyle = 'rgba(30, 20, 12, 0.35)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.ellipse(x, y, 3 + rand() * 6, 2 + rand() * 4, rand(), 0, Math.PI * 2)
      ctx.stroke()
    }
    if (plank) {
      ctx.strokeStyle = 'rgba(20, 13, 8, 0.55)'
      ctx.lineWidth = 2
      for (let y = 0; y <= s; y += 128) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(s, y)
        ctx.stroke()
      }
    }
  })
}

/** Vertical walnut slats with dark grooves — the feature-wall panel. */
export function makeSlatTexture(): CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const rand = mulberry32(9)
    ctx.fillStyle = '#5d452f'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 400; i++) {
      ctx.strokeStyle = rand() > 0.5
        ? `rgba(130, 100, 66, ${0.08 + rand() * 0.12})`
        : `rgba(36, 25, 15, ${0.08 + rand() * 0.14})`
      ctx.lineWidth = 0.5 + rand() * 1.5
      const x = rand() * s
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + (rand() - 0.5) * 10, s)
      ctx.stroke()
    }
    // slat grooves with lit/shadow edges for cheap relief
    const slat = 64
    for (let x = 0; x <= s; x += slat) {
      ctx.fillStyle = 'rgba(12, 8, 5, 0.9)'
      ctx.fillRect(x - 4, 0, 8, s)
      ctx.fillStyle = 'rgba(160, 125, 84, 0.35)'
      ctx.fillRect(x + 4, 0, 3, s)
      ctx.fillStyle = 'rgba(20, 13, 8, 0.35)'
      ctx.fillRect(x - 7, 0, 3, s)
    }
  })
}

/** One raised wainscot panel (repeat along a wall): frame shading baked in. */
export function makeWainscotTexture(): CanvasTexture {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#e7e2d7'
    ctx.fillRect(0, 0, s, s)
    const edge = 26
    const bevel = 12
    // outer shadowed groove
    ctx.strokeStyle = 'rgba(90, 85, 75, 0.5)'
    ctx.lineWidth = 3
    ctx.strokeRect(edge, edge, s - edge * 2, s - edge * 2)
    // bevel highlight (top/left) and shade (bottom/right)
    ctx.strokeStyle = 'rgba(255, 253, 246, 0.9)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(edge + bevel, s - edge - bevel)
    ctx.lineTo(edge + bevel, edge + bevel)
    ctx.lineTo(s - edge - bevel, edge + bevel)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(120, 112, 98, 0.55)'
    ctx.beginPath()
    ctx.moveTo(edge + bevel, s - edge - bevel)
    ctx.lineTo(s - edge - bevel, s - edge - bevel)
    ctx.lineTo(s - edge - bevel, edge + bevel)
    ctx.stroke()
    // inner raised field, slightly brighter
    ctx.fillStyle = '#ece7dc'
    ctx.fillRect(edge + bevel + 2, edge + bevel + 2, s - (edge + bevel + 2) * 2, s - (edge + bevel + 2) * 2)
  })
}

/** Layered travertine: horizontal strata with pits. */
export function makeTravertineTexture(): CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const rand = mulberry32(5)
    ctx.fillStyle = '#d9cdb8'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 90; i++) {
      const y = rand() * s
      ctx.fillStyle = `rgba(${168 + rand() * 40}, ${150 + rand() * 38}, ${120 + rand() * 34}, ${0.08 + rand() * 0.1})`
      ctx.fillRect(0, y, s, 3 + rand() * 22)
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(105, 90, 70, ${0.05 + rand() * 0.12})`
      ctx.beginPath()
      ctx.ellipse(rand() * s, rand() * s, 0.5 + rand() * 2.4, 0.4 + rand() * 1.2, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** Woven wool rug with a border — high roughness, anchors the center row. */
export function makeRugTexture(): CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const rand = mulberry32(21)
    ctx.fillStyle = '#8d8478'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 9000; i++) {
      const g = 118 + rand() * 50
      ctx.fillStyle = `rgba(${g}, ${g - 8}, ${g - 22}, 0.3)`
      ctx.fillRect(rand() * s, rand() * s, 2, 1)
    }
    ctx.strokeStyle = '#4d443a'
    ctx.lineWidth = 14
    ctx.strokeRect(14, 14, s - 28, s - 28)
    ctx.strokeStyle = '#b08d57'
    ctx.lineWidth = 3
    ctx.strokeRect(30, 30, s - 60, s - 60)
  }, false)
}

/** Late-afternoon sky gradient for outside the windows. */
export function makeSkyTexture(): CanvasTexture {
  return canvasTexture(256, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#7fb2e8')
    g.addColorStop(0.55, '#bcd8ef')
    g.addColorStop(0.8, '#f2ddba')
    g.addColorStop(1, '#f7e6c4')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  }, false)
}

/** Soft distant treeline silhouette strip (transparent above). */
export function makeTreelineTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 128
  const ctx = c.getContext('2d')!
  const rand = mulberry32(14)
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.fillStyle = 'rgba(52, 74, 52, 0.96)'
  ctx.beginPath()
  ctx.moveTo(0, c.height)
  let x = 0
  while (x < c.width) {
    const h = 30 + rand() * 70
    const w = 30 + rand() * 60
    ctx.quadraticCurveTo(x + w / 2, c.height - h, x + w, c.height - 20 - rand() * 30)
    x += w
  }
  ctx.lineTo(c.width, c.height)
  ctx.closePath()
  ctx.fill()
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = ClampToEdgeWrapping
  return tex
}

/** Engraved brass gallery plaque. */
export function makePlaqueTexture(title: string): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, c.height)
  g.addColorStop(0, '#c8a76b')
  g.addColorStop(0.5, '#ab8a52')
  g.addColorStop(1, '#c0a065')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.strokeStyle = 'rgba(60, 44, 20, 0.8)'
  ctx.lineWidth = 6
  ctx.strokeRect(16, 16, c.width - 32, c.height - 32)
  ctx.font = '600 92px Georgia, "Times New Roman", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255, 240, 210, 0.55)'
  ctx.fillText(title, c.width / 2, c.height / 2 + 3)
  ctx.fillStyle = '#3a2c17'
  ctx.fillText(title, c.width / 2, c.height / 2)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** Vertical soft-edged gradient used by the fake volumetric light shafts. */
export function makeShaftTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, c.height)
  g.addColorStop(0, 'rgba(255, 236, 200, 0.55)')
  g.addColorStop(0.6, 'rgba(255, 236, 200, 0.18)')
  g.addColorStop(1, 'rgba(255, 236, 200, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, c.width, c.height)
  // feather the sides so the quad edges never read as hard lines
  const side = ctx.createLinearGradient(0, 0, c.width, 0)
  side.addColorStop(0, 'rgba(0,0,0,1)')
  side.addColorStop(0.2, 'rgba(0,0,0,0)')
  side.addColorStop(0.8, 'rgba(0,0,0,0)')
  side.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = side
  ctx.fillRect(0, 0, c.width, c.height)
  const tex = new CanvasTexture(c)
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping
  return tex
}
