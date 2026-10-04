// Rung 330: month-picker popover footer seam (topbar "Chọn tháng") — real tap + seam measure + matrix.
// mutates: none
import { launch, probe, shot, setViewport, tap } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));

const clicked = await tap(page, 'button[aria-label^="Chọn tháng"]');
console.log('OPEN_MONTH_PICKER', JSON.stringify({ ev: clicked.after }));
await new Promise((r) => setTimeout(r, 1200));

const seam = await page.evaluate(() => {
  const p = document.querySelector('.month-picker, [class*=month-picker]');
  if (!p) return { open: false };
  const foot = p.querySelector('.month-picker__footer, [class*=footer]');
  const cs = foot ? getComputedStyle(foot) : null;
  const contentEnd = [...p.children].filter((c) => c !== foot).map((c) => c.getBoundingClientRect().bottom).pop() ?? p.getBoundingClientRect().top;
  const fr = foot?.getBoundingClientRect();
  return {
    open: true,
    footText: (foot?.innerText || '').replace(/\n/g, ' | ').slice(0, 80),
    marginTop: cs?.marginTop, paddingTop: cs?.paddingTop,
    borderTop: cs?.borderTopWidth + ' ' + cs?.borderTopStyle,
    seamPx: fr ? Math.round(fr.top - contentEnd) : null,
  };
});
console.log('SEAM', JSON.stringify(seam));
console.log('PROBE', JSON.stringify(await probe(page)));

for (const [w, h] of [[1280, 900], [1440, 900], [1920, 1080], [2560, 1400]]) {
  await setViewport(page, w, h);
  await shot(page, `${E}/monthpicker-${w}.png`, { full: false });
}
await setViewport(page, 1440, 900);
const box = await page.evaluate(() => {
  const p = document.querySelector('.month-picker, [class*=month-picker]');
  const b = p.getBoundingClientRect();
  return { x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 };
});
await page.screenshot({ path: `${E}/monthpicker-seam-crop.png`, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height } });
await setViewport(page, 390, 844);
await shot(page, `${E}/monthpicker-390.png`, { full: false });
console.log('SHOTS done');
await browser.close();
