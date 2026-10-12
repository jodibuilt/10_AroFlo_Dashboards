import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Proxies /api and /auth to the Express backend (src/server.js, port 4300)
// so the browser sees everything as same-origin — the backend's httpOnly
// session cookie just works with no CORS/credentials setup needed.
const BACKEND_URL = 'http://localhost:4300';

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    proxy: {
      '/api': { target: BACKEND_URL, changeOrigin: true },
      '/auth': { target: BACKEND_URL, changeOrigin: true },
    },
  },
}));
