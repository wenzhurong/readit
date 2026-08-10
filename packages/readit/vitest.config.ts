import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 与 packages/core 同：包内直接跑 vitest 时离线门也在。
    setupFiles: ['../../test/setup/no-network.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // 这个 project 会 npm pack + npm install 一个 tarball（Task 10），比其它 project 慢一个量级。
    testTimeout: 180_000,
    hookTimeout: 180_000,
    chaiConfig: { truncateThreshold: 0 },
  },
})
