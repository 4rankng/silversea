import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tingting/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 7174,
    // Fail loudly if 7174 is taken instead of silently moving to 7175/7176,
    // which would desync the browser from the /api + /socket.io proxy.
    strictPort: true,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      // socket.io (assistant transport). `ws: true` proxies the WebSocket
      // upgrade handshake; without it the engine.io upgrade fails in dev.
      '/socket.io': {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
