import { describe, expect, it } from 'vitest'
import { createGLTFLoader, DECODER_BASE } from './loaders'

// Guards the local-first guarantee: decoder paths must be same-origin,
// never a CDN (which is what three's loaders default to if unconfigured).
describe('createGLTFLoader', () => {
  it('uses a same-origin decoder base', () => {
    expect(DECODER_BASE.startsWith('/')).toBe(true)
    expect(DECODER_BASE).not.toMatch(/^https?:|^\/\//)
  })

  it('points Draco and KTX2 at vendored local decoders', () => {
    const { dracoLoader, ktx2Loader } = createGLTFLoader()
    // decoderPath/transcoderPath exist at runtime but aren't in the typings
    const draco = dracoLoader as unknown as { decoderPath: string }
    const ktx2 = ktx2Loader as unknown as { transcoderPath: string }
    expect(draco.decoderPath).toBe('/decoders/draco/')
    expect(ktx2.transcoderPath).toBe('/decoders/basis/')
  })
})
