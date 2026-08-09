import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Offline gate (Task 31): so `npm test`/`vitest run` invoked from inside this
    // package — the path every implementer actually uses — is guarded too, not
    // only the root-level `npm test`. See ../../test/setup/no-network.ts.
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
