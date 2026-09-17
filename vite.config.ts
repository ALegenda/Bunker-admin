import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ isSsrBuild }) => ({
  root: 'frontend',
  publicDir: false,
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
    ...(isSsrBuild
      ? {}
      : {
          rolldownOptions: {
            input: {
              app: fileURLToPath(new URL('./frontend/index.html', import.meta.url)),
              landing: fileURLToPath(new URL('./frontend/landing.html', import.meta.url)),
            },
          },
        }),
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:4173',
      '/auth': 'http://127.0.0.1:4173',
      '/releases': 'http://127.0.0.1:4173',
    },
  },
}));
