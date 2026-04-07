import { defineConfig } from 'vitest/config'
import * as path from 'path'

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        '**/generated/**',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/dist/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  esbuild: {
    target: 'es2022',
  },
})
