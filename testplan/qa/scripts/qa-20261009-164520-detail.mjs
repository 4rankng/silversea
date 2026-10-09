// Lead QA rung — card 091026164520 on staging (build eff6efac). Trip 79 weight:
// journey card 'Đã nhận' and trip detail 'Số cont & seal' must render the SAME
// (declared) weight — 12.500,5 kg, NOT 18.500 kg on the detail side.
import { launch, step, BASE } from '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/scripts/lead-qa-harness.mjs';
const dir = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-09_card164520-weight';
const log = `${dir}/driver-164520.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXPECT = 'eff6efac';

const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
step(log, { step: 'build-currency', buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { console.log('BUILD-CURRENCY FAIL'); process.exit(2); }

const token = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) }).then((r) => r.json()).then((b) => b.token);
if (!token) { step(log, { step: 'login-FAIL' }); process.exit(2); }

const { browser, page } = await launch({ width: 390, height: 844 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
try {
  // 1) journey board — tab 'Đã nhận', trip 79 card
  await page.goto(`${BASE}/my-trips`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);
  const tab = await page.evaluateHandle(() => [...document.querySelectorAll('button,[role="tab"]')].find((n) => n.textContent.trim().startsWith('Đã nhận')));
  let tEl = tab.asElement();
  if (tEl) {
    await tEl.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await sleep(400);
    const bb = tEl.boundingBox();
    step(log, { step: 'tab-measure', bb: bb ? { x: bb.x, y: bb.y, w: bb.width, h: bb.height } : null });
    if (bb && Number.isFinite(bb.x + bb.y + bb.width + bb.height) && bb.width > 0) {
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.mouse.down(); await page.mouse.up(); await sleep(2000);
    }
  }
  const card = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.includes('EGLV260904500013'));
    if (!el) return { found: false, bodyHas: document.body.innerText.includes('EGLV260904500013') };
    const cardRoot = el.closest('[class*="card"], li, article, div');
    const txt = (cardRoot?.innerText || el.closest('div')?.innerText || '').replace(/\s+/g, ' ');
    return { found: true, weight: (txt.match(/[\d.]+,?\d*\s*kg/i) || [])[0] || null, text: txt.slice(0, 160) };
  });
  step(log, { step: 'journey-card', tabFound: !!tEl, ...card });
  await page.screenshot({ path: `${dir}/trip79-card-390.png` });

  // 2) trip detail — 'Số cont & seal'
  await page.goto(`${BASE}/my-trips/79`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);
  const detail = await page.evaluate(() => {
    const body = document.body.innerText;
    const sec = [...document.querySelectorAll('h1,h2,h3,h4,dt,strong,th')].find((n) => /số cont/i.test(n.textContent));
    let secText = '';
    if (sec) { let s = sec.parentElement; for (let i = 0; i < 3 && s && s.innerText.length < 40; i++) s = s.parentElement; secText = (sec.closest('section') || sec.parentElement)?.innerText?.replace(/\s+/g, ' ').slice(0, 220) || ''; }
    const kgMatches = [...body.matchAll(/([\d.]+(?:,\d+)?)\s*kg/gi)].map((m) => m[1]);
    return { hasSection: !!sec, secText, kgValues: [...new Set(kgMatches)], bodyHas18500: body.includes('18.500'), bodyHas12500: body.includes('12.500,5') };
  });
  step(log, { step: 'trip-detail', ...detail });
  await page.screenshot({ path: `${dir}/trip79-detail-390.png` });

  // verdict: card shows 12.500,5; detail no longer 18.500 and shows 12.500,5
  const pass = card.found && /12\.500,5/i.test(card.weight || '') && !detail.bodyHas18500 && detail.bodyHas12500;
  step(log, { step: 'DONE', verdict: pass ? 'PASS-consistent-12.500,5' : 'FAIL', cardWeight: card.weight, detailKg: detail.kgValues });
  console.log(pass ? 'PASS — card & detail both 12.500,5 kg (18.500 gone)' : 'FAIL — see log');
  process.exit(pass ? 0 : 1);
} catch (err) {
  step(log, { step: 'driver-error', error: String(err && err.message || err).slice(0, 200) });
  console.log('ERROR'); process.exit(1);
} finally { await browser.close(); }
