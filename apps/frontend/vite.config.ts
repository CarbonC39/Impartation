import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: '../../assets',
  server: {
    port: 5173, strictPort: true,
    proxy: {
      '/health': 'http://127.0.0.1:2567',
      '/matchmake': 'http://127.0.0.1:2567',
      '^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$': { target: 'ws://127.0.0.1:2567', ws: true },
    },
  },
});
