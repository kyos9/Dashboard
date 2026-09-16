import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 백엔드 포트를 바꿔 띄웠다면 VITE_API_TARGET으로 가리킬 수 있다
      '/api': process.env.VITE_API_TARGET ?? 'http://localhost:8000',
    },
  },
})
