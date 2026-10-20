import { defineConfig } from 'vitest/config'

// Integration tests hit the real Contentful Management API and create/delete
// an environment. They are opt-in only: the suite file additionally requires
// CONTENTFUL_INTEGRATION_OPT_IN=true plus credentials. Run with:
//   npm run test:integration
export default defineConfig({
  test: {
    include: ['src/**/*.integration.spec.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 120000,
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1
  }
})
