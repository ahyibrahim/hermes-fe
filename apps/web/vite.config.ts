import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const proxyTarget = process.env.VITE_HERMES_PROXY_TARGET || 'http://ying-1:3000';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      '/health': { target: proxyTarget, changeOrigin: true },
      '/auth': { target: proxyTarget, changeOrigin: true },
      '/rooms': { target: proxyTarget, changeOrigin: true },
      '/messages': { target: proxyTarget, changeOrigin: true },
      '/files': { target: proxyTarget, changeOrigin: true },
      '/users': { target: proxyTarget, changeOrigin: true },
      '/ice': { target: proxyTarget, changeOrigin: true },
      '/ws': { target: proxyTarget, ws: true, changeOrigin: true },
    },
  },
});
