import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, Vite serves the frontend and proxies the API/WebSockets to the
// FastAPI server. In production, FastAPI serves the built files directly.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
