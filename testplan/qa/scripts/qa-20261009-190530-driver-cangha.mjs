// Lead rung driver — card 091026190530 (FB-082): driver IMPORT "Cảng hạ".
// PHASE=before  → run on the PRE-FIX build: expects the DEFECT (Hạ dead row
//                 "Chưa có nơi trả rỗng" while Giao hàng carries the yard).
// PHASE=after   → run on the FIX build: expects Hạ/Cảng hạ = the yard.
// Fixture (chosen by API census, RUNNING bucket): driver bqhuong, BL
// EGLV260904500013, tradeDirection IMPORT, dropPortName 'Bãi JJ LOGISTICS',
// returnDepotName null — the exact reported shape.
import { launch, step, evidenceDir, BASE } from './lead-qa-harness.mjs';

const PHASE = process.env.PHASE === 'after' ? 'after' : 'before';
const dir = evidenceDir('2026-10-09_card190530-cangha');
const log = `${dir}/driver-190530-${PHASE}.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}-${PHASE}.png` });
const BL = 'EGLV260904500013';
const YARD = 'Bãi JJ LOGISTICS';
const DEAD = 'Chưa có nơi trả rỗng';

const { browser, page } = await launch({ width: 390, height: 844 });
try {
  await page.goto(`${BASE}/api/health`, { waitUntil: 'networkidle2', timeout: 60000 });
  const health = await page.evaluate(() => document.body.innerText);
  const buildHash = health.match(/"buildHash":"([^"]+)"/)?.[1] ?? health.slice(0, 60);
  step(log, { phase: PHASE, step: 'build-currency', buildHash });

  const token = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) }).then((r) => r.json()).then((b) => b.token);
  if (!token) throw new Error('api login failed');
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/my-trips`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);

  // RUNNING trips live under the 'Đã nhận' segment (default view is empty).
  // The segment label carries its count ('Đã nhận 1'), so match by prefix.
  const seg = await page.evaluateHandle(() => {
    const cands = [...document.querySelectorAll('button,[role="tab"],[role="segment"]')].filter((n) => (n.textContent || '').includes('Đã nhận'));
    return cands.sort((a, b) => a.textContent.length - b.textContent.length)[0] ?? null;
  });
  const segEl = seg.asElement();
  if (!segEl) throw new Error("segment 'Đã nhận' not found");
  await segEl.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await sleep(200);
  await segEl.click();
  await sleep(2500);

  // The segment view renders exactly one card carrying this BL — assert on a
  // text window around it (CSS uppercases the labels visually; textContent
  // keeps 'Hạ'/'Giao hàng' as authored).
  const bodyText = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  const iBl = bodyText.indexOf(BL);
  if (iBl < 0) throw new Error(`card ${BL} not rendered`);
  const cardScope = bodyText.slice(Math.max(0, iBl - 60), iBl + 420);
  const cardHa = cardScope.includes(`Hạ ${YARD}`);
  const cardDead = cardScope.includes(DEAD);
  const cardGiao = cardScope.includes(`Giao hàng ${YARD}`);
  step(log, { phase: PHASE, step: 'card', cardHa, cardDead, cardGiao, cardScope: cardScope.slice(0, 200) });
  await shot(page, '190530-card');

  // Open the trip detail (one card in view → the first detail button is its).
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Xem chi tiết')));
  const btnEl = btn.asElement();
  if (!btnEl) throw new Error('Xem chi tiết button not found');
  await btnEl.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await sleep(200);
  await btnEl.click();
  await page.waitForFunction(() => /\/my-trips\/\d+/.test(location.pathname), { timeout: 30000 });
  await sleep(3500);

  const facts = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.driver-task-fact')];
    const read = (label) => rows.find((r) => r.querySelector('.driver-task-fact__label')?.textContent === label)?.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? null;
    return { cangHa: read('Cảng hạ'), diaChi: read('Địa chỉ giao hàng') };
  });
  step(log, { phase: PHASE, step: 'detail', ...facts });
  await shot(page, '190530-detail');

  if (PHASE === 'before') {
    const pass = cardDead && cardGiao && facts.cangHa === DEAD && facts.diaChi === YARD;
    step(log, { phase: PHASE, step: 'DONE', verdict: pass ? 'DEFECT-REPRODUCED' : 'DEFECT-NOT-REPRODUCED', cardDead, cardGiao, facts });
    console.log(pass ? `BEFORE: defect reproduced — Hạ dead row + Cảng hạ '${DEAD}' while Giao hàng/Địa chỉ = ${YARD}` : `BEFORE: defect NOT reproduced — inspect log`);
    if (!pass) process.exit(1);
  } else {
    const pass = cardHa && !cardDead && facts.cangHa === YARD && facts.diaChi === YARD;
    step(log, { phase: PHASE, step: 'DONE', verdict: pass ? 'PASS' : 'FAIL', cardHa, cardDead, facts });
    console.log(pass ? `AFTER: PASS — Hạ ${YARD} on card, Cảng hạ ${YARD} on detail` : `AFTER: FAIL — inspect log`);
    if (!pass) process.exit(1);
  }
} catch (err) {
  step(log, { phase: PHASE, step: 'error', error: String(err && err.message || err).slice(0, 200) });
  await shot(page, '190530-error').catch(() => {});
  console.log('ERROR:', String(err && err.message || err).slice(0, 200));
  process.exit(2);
} finally {
  await browser.close();
}
