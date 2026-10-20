import { neostandard } from 'neostandard'

export default [
  { ignores: ['dist/**', 'templates/**', 'migrations/**', 'coverage/**'] },
  ...neostandard({ ts: true }),
  {
    rules: {
      '@stylistic/max-len': ['error', { code: 120, ignoreStrings: true, ignoreTemplateLiterals: true }]
    }
  }
]
