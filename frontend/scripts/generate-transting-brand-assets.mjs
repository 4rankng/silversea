#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public/assets');
const SOURCE = join(ROOT, 'assets-source/transting-logo-master.png');
const EMERALD = '#005A2D';

function render(args, outPath) {
  const result = spawnSync('magick', [SOURCE, ...args, '-strip', outPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`magick failed for ${outPath}: ${result.stderr || result.stdout || 'unknown error'}`);
  }
}

await mkdir(OUT, { recursive: true });

for (const size of [180, 192, 512, 1024]) {
  render(
    ['-filter', 'Lanczos', '-resize', `${size}x${size}`],
    join(OUT, `transting-logo-${size}.png`),
  );
}

for (const size of [192, 512]) {
  const safeSize = Math.round(size * 0.78);
  render(
    [
      '-filter', 'Lanczos',
      '-resize', `${safeSize}x${safeSize}`,
      '-gravity', 'center',
      '-background', EMERALD,
      '-extent', `${size}x${size}`,
    ],
    join(OUT, `transting-logo-maskable-${size}.png`),
  );
}

for (const size of [16, 32]) {
  render(
    ['-filter', 'Lanczos', '-resize', `${size}x${size}`],
    join(OUT, `transting-favicon-${size}.png`),
  );
}

for (const size of [192, 1024]) {
  const markSize = Math.round(size * 0.88);
  render(
    [
      '-transparent', EMERALD,
      '-trim', '+repage',
      '-filter', 'Lanczos',
      '-resize', `${markSize}x${markSize}`,
      '-gravity', 'center',
      '-background', 'none',
      '-extent', `${size}x${size}`,
    ],
    join(OUT, `transting-sidebar-mark-${size}.png`),
  );
}

console.log(`Generated TransTing brand assets from ${SOURCE}`);
