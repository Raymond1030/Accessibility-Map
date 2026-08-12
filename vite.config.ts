/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 项目站点部署在 /<仓库名>/ 子路径下，资源引用必须带上它。
// 本地开发和本地预览保持 '/'，由 CI 在构建时注入 VITE_BASE。
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
