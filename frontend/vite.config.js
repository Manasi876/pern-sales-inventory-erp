import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, /api/* is proxied to the Express backend (see backend PORT).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
