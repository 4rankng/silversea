// FB-001 live probe — where do REAL taps land on the NGÀY GIỜ ĐÓNG TRẢ cell, and which open the picker?
import { launch, login, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('2026-10-09_wave8b-leadqa');
const log = `${dir}/driver-fb001-probe.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ width: 1440, height: 900 });
await login(page, 'thanhdc');
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);

const geo = await page.evaluate(() => {
  const root = document.querySelector('[data-split-datetime]');
  if (!root) return { root: null };
  const rb = root.getBoundingClientRect();
  const segs = [...root.querySelectorAll('input[data-seg]')].map((i) => {
    const b = i.getBoundingClientRect();
    return { seg: i.getAttribute('data-seg'), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  });
  const overlay = [...document.querySelectorAll('input')].filter((i) => /text-transparent/.test(i.className)).map((i) => {
    const b = i.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), z: getComputedStyle(i).zIndex, pe: getComputedStyle(i).pointerEvents };
  });
  return { root: { x: Math.round(rb.x), y: Math.round(rb.y), w: Math.round(rb.width), h: Math.round(rb.height) }, segs, overlay };
});
step(log, { step: 'geometry', ...JSON.parse(JSON.stringify(geo)) });
if (!geo.root) throw new Error('no [data-split-datetime] on page');

const dialogOpen = () => page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.textContent.includes('Chọn ngày giờ'));
  return d ? d.textContent.slice(0, 60) : null;
});
const closePicker = async () => { await page.keyboard.press('Escape'); await sleep(500); };
const realTap = async (name, x, y) => {
  const hit = await page.evaluate(({ x, y }) => {
    const n = document.elementFromPoint(x, y);
    if (!n) return null;
    const seg = n.closest && n.closest('[data-seg-part]');
    return { tag: n.tagName, cls: (n.className || '').toString().slice(0, 50), seg: seg ? seg.getAttribute('data-seg-part') : null };
  }, { x, y });
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
  await sleep(900);
  const opened = await dialogOpen();
  step(log, { step: 'probe', name, x: Math.round(x), y: Math.round(y), hit, opened: opened ? opened.slice(0, 40) : null });
  await closePicker();
};

const R = geo.root;
// P1: dead space right of the fit-content grid, still inside the root, mid-input-row
await realTap('P1-root-right-dead', R.x + R.w - 15, R.y + R.h * 0.7);
// P2: root center
await realTap('P2-root-center', R.x + R.w / 2, R.y + R.h * 0.7);
// P3: gap BETWEEN date and time groups (if segs present)
if (geo.segs && geo.segs.length >= 2) {
  const a = geo.segs[geo.segs.length - 2], b = geo.segs[geo.segs.length - 1];
  if (b.x - (a.x + a.w) > 6) await realTap('P3-between-groups', a.x + a.w + (b.x - a.x - a.w) / 2, a.y + a.h / 2);
  // P4: 3px frame strip just right of the last segment
  await realTap('P4-frame-strip', b.x + b.w + 1.5, b.y + b.h / 2);
  // P5: ON a segment (law: caret only, must NOT open)
  await realTap('P5-segment-hh', geo.segs[0].x + 8, geo.segs[0].y + geo.segs[0].h / 2);
}
// P6: label row area (top strip of the cell)
await realTap('P6-label-row', R.x + R.w / 2, R.y + 10);

await page.screenshot({ path: `${dir}/fb001-probe-final-state.png` });
step(log, { step: 'DONE' });
await browser.close();
console.log('PROBE DONE');
