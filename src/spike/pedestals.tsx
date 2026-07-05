import { useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { BoxGeometry, MeshBasicMaterial, MeshStandardMaterial, type Material } from 'three'
import {
  SLAB_THICKNESS,
  SLOTS,
  type PedestalConfig,
  type PedestalStyle,
} from './layout'
import { makeTravertineTexture, makeWoodTexture } from './textures'

/**
 * One display pedestal: a styled column, a contrasting top slab the piece
 * stands on, and a warm LED reveal under the slab. Height, top size, and
 * style all come from the per-slot config the edit panel adjusts.
 *
 * Geometry is a shared unit cube scaled per mesh, and materials are cached
 * per style, so 16 unique pedestals cost 16×3 small draws and nothing more.
 */

interface StyleMaterials {
  body: Material
  slab: Material
}

let unitBox: BoxGeometry | null = null
const styleCache = new Map<PedestalStyle, StyleMaterials>()
let revealMat: MeshBasicMaterial | null = null

function getUnitBox(): BoxGeometry {
  if (!unitBox) unitBox = new BoxGeometry(1, 1, 1)
  return unitBox
}

function getRevealMaterial(): MeshBasicMaterial {
  if (!revealMat) revealMat = new MeshBasicMaterial({ color: '#5e492c' })
  return revealMat
}

function getStyleMaterials(style: PedestalStyle): StyleMaterials {
  const cached = styleCache.get(style)
  if (cached) return cached
  let mats: StyleMaterials
  switch (style) {
    case 'charcoal':
      mats = {
        body: new MeshStandardMaterial({ color: '#2c2e33', roughness: 0.4, metalness: 0.15 }),
        slab: new MeshStandardMaterial({ color: '#b08d57', roughness: 0.28, metalness: 0.85 }),
      }
      break
    case 'walnut':
      mats = {
        body: new MeshStandardMaterial({
          map: makeWoodTexture(3, false),
          roughness: 0.5,
          metalness: 0.02,
        }),
        slab: new MeshStandardMaterial({ color: '#17181b', roughness: 0.25, metalness: 0.4 }),
      }
      break
    case 'travertine': {
      const stone = new MeshStandardMaterial({
        map: makeTravertineTexture(),
        roughness: 0.65,
        metalness: 0.02,
      })
      // monolithic stone block: slab reads as the same material
      mats = { body: stone, slab: stone }
      break
    }
    case 'brass':
      mats = {
        body: new MeshStandardMaterial({
          color: '#a98a55',
          roughness: 0.32,
          metalness: 0.9,
          envMapIntensity: 1.2,
        }),
        slab: new MeshStandardMaterial({ color: '#1c1d20', roughness: 0.3, metalness: 0.5 }),
      }
      break
    case 'gallery':
    default:
      mats = {
        body: new MeshStandardMaterial({ color: '#d9d5cc', roughness: 0.6, metalness: 0.02 }),
        slab: new MeshStandardMaterial({ color: '#8d9094', roughness: 0.35, metalness: 0.85 }),
      }
      break
  }
  styleCache.set(style, mats)
  return mats
}

export function PedestalUnit({
  slotIndex,
  config,
  onClick,
}: {
  slotIndex: number
  config: PedestalConfig
  onClick?: (slotIndex: number) => void
}) {
  const slot = SLOTS[slotIndex]
  const mats = useMemo(() => getStyleMaterials(config.style), [config.style])
  const box = getUnitBox()
  const [x, , z] = slot.position
  const handleClick =
    onClick &&
    ((e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      onClick(slotIndex)
    })

  return (
    <group position={[x, 0, z]} userData={{ slotIndex }} onClick={handleClick}>
      <mesh
        geometry={box}
        material={mats.body}
        scale={[config.size, config.height, config.size]}
        position-y={config.height / 2}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={box}
        material={mats.slab}
        scale={[config.size + 0.05, SLAB_THICKNESS, config.size + 0.05]}
        position-y={config.height + SLAB_THICKNESS / 2}
        castShadow
        receiveShadow
      />
      {/* subtle warm reveal under the slab */}
      <mesh
        geometry={box}
        material={getRevealMaterial()}
        scale={[config.size + 0.02, 0.008, config.size + 0.02]}
        position-y={config.height - 0.012}
      />
    </group>
  )
}
