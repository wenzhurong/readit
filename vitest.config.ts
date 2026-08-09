import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Compose with each package's own vitest.config.ts (environment, chaiConfig,
    // setupFiles) rather than replacing it — a flat `include` glob across
    // packages/*/test here would run those files under only *this* config,
    // silently dropping package-level settings such as chaiConfig.truncateThreshold.
    projects: ['.', 'packages/*'],
    // Root-level infrastructure tests (this file's own directory), not owned by
    // any package.
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup/no-network.ts'],
  },
})
