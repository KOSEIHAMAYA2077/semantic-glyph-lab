import { defineConfig } from 'vite';
export default defineConfig({ server: { proxy: {
  '/api': { target: 'http://127.0.0.1:4184', changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') },
  '/generate-api': { target: 'http://127.0.0.1:4186', changeOrigin: true, rewrite: path => path.replace(/^\/generate-api/, '') },
  '/compose-api': { target: 'http://127.0.0.1:4185', changeOrigin: true, rewrite: path => path.replace(/^\/compose-api/, '') },
} } });
