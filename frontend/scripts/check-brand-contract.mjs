import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const failures = [];

function magick(relativePath, args) {
  const assetPath = fileURLToPath(new URL(relativePath, import.meta.url));
  const result = spawnSync('magick', [assetPath, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`${relativePath}: ImageMagick inspection failed`);
    return '';
  }
  return result.stdout.trim();
}
const scopedRuntimeFiles = [
  '../src/components/Layout.tsx',
  '../src/components/AssetIcon.tsx',
  '../src/components/agent/AgentAssistant.tsx',
  '../src/components/layout/Sidebar.tsx',
  '../src/pages/LoginPage.tsx',
  '../src/lib/csv.ts',
  '../src/lib/routes.ts',
  '../index.html',
  '../public/manifest.json',
  '../public/sw.js',
  '../../backend/src/services/agent/orchestrator.ts',
  '../../backend/src/services/fuel-voucher.service.ts',
];

for (const relativePath of scopedRuntimeFiles) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  if (/\bTingTing\b|NEPO Logistics/.test(source)) {
    failures.push(`${relativePath}: legacy user-facing product label`);
  }
}

const brandSource = await readFile(new URL('../src/brand.ts', import.meta.url), 'utf8');
const tokenSource = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const buttonSource = await readFile(new URL('../src/components/Button.css', import.meta.url), 'utf8');
const dashboardSource = await readFile(new URL('../src/pages/DashboardPage.css', import.meta.url), 'utf8');
const tableSource = await readFile(new URL('../src/components/Table.css', import.meta.url), 'utf8');
for (const requiredCopy of [
  "name: 'TransTing'",
  "tagline: 'Vận tải thông minh. Doanh nghiệp vững mạnh.'",
  "shellDescriptor: 'Quản lý vận tải và logistics'",
  "logoPath: '/assets/transting-logo-192.png?v=4'",
  "sidebarLogoPath: '/assets/transting-sidebar-mark-192.png?v=4'",
]) {
  if (!brandSource.includes(requiredCopy)) {
    failures.push(`src/brand.ts: missing ${requiredCopy}`);
  }
}

for (const requiredToken of [
  '--color-primary: #005A2D',
  // f9bd16bc muted the accent palette; accent-2 is intentionally #2D6B54 now
  '--accent-2: #2D6B54',
  '--accent-ink: #00361B',
  '--brand: #005A2D',
  '--brand-hover: #00361B',
  '--sb-bg: #005A2D',
  '--sb-gradient-start: #005A2D',
  '--sb-gradient-end: #00361B',
  '--sidebar: #005A2D',
]) {
  if (!tokenSource.includes(requiredToken)) {
    failures.push(`src/styles/tokens.css: missing ${requiredToken}`);
  }
}

for (const [sourceName, source, requiredRule] of [
  [
    'src/components/Button.css',
    buttonSource,
    /\.d-btn-primary:hover:not\(:disabled\)\s*\{[^}]*background-color:\s*var\(--brand-hover\)/,
  ],
  [
    'src/pages/DashboardPage.css',
    dashboardSource,
    /\.dash-wf \.wf-btn--primary:hover\s*\{[^}]*background:\s*var\(--brand-hover\)/,
  ],
  [
    'src/pages/DashboardPage.css',
    dashboardSource,
    /\.dash-wf \.wf-minibtn\.green:hover\s*\{[^}]*background:\s*var\(--brand-hover\)/,
  ],
  [
    'src/components/Table.css',
    tableSource,
    /\.ancillary-fee-card__btn--approve:hover\s*\{[^}]*background:\s*var\(--brand\)/,
  ],
]) {
  if (!requiredRule.test(source)) {
    failures.push(`${sourceName}: missing emerald CTA rule ${requiredRule}`);
  }
}

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../public/manifest.json', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
if (!index.includes('TransTing') || !index.includes('<title>TransTing</title>')) {
  failures.push('index.html: missing TransTing browser title');
}
for (const size of [16, 32]) {
  if (!index.includes(`/assets/transting-favicon-${size}.png?v=5`)) {
    failures.push(`index.html: missing cache-busted ${size}px favicon`);
  }
  try {
    await access(new URL(`../public/assets/transting-favicon-${size}.png`, import.meta.url));
  } catch {
    failures.push(`public/assets/transting-favicon-${size}.png: missing tab asset`);
  }
}
if (!index.includes('<meta name="theme-color" content="#005A2D"')) {
  failures.push('index.html: browser theme color is not emerald');
}
if (!manifest.includes('"short_name": "TransTing"')) {
  failures.push('public/manifest.json: missing TransTing short name');
}
if (!manifest.includes('"theme_color": "#005A2D"')) {
  failures.push('public/manifest.json: PWA theme color is not emerald');
}
for (const requiredPwaMetadata of [
  '"start_url": "/"',
  '"scope": "/"',
  '"display": "standalone"',
  '"orientation": "portrait-primary"',
  '"lang": "vi"',
]) {
  if (!manifest.includes(requiredPwaMetadata)) {
    failures.push(`public/manifest.json: missing install metadata ${requiredPwaMetadata}`);
  }
}
if (!serviceWorker.includes("data.title || 'TransTing'")
  || !serviceWorker.includes("icon: data.icon || '/assets/transting-logo-192.png?v=4'")
  || !serviceWorker.includes("badge: '/assets/transting-sidebar-mark-192.png?v=4'")) {
  failures.push('public/sw.js: notification identity is not TransTing');
}
for (const size of [180, 192, 512, 1024]) {
  try {
    await access(new URL(`../public/assets/transting-logo-${size}.png`, import.meta.url));
  } catch {
    failures.push(`public/assets/transting-logo-${size}.png: missing PWA asset`);
  }
}

for (const size of [192, 1024]) {
  try {
    await access(new URL(`../public/assets/transting-sidebar-mark-${size}.png`, import.meta.url));
  } catch {
    failures.push(`public/assets/transting-sidebar-mark-${size}.png: missing sidebar mark`);
  }
}

for (const [relativePath, size] of [
  ['../public/assets/transting-favicon-16.png', 16],
  ['../public/assets/transting-favicon-32.png', 32],
  ['../public/assets/transting-logo-180.png', 180],
  ['../public/assets/transting-logo-192.png', 192],
  ['../public/assets/transting-logo-512.png', 512],
  ['../public/assets/transting-logo-1024.png', 1024],
  ['../public/assets/transting-logo-maskable-192.png', 192],
  ['../public/assets/transting-logo-maskable-512.png', 512],
  ['../public/assets/transting-sidebar-mark-192.png', 192],
  ['../public/assets/transting-sidebar-mark-1024.png', 1024],
]) {
  const geometry = magick(relativePath, ['-format', '%wx%h', 'info:']);
  if (geometry && geometry !== `${size}x${size}`) {
    failures.push(`${relativePath}: expected ${size}x${size}, got ${geometry}`);
  }
}

for (const size of [192, 512]) {
  if (!manifest.includes(`/assets/transting-logo-maskable-${size}.png?v=2`)) {
    failures.push(`public/manifest.json: missing ${size}px maskable icon`);
  }
}
if (!index.includes('/assets/transting-logo-180.png?v=4')
  || !index.includes('rel="apple-touch-icon"')) {
  failures.push('index.html: missing cache-busted Apple touch icon');
}

for (const size of [192, 512]) {
  const geometry = magick(
    `../public/assets/transting-logo-maskable-${size}.png`,
    ['-fuzz', '8%', '-fill', 'black', '+opaque', 'white', '-format', '%@', 'info:'],
  );
  const match = geometry.match(/^(\d+)x(\d+)\+(\d+)\+(\d+)$/);
  if (!match) {
    failures.push(`transting-logo-maskable-${size}.png: cannot measure white mark safe zone`);
    continue;
  }
  const [, width, height, x, y] = match.map(Number);
  const safeInset = Math.floor(size * 0.19);
  if (x < safeInset || y < safeInset
    || x + width > size - safeInset
    || y + height > size - safeInset) {
    failures.push(`transting-logo-maskable-${size}.png: route-T exceeds launcher safe zone (${geometry})`);
  }
}

const appCorner = magick(
  '../public/assets/transting-logo-192.png',
  ['-format', '%[pixel:p{0,0}]', 'info:'],
);
if (appCorner && appCorner !== 'srgb(0,90,45)') {
  failures.push('transting-logo-192.png: app tile corner is not opaque emerald');
}

const appLowerWhite = Number(magick(
  '../public/assets/transting-logo-192.png',
  ['-crop', '192x96+0+96', '-colorspace', 'Gray', '-threshold', '90%', '-format', '%[fx:mean]', 'info:'],
));
if (!Number.isFinite(appLowerWhite) || appLowerWhite < 0.1) {
  failures.push('transting-logo-192.png: route-T stem is missing from the lower half');
}

const faviconLowerWhite = Number(magick(
  '../public/assets/transting-favicon-16.png',
  ['-crop', '16x8+0+8', '-colorspace', 'Gray', '-threshold', '90%', '-format', '%[fx:mean]', 'info:'],
));
if (!Number.isFinite(faviconLowerWhite) || faviconLowerWhite < 0.05) {
  failures.push('transting-favicon-16.png: route-T is not legible in the lower half');
}

const appleCorner = magick(
  '../public/assets/transting-logo-180.png',
  ['-format', '%[pixel:p{0,0}]', 'info:'],
);
if (appleCorner && appleCorner !== 'srgb(0,90,45)') {
  failures.push('transting-logo-180.png: Apple touch icon corner is not opaque emerald');
}

const sidebarCorner = magick(
  '../public/assets/transting-sidebar-mark-192.png',
  ['-format', '%[pixel:p{0,0}]', 'info:'],
);
if (sidebarCorner && sidebarCorner !== 'graya(0,0)') {
  failures.push('transting-sidebar-mark-192.png: sidebar mark corner is not transparent');
}

const sidebarLowerAlpha = Number(magick(
  '../public/assets/transting-sidebar-mark-192.png',
  ['-crop', '192x96+0+96', '-channel', 'A', '-separate', '-format', '%[fx:mean]', 'info:'],
));
if (!Number.isFinite(sidebarLowerAlpha) || sidebarLowerAlpha < 0.1) {
  failures.push('transting-sidebar-mark-192.png: transparent route-T stem is missing');
}

if (failures.length > 0) {
  console.error('TransTing brand contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('TransTing brand contract passed.');
}
