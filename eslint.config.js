import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Module-boundary rules from the design spec, enforced mechanically:
 *   engine/  never touches storage or UI; reaches data only through store/
 *   ui/      reaches data only through store/ (renders engine/ scenes)
 *   importer/ is a pure pipeline: no storage, no UI, no engine
 *   store/   persists only through the persistence/ interface
 *   persistence/ is a leaf: knows nothing about the rest of the app
 */
const boundary = (files, forbidden) => ({
  files,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: forbidden.map((mod) => ({
          group: [`**/${mod}/**`, `**/${mod}`],
          message: `This module may not import from ${mod}/ (see spec: Architecture).`,
        })),
      },
    ],
  },
})

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ['dist', 'public'] },
  boundary(['src/engine/**'], ['persistence', 'ui', 'importer']),
  boundary(['src/ui/**'], ['persistence']),
  boundary(['src/importer/**'], ['persistence', 'ui', 'engine']),
  boundary(['src/store/**'], ['ui', 'engine']),
  boundary(['src/persistence/**'], ['ui', 'engine', 'importer', 'store']),
)
