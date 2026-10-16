import { defineConfig } from 'vitest/config'

// Unit tests only. Integration tests live in *.integration.spec.ts and run via
// vitest.integration.config.ts behind an explicit opt-in flag; they must never
// execute as part of the default `npm test`.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.integration.spec.ts'],
    environment: 'node'
  }
})
