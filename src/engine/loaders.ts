import type { WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/**
 * Decoder binaries are vendored into public/decoders/ by
 * scripts/vendor-decoders.mjs. Three's loaders default to fetching these
 * from a CDN if left unconfigured, which would both break under our CSP
 * and violate the local-first guarantee — so every loader is built through
 * this factory, never constructed ad hoc.
 */
export const DECODER_BASE = '/decoders/'

export interface GLTFLoaderBundle {
  gltfLoader: GLTFLoader
  dracoLoader: DRACOLoader
  ktx2Loader: KTX2Loader
}

export function createGLTFLoader(renderer?: WebGLRenderer): GLTFLoaderBundle {
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath(`${DECODER_BASE}draco/`)

  const ktx2Loader = new KTX2Loader()
  ktx2Loader.setTranscoderPath(`${DECODER_BASE}basis/`)
  if (renderer) ktx2Loader.detectSupport(renderer)

  const gltfLoader = new GLTFLoader()
  gltfLoader.setDRACOLoader(dracoLoader)
  gltfLoader.setKTX2Loader(ktx2Loader)
  gltfLoader.setMeshoptDecoder(MeshoptDecoder)

  return { gltfLoader, dracoLoader, ktx2Loader }
}
