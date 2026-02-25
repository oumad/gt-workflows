import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0', // Allow connections from network
    port: 3010,
    strictPort: true, // Fail if port is in use instead of falling back
    open: true,
    allowedHosts: true, // Allow all hosts (e.g. when accessing via IP or custom hostname)
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3011',
        changeOrigin: true,
        secure: false,
        timeout: 300000, // 5 min for stats (loading many jobs from Redis can be slow under load)
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, res) => {
            // Suppress ENOBUFS and connection errors to prevent log spam
            if (err.code === 'ENOBUFS' || err.code === 'ECONNREFUSED') {
              if (res && !res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Backend server unavailable' }));
              }
              return;
            }
            console.error('Proxy error:', err);
          });
        },
      },
      '/data': {
        target: 'http://127.0.0.1:3011',
        changeOrigin: true,
        secure: false,
        timeout: 5000,
      },
    },
  },
})

