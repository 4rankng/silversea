import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Card 20260928_192: default to the port the backend actually binds
// (`backend/.env` PORT=3002), matching the Makefile and `vite.nowatch.config.mjs`.
// This said 3001, which is the STAGING import tool's port — so a plain
// `pnpm dev` proxied every /api call at a server that is not running.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3002';

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
    // Card 20260928_192: this file was the odd one out. `pnpm dev` here came up
    // on 7174 proxying to 3001, while the Makefile serves 7175 proxying to
    // 3002, every QA harness defaults to 7175, and `backend/.env` sets
    // PORT=3002. Nothing listens on 3001 except the separate staging-import
    // tool, so the short command produced a server whose /api calls went
    // nowhere — and the resulting 401/403 pointed at auth, not at the port.
    //
    // 7175 + 3002 are the contract, and they now match everything else. A test
    // (`src/tests/dev-port-contract.test.ts`) reads the Makefile and backend/.env
    // and fails if this drifts apart again, because the failure mode is silent.
    port: 7175,
    // Fail loudly if 7175 is taken instead of silently moving to another port,
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
