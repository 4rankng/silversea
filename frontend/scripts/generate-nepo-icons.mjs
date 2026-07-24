#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public/assets/icons/nepo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const icons = [
  { name: 'dashboard', label: 'Dashboard', glyph: 'grid', accent: '#00B14F' },
  { name: 'dispatch', label: 'Dispatch', glyph: 'compass', accent: '#00B14F' },
  { name: 'trips', label: 'Trips', glyph: 'truck', accent: '#00B14F' },
  { name: 'fleet', label: 'Fleet', glyph: 'garage', accent: '#008B3E' },
  { name: 'customers', label: 'Customers', glyph: 'people', accent: '#1E5BB8' },
  { name: 'routes', label: 'Routes', glyph: 'route', accent: '#00B14F' },
  { name: 'salary', label: 'Salary', glyph: 'calendar', accent: '#00B14F' },
  { name: 'penalties', label: 'Penalties', glyph: 'warning', accent: '#E32434' },
  { name: 'finance', label: 'Finance', glyph: 'chart', accent: '#00B14F' },
  { name: 'debt', label: 'Receivables', glyph: 'receipt-in', accent: '#1E5BB8' },
  { name: 'payables', label: 'Payables', glyph: 'receipt-out', accent: '#F5A623' },
  { name: 'expenses', label: 'Expenses', glyph: 'wallet', accent: '#F5A623' },
  { name: 'advances', label: 'Advances', glyph: 'cash', accent: '#00B14F' },
  { name: 'settlements', label: 'Settlements', glyph: 'stamp', accent: '#008B3E' },
  { name: 'audit', label: 'Audit', glyph: 'log', accent: '#1E5BB8' },
  { name: 'config', label: 'Config', glyph: 'settings', accent: '#4D5852' },
  { name: 'config-fuel', label: 'Fuel norms', glyph: 'fuel-pump', accent: '#00B14F' },
  { name: 'config-road-allowances', label: 'Road allowances', glyph: 'toll-gate', accent: '#008B3E' },
  { name: 'config-trip-expense', label: 'Trip expense', glyph: 'trip-cost', accent: '#F5A623' },
  { name: 'config-penalty-reasons', label: 'Penalty rules', glyph: 'rule-warning', accent: '#E32434' },
  { name: 'config-drivers', label: 'Drivers', glyph: 'driver-card', accent: '#1E5BB8' },
  { name: 'config-cap-table', label: 'Cap table', glyph: 'pie-ledger', accent: '#008B3E' },
  { name: 'config-customers', label: 'Customers', glyph: 'client-book', accent: '#1E5BB8' },
  { name: 'config-routes', label: 'Route catalog', glyph: 'route-pins', accent: '#00B14F' },
  { name: 'config-trucks', label: 'Trucks', glyph: 'tractor-head', accent: '#008B3E' },
  { name: 'config-trailers', label: 'Trailers', glyph: 'trailer-box', accent: '#00B14F' },
  { name: 'config-cargo-types', label: 'Cargo types', glyph: 'cargo-crate', accent: '#B7791F' },
  { name: 'config-pricing-tables', label: 'Pricing tables', glyph: 'price-tag', accent: '#00B14F' },
  { name: 'config-management-fees', label: 'Management fees', glyph: 'percent-receipt', accent: '#F5A623' },
  { name: 'config-salary-periods', label: 'Salary periods', glyph: 'calendar-cycle', accent: '#00B14F' },
  { name: 'config-expense-categories', label: 'Expense categories', glyph: 'folder-coins', accent: '#F5A623' },
  { name: 'config-container-types', label: 'Container types', glyph: 'container-stack', accent: '#1E5BB8' },
  { name: 'config-seal-types', label: 'Seal types', glyph: 'security-seal', accent: '#008B3E' },
  { name: 'config-ports', label: 'Ports and yards', glyph: 'port-anchor', accent: '#1E5BB8' },
  { name: 'config-forwarder-expense-types', label: 'Forwarder expenses', glyph: 'handoff-bill', accent: '#00B14F' },
];

function glyph(name, accent) {
  const common = `stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const soft = `fill="${accent}" fill-opacity=".12" stroke="${accent}" stroke-opacity=".34"`;
  switch (name) {
    case 'grid':
      return `<path ${common} d="M22 22h16v16H22zM50 22h16v16H50zM22 50h16v16H22zM50 50h16v16H50z"/>`;
    case 'compass':
      return `<circle ${common} cx="44" cy="44" r="23"/><path ${common} d="m53 31-6 18-18 6 6-18 18-6z"/><circle fill="${accent}" cx="41" cy="43" r="3"/>`;
    case 'truck':
      return `<path ${common} d="M16 49h35V29H16zM51 38h12l9 11v10H51zM24 61a6 6 0 1 0 0 .1M60 61a6 6 0 1 0 0 .1"/><path ${common} d="M22 36h21M22 43h14"/>`;
    case 'garage':
      return `<path ${common} d="M18 39 44 22l26 17v29H18z"/><path ${common} d="M28 68V48h32v20M34 55h20M34 62h20"/>`;
    case 'people':
      return `<circle ${common} cx="35" cy="34" r="9"/><circle ${common} cx="56" cy="38" r="7"/><path ${common} d="M20 66c3-12 11-19 24-19s21 7 24 19M50 55c8 1 13 5 16 11"/>`;
    case 'route':
      return `<path ${common} d="M22 62c18-29 30-35 45-20s-3 20-23 4S19 38 28 27c8-9 22-7 30 4"/><circle ${soft} cx="25" cy="63" r="6"/><circle ${soft} cx="58" cy="31" r="6"/>`;
    case 'calendar':
      return `<rect ${common} x="20" y="24" width="48" height="46" rx="8"/><path ${common} d="M30 18v12M58 18v12M20 38h48M32 50h8M48 50h8M32 60h8"/>`;
    case 'warning':
      return `<path ${common} d="m44 19 28 50H16L44 19z"/><path ${common} d="M44 35v16M44 60h.1"/>`;
    case 'chart':
      return `<path ${common} d="M20 66h50M26 58V43M42 58V29M58 58V37"/><path ${common} d="m25 38 15-12 13 8 15-17"/>`;
    case 'receipt-in':
      return `<path ${common} d="M25 18h38v52l-7-4-6 4-6-4-6 4-6-4-7 4z"/><path ${common} d="M34 34h20M34 45h20M34 56h12"/><path ${common} d="m61 48-8-8m0 0v7m0-7h7"/>`;
    case 'receipt-out':
      return `<path ${common} d="M25 18h38v52l-7-4-6 4-6-4-6 4-6-4-7 4z"/><path ${common} d="M34 34h20M34 45h20M34 56h12"/><path ${common} d="m53 40 8 8m0 0v-7m0 7h-7"/>`;
    case 'wallet':
      return `<path ${common} d="M20 31h43a8 8 0 0 1 8 8v24a7 7 0 0 1-7 7H22a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8h36"/><path ${common} d="M55 47h18v15H55z"/><circle fill="${accent}" cx="62" cy="55" r="2.5"/>`;
    case 'cash':
      return `<rect ${common} x="18" y="28" width="52" height="34" rx="7"/><circle ${common} cx="44" cy="45" r="9"/><path ${common} d="M27 39v-3h7M61 51v3h-7"/>`;
    case 'stamp':
      return `<path ${common} d="M36 18h16v12c0 5 4 9 9 9v10H27V39c5 0 9-4 9-9V18zM23 49h42v16H23zM29 65v7h30v-7"/><path ${common} d="M32 57h24"/>`;
    case 'log':
      return `<path ${common} d="M24 19h31l13 13v38H24z"/><path ${common} d="M55 19v14h13M34 43h24M34 54h24M34 65h15"/>`;
    case 'settings':
      return `<path ${common} d="M44 25v-7M44 70v-7M25 44h-7M70 44h-7M30 30l-5-5M63 63l-5-5M58 30l5-5M25 63l5-5"/><circle ${common} cx="44" cy="44" r="14"/><circle fill="${accent}" fill-opacity=".18" cx="44" cy="44" r="6"/>`;
    case 'fuel-pump':
      return `<path ${common} d="M25 68V24a6 6 0 0 1 6-6h22a6 6 0 0 1 6 6v44M21 68h42"/><path ${common} d="M32 27h20v14H32zM59 29l9 9v21a5 5 0 0 1-10 0V47h-4"/><path ${common} d="m66 36 4-4"/>`;
    case 'toll-gate':
      return `<path ${common} d="M18 59h52M23 59V31h42v28M30 59V38h9v21M49 59V38h9v21M19 31h50"/><path ${common} d="M31 24h26M44 18v13"/><circle fill="${accent}" cx="44" cy="48" r="3"/>`;
    case 'trip-cost':
      return `<path ${common} d="M18 54h20V36H18zM50 31h13l8 10v13H50zM26 61a5 5 0 1 0 0 .1M61 61a5 5 0 1 0 0 .1"/><path ${common} d="M18 62h53M34 26c7-7 20-6 28 2"/><path ${common} d="M42 44h11M48 38v12"/>`;
    case 'rule-warning':
      return `<path ${common} d="M24 19h30l10 10v39H24zM54 19v11h10M33 40h13M33 51h10"/><path ${common} d="m58 47 9 16H49l9-16z"/><path ${common} d="M58 53v4M58 61h.1"/>`;
    case 'driver-card':
      return `<rect ${common} x="19" y="24" width="50" height="38" rx="8"/><circle ${common} cx="35" cy="39" r="7"/><path ${common} d="M25 55c2-7 6-10 10-10s8 3 10 10M50 37h12M50 47h9M50 55h12"/>`;
    case 'pie-ledger':
      return `<path ${common} d="M42 21v23h23c0-13-10-23-23-23z"/><path ${common} d="M38 25a21 21 0 1 0 23 23H38z"/><path ${common} d="M22 69h44"/>`;
    case 'client-book':
      return `<path ${common} d="M24 20h34a7 7 0 0 1 7 7v41H29a7 7 0 0 1-7-7V22c0-1 1-2 2-2z"/><path ${common} d="M30 20v48M38 34h18M38 45h18"/><circle fill="${accent}" cx="49" cy="56" r="4"/>`;
    case 'route-pins':
      return `<path ${common} d="M25 62c10-11 29 3 38-12 6-10-7-17-20-8-12 8-23 2-20-10"/><path ${common} d="M25 19c8 0 13 6 13 13 0 10-13 22-13 22S12 42 12 32c0-7 5-13 13-13zM63 38c7 0 12 5 12 12 0 9-12 19-12 19S51 59 51 50c0-7 5-12 12-12z"/><circle fill="${accent}" cx="25" cy="32" r="3"/><circle fill="${accent}" cx="63" cy="50" r="3"/>`;
    case 'tractor-head':
      return `<path ${common} d="M18 52V30h28l9 12v10H18zM46 35h8l8 9v8h-7"/><path ${common} d="M23 38h15M23 45h10M29 62a7 7 0 1 0 0 .1M58 62a7 7 0 1 0 0 .1"/>`;
    case 'trailer-box':
      return `<path ${common} d="M17 31h48v24H17zM17 55h55M27 64a6 6 0 1 0 0 .1M58 64a6 6 0 1 0 0 .1"/><path ${common} d="M27 31v24M40 31v24M53 31v24"/>`;
    case 'cargo-crate':
      return `<path ${common} d="m44 18 25 13v27L44 72 19 58V31z"/><path ${common} d="M19 31l25 14 25-14M44 45v27M31 25l25 14"/>`;
    case 'price-tag':
      return `<path ${common} d="M22 24h26l21 21-25 25-21-21V24z"/><circle ${common} cx="36" cy="38" r="4"/><path ${common} d="M43 53c4 4 10 2 10-3s-8-5-8-10 6-7 10-3M49 34v23"/>`;
    case 'percent-receipt':
      return `<path ${common} d="M26 18h36v52l-6-4-6 4-6-4-6 4-6-4-6 4z"/><path ${common} d="M35 57 55 34"/><circle ${common} cx="37" cy="37" r="4"/><circle ${common} cx="53" cy="54" r="4"/>`;
    case 'calendar-cycle':
      return `<rect ${common} x="19" y="23" width="50" height="46" rx="8"/><path ${common} d="M30 18v11M58 18v11M19 37h50"/><path ${common} d="M34 55a11 11 0 0 0 19 5M54 49a11 11 0 0 0-19-5"/><path ${common} d="M53 60h-7M35 44h7"/>`;
    case 'folder-coins':
      return `<path ${common} d="M17 30h21l6 7h27v26a7 7 0 0 1-7 7H24a7 7 0 0 1-7-7z"/><ellipse ${common} cx="48" cy="51" rx="12" ry="5"/><path ${common} d="M36 51v9c0 3 5 5 12 5s12-2 12-5v-9"/>`;
    case 'container-stack':
      return `<path ${common} d="M17 26h54v16H17zM17 46h25v16H17zM46 46h25v16H46z"/><path ${common} d="M27 26v16M39 26v16M51 26v16M61 26v16M27 46v16M56 46v16"/>`;
    case 'security-seal':
      return `<path ${common} d="M33 38V27a11 11 0 0 1 22 0v11"/><rect ${common} x="25" y="38" width="38" height="30" rx="8"/><path ${common} d="M44 50v8"/><circle fill="${accent}" cx="44" cy="49" r="4"/>`;
    case 'port-anchor':
      return `<path ${common} d="M44 18v41M35 27h18M31 59c3 7 8 10 13 10s10-3 13-10"/><path ${common} d="M24 48H14c0 11 8 21 18 23M64 48h10c0 11-8 21-18 23"/><circle ${common} cx="44" cy="24" r="5"/>`;
    case 'handoff-bill':
      return `<path ${common} d="M19 50h13l7 8h11c4 0 7 3 7 7H35l-8-7H19z"/><path ${common} d="M57 65h8c5 0 8-3 10-7M55 24h-27v26"/><path ${common} d="M36 24h27v28H36zM44 35h12M44 43h8"/><circle fill="${accent}" cx="62" cy="58" r="3"/>`;
    default:
      return `<circle ${common} cx="44" cy="44" r="22"/>`;
  }
}

function svg({ label, glyph: glyphName, accent }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" fill="none" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="bg" x1="12" y1="8" x2="76" y2="80" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#F1F8F4"/>
    </linearGradient>
    <filter id="shadow" x="0" y="0" width="88" height="88" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#005A2D" flood-opacity=".12"/>
    </filter>
  </defs>
  <rect x="10" y="10" width="68" height="68" rx="20" fill="url(#bg)" stroke="#D7DEDB" filter="url(#shadow)"/>
  <rect x="16" y="16" width="56" height="56" rx="16" fill="${accent}" fill-opacity=".055"/>
  <g transform="translate(0 0)" color="#101513">
    ${glyph(glyphName, accent)}
  </g>
</svg>
`;
}

async function renderPng(icon) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });
  const encoded = Buffer.from(svg(icon)).toString('base64');
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent;width:256px;height:256px}.wrap{width:256px;height:256px;display:grid;place-items:center}img{width:256px;height:256px}</style><div class="wrap"><img src="data:image/svg+xml;base64,${encoded}"></div>`);
  await page.screenshot({ path: join(OUT, `${icon.name}.png`), omitBackground: true });
  await browser.close();
}

await mkdir(OUT, { recursive: true });
for (const icon of icons) {
  await writeFile(join(OUT, `${icon.name}.svg`), svg(icon), 'utf8');
}

const manifest = {
  name: 'NEPO logistics icon set',
  version: 1,
  sizes: { svg: '88x88 viewBox', png: '256x256 transparent' },
  icons: icons.map(({ name, label, accent }) => ({
    name,
    label,
    svg: `/assets/icons/nepo/${name}.svg`,
    png: `/assets/icons/nepo/${name}.png`,
    accent,
  })),
};
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

for (const icon of icons) {
  await renderPng(icon);
}

console.log(`Generated ${icons.length} SVG and PNG icons in ${OUT}`);
