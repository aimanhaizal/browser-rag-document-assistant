import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@mlc-ai/web-llm'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1800 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
