// Session tool: a second Vite instance for screenshot/QA doc sessions that
// must not full-reload when agents edit frontend/src concurrently.
// Mirrors vite.config.ts (plugins, aliases, /api proxy, port 7176) but with
// `server.watch = null`. Bare plugin imports are required —
// vite externalizes them in the config bundle so react-refresh resolves via
// pnpm siblings; absolute-path imports break that and 500 on transform.
// Leaves the shared :7175 instance untouched.
// Run: cd frontend && npx vite --config vite.nowatch.config.mjs
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3002';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const FE = '/Volumes/LexarSSD/projects/silversea-prod/frontend';

export default {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(FE, './src'),
      '@tingting/shared': path.resolve(FE, '../shared/src'),
    },
  },
  server: {
    port: 7176,
    strictPort: true,
    watch: null,
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
      '/socket.io': { target: apiProxyTarget, changeOrigin: true, ws: true },
    },
  },
};
