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
  build: {
    // The one deliberate >500 kB chunk is exceljs (~940 kB min): a single
    // self-contained module that cannot be split further and is loaded
    // lazily on first Excel export (lib/csv.ts). The eager main chunk stays
    // ~680 kB after vendor splitting. Raise the threshold past the largest
    // lazy chunk instead of contorting the graph for a heuristic default.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Split stable vendor libraries from app code so dep-bump releases
        // don't invalidate the whole download for returning visitors.
        // IMPORTANT: match exact package names — a substring like 'react'
        // would also swallow react-markdown/react-aria, and any module that
        // shares a chunk with eager code downloads eagerly.
        manualChunks(id) {
          // Match the LAST node_modules segment — pnpm nests real paths as
          // node_modules/.pnpm/<pkg>@<v>/node_modules/<pkg>/…
          const marker = id.lastIndexOf('node_modules/');
          if (marker === -1) return undefined;
          const segments = id.slice(marker + 'node_modules/'.length).split('/');
          const pkg = segments[0]?.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
          if (['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom',
            '@tanstack/react-query', '@tanstack/query-core'].includes(pkg)) return 'vendor-react';
          if (pkg === 'animejs') return 'vendor-anim';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 7174,
    // Fail loudly if 7174 is taken instead of silently moving to 7174/7175,
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
