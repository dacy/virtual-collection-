/**
 * Copies the Draco and Basis/KTX2 decoder binaries out of the three package
 * into public/decoders/, where the app's loaders are configured to find
 * them. Keeping them vendored (committed) is part of the local-first
 * guarantee: nothing is ever fetched from a CDN at runtime.
 *
 * Re-run after upgrading three: npm run vendor-decoders
 */
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const libs = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs')
const out = join(root, 'public', 'decoders')

mkdirSync(out, { recursive: true })
cpSync(join(libs, 'draco', 'gltf'), join(out, 'draco'), { recursive: true })
cpSync(join(libs, 'basis'), join(out, 'basis'), { recursive: true })

console.log(`Vendored decoders into ${out}`)
