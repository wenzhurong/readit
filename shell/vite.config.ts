import { cpSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const HERE = dirname(fileURLToPath(import.meta.url))

function copyOfflineEmoji(): Plugin {
  return {
    name: 'readit-offline-emoji',
    closeBundle() {
      cpSync(resolve(HERE, '../packages/core/data/emoji'), resolve(HERE, 'dist/emoji'), {
        recursive: true,
      })
    },
  }
}

export default defineConfig({
  plugins: [copyOfflineEmoji()],
  clearScreen: false,
  server: {
    strictPort: true,
  },
})
