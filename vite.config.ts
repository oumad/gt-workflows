import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow connections from network
    port: 3010,
    strictPort: true, // Fail if port is in use instead of falling back
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3011',
        changeOrigin: true,
        secure: false,
        timeout: 60000, // 60 second timeout for large file downloads
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
        target: 'http://localhost:3011',
        changeOrigin: true,
        secure: false,
        timeout: 5000,
      },
    },
  },
})

