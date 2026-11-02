import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev the site and the API run separately; /api is forwarded to the backend (npm run dev in ../backend).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:3000',
    },
  },
})
