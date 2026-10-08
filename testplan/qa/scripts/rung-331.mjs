// Rung 331: shared .row-actions safe-anchor render rung on the width-short hosts (CustomersPage, SupplierListPage).
// mutates: none
import { launch, probe, shot, setViewport } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.QA_USER || 'admin', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

for (const [path, tag, rowSel] of [
  ['/customers', 'customers', 'tbody tr'],
  ['/suppliers', 'suppliers', 'tbody tr'],
]) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));
  await new Promise((r) => setTimeout(r, 5500));
  // bleed probe: hover EACH row and measure it WHILE hovered (actions are hover-revealed)
  const rowCount = await page.evaluate((sel) => Math.min(4, document.querySelectorAll(sel).length), rowSel);
  const probeRes = [];
  for (let i = 0; i < rowCount; i++) {
    const rc = await page.evaluate((args) => {
      const r = document.querySelectorAll(args.sel)[args.i];
      if (!r) return null;
      const b = r.getBoundingClientRect();
      return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2) };
    }, { sel: rowSel, i });
    if (!rc) break;
    await page.mouse.move(rc.cx, rc.cy);
    await new Promise((r) => setTimeout(r, 450));
    const m = await page.evaluate((args) => {
      const r = document.querySelectorAll(args.sel)[args.i];
      const run = r.querySelector('.row-actions');
      if (!run) return { hasRun: false };
      const rr = run.getBoundingClientRect();
      const cell = run.closest('td');
      const cr = cell.getBoundingClientRect();
      const prev = cell.previousElementSibling?.getBoundingClientRect();
      const btns = [...run.querySelectorAll('.row-action')].map((b) => b.getBoundingClientRect());
      return {
        hasRun: true,
        visible: rr.width > 0,
        runLeftInCell: Math.round(rr.left - cr.left),
        bleedsIntoPrevCell: prev ? rr.left < prev.right - 1 : null,
        btnsRightGap: btns.length ? Math.round(cr.right - btns[btns.length - 1].right) : null,
        runFits: rr.width <= cr.width + 1,
      };
    }, { sel: rowSel, i });
    probeRes.push(m);
    if (i === 0 && m.hasRun) {
      await shot(page, `${E}/host-${tag}-hover-1440.png`, { full: false });
    }
  }
  console.log('BLEED_PROBE', tag, JSON.stringify(probeRes));
  console.log('PAGE', tag, JSON.stringify(await page.evaluate(() => ({ rows: document.querySelectorAll('tbody tr').length, head: document.body.innerText.slice(60, 160).replace(/\n/g, ' | ') }))));

  for (const [w, h] of [[1280, 900], [1440, 900], [1920, 1080], [2560, 1400]]) {
    await setViewport(page, w, h);
    await shot(page, `${E}/host-${tag}-${w}.png`, { full: false });
  }
}
console.log('PROBE_INPUT', JSON.stringify(await probe(page)));
console.log('SHOTS done');
await browser.close();
