import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxy target — falls back to localhost for non-docker dev. Inside
// docker-compose.dev.yml we set VITE_DEV_API_PROXY=http://api:3001 so the
// proxy hits the api service across the docker network instead of the
// container's own localhost (which has no API listening).
const apiProxyTarget = process.env.VITE_DEV_API_PROXY ?? 'http://localhost:3001'

export default defineConfig({
  plugins: [react()],
  server: {
    // host:true binds to every interface so the docker-mapped port reaches
    // Vite. `npm run dev` on a bare laptop falls back to listening on
    // 127.0.0.1 only — fine, but for dockerised dev we need 0.0.0.0.
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  // Vite's default `appType: 'spa'` already serves index.html for non-asset
  // routes, so deep links like /workflows/:id work without extra config.
})
