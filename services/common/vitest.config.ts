import { defineConfig } from 'vitest/config'

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
})
