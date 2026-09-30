import { defineConfig } from 'vite';
export default defineConfig({ build: {
  emptyOutDir: false,
  rolldownOptions: { input: ['index.html', 'src/writing-preview/index.html', 'src/presence/index.html'] },
}, server: { proxy: {
  '/retrieval-api': { target: 'http://127.0.0.1:4189', changeOrigin: true, rewrite: path => path.replace(/^\/retrieval-api/, '') },
  '/api': { target: 'http://127.0.0.1:4184', changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') },
  '/description-api': { target: 'http://127.0.0.1:4188', changeOrigin: true, rewrite: path => path.replace(/^\/description-api/, '') },
  '/image-api': { target: 'http://127.0.0.1:4187', changeOrigin: true, rewrite: path => path.replace(/^\/image-api/, '') },
  '/generate-api': { target: 'http://127.0.0.1:4186', changeOrigin: true, rewrite: path => path.replace(/^\/generate-api/, '') },
  '/compose-api': { target: 'http://127.0.0.1:4185', changeOrigin: true, rewrite: path => path.replace(/^\/compose-api/, '') },
} } });
