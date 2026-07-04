/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The shipped app enforces the local-first guarantee with a strict CSP:
 * the browser itself blocks any request to a foreign origin. Injected only
 * on build because the dev server needs inline scripts (React refresh).
 * blob:/data: are same-machine schemes (object URLs, generated textures,
 * worker bootstrap for KTX2/Draco), not network escapes.
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!-- CSP-INJECTED-ON-BUILD -->',
        `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
