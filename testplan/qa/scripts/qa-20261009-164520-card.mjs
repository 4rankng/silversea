import { launch, step, BASE } from '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/scripts/lead-qa-harness.mjs';
const dir = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-09_card164520-weight';
const log = `${dir}/driver-164520-card.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) }).then((r) => r.json()).then((b) => b.token);
const { browser, page } = await launch({ width: 390, height: 844 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
try {
  await page.goto(`${BASE}/my-trips`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(5000);
  const seg = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((n) => /^Đã nhận/.test(n.textContent.trim())));
  const sEl = seg.asElement();
  if (!sEl) throw new Error('Đã nhận segment not found');
  await sEl.click();
  await sleep(2500);
  let found = null;
  for (let s = 0; s < 6 && !found; s++) {
    found = await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent.includes('TSTU4182600') || n.textContent.includes('TRP-202609-0045')));
      if (!el) return null;
      let r = el; for (let i = 0; i < 8 && r.parentElement; i++) { r = r.parentElement; if ((r.innerText || '').includes('kg')) break; }
      const txt = (r?.innerText || '').replace(/\s+/g, ' ');
      return { weight: (txt.match(/[\d.]+(?:,\d+)?\s*kg/i) || [])[0] || null, text: txt.slice(0, 200) };
    });
    if (!found) { await page.mouse.wheel({ deltaY: 600 }); await sleep(1000); }
  }
  step(log, { step: 'segment-tap', ok: true, card: found });
  await page.screenshot({ path: `${dir}/trip79-card-390.png` });
  const pass = !!found && /12\.500,5/i.test(found.weight || '');
  step(log, { step: 'DONE', verdict: pass ? 'PASS-card-12.500,5' : 'FAIL' });
  console.log(pass ? 'PASS — card shows 12.500,5 kg' : `FAIL — ${JSON.stringify(found).slice(0, 160)}`);
  process.exit(pass ? 0 : 1);
} catch (err) {
  step(log, { step: 'driver-error', error: String(err && err.message || err).slice(0, 200) });
  console.log('ERROR'); process.exit(1);
} finally { await browser.close(); }
