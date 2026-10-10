import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const envDir = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const backend = `http://127.0.0.1:${env.PORT || 2567}`;
  return {
    envDir,
    publicDir: '../../assets',
    server: {
      port: 5173, strictPort: true,
      proxy: {
        '/health': backend,
        '/matchmake': backend,
        '^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(?:\\?|$)': { target: backend, ws: true },
      },
    },
  };
});
