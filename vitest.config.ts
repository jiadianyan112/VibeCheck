import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: true,
    exclude: [...configDefaults.exclude, 'e2e/**', 'vibcoding作品数据/**', '设计文件/**'],
  },
})
