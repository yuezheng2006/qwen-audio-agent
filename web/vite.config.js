import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const gatewayProxy = {
  '/api': {
    target: 'http://localhost:3101',
    ws: true,
  },
}

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: gatewayProxy,
  },
  preview: {
    port: 4176,
    strictPort: true,
    proxy: gatewayProxy,
  },
})
