import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  preview: { port: 4173, host: 'localhost' },
  server: {
    port: 5173,
    host: 'localhost',
    proxy: { '/api': 'http://localhost:8787' },
  },
})
