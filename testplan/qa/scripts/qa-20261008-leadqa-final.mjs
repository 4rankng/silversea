// Final QA rung v7 — cards 20261008_511 (VAT config UI) and 081026072302 fb055
// (doc-card height contract). MUTATION SURFACE (declared): the singleton VAT
// config on staging — single set + restore in the same run.
import { launch, login, tap, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';

const FREEZE = process.env.QA_FREEZE ?? '';
const dir = evidenceDir('20261008-leadqa-final');
const log = `${dir}/driver-v7.log`;
const sha = (await (await fetch(`${BASE}/api/health`)).json()).buildHash;
step(log, { step: 'build-currency', served: sha, freeze: FREEZE });
if (FREEZE && !sha.startsWith(FREEZE)) {
  step(log, { step: 'FAIL', error: `stale build ${sha} != ${FREEZE}` });
  process.exit(2);
}

// ── A. 511 — admin VAT rate card: read → set → persist → restore ────────────
{
  const { browser, page } = await launch();
  await login(page, 'admin');
  let landed = '';
  for (const p of ['/admin-center', '/admin']) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    const has = await page.evaluate(() => document.body.innerText.includes('VAT') || document.body.innerText.includes('Thuế'));
    if (has) { landed = p; break; }
  }
  step(log, { step: 'admin-page', landed });
  await shot(page, `${dir}/A-vat-card-initial.png`);
  const before = await page.evaluate(() => {
    const inp = document.querySelector('input[type="number"], input[name*="vat" i]');
    return inp ? inp.value : null;
  });
  step(log, { step: 'vat-before', before });
  // single mutation: set 8.5 → save → reload → verify → restore
  try {
    const sel = 'xpath///input[@type="number" or contains(translate(@name,"VAT","vat"),"vat")]';
    await page.click(sel, { clickCount: 3 });
    await page.type(sel, '8.5', { delay: 20 });
    await tap(page, 'xpath///button[contains(., "Lưu")]', log, 'vat-save');
    await new Promise((r) => setTimeout(r, 2500));
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 2000));
    const afterSave = await page.evaluate(() => {
      const inp = document.querySelector('input[type="number"], input[name*="vat" i]');
      return inp ? inp.value : null;
    });
    step(log, { step: 'vat-after-save', afterSave, persisted: afterSave === '8.5' });
    await shot(page, `${dir}/A-vat-card-saved.png`);
    // restore
    await page.click(sel, { clickCount: 3 });
    await page.type(sel, String(before ?? '10'), { delay: 20 });
    await tap(page, 'xpath///button[contains(., "Lưu")]', log, 'vat-restore');
    await new Promise((r) => setTimeout(r, 2000));
    step(log, { step: 'vat-restored', to: before });
  } catch (e) {
    step(log, { step: 'vat-flow-error', err: String(e).slice(0, 160) });
    await shot(page, `${dir}/A-vat-card-error.png`);
  }
  await browser.close();
}

// ── B. fb055 — doc-card height matrix (closed contract: 58 mobile / 62 wide) ─
{
  const { browser, page } = await launch();
  let who = null;
  for (const acc of ['dvthuc', 'bqhuong']) {
    try { await login(page, acc); who = acc; break; } catch (e) { step(log, { step: 'login-miss', acc }); }
  }
  let trip = null;
  for (const id of [117, 138]) {
    await page.goto(`${BASE}/my-trips/${id}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    const ok = await page.evaluate(() => Boolean(document.querySelector('.driver-task-footer__body')));
    if (ok) { trip = id; break; }
  }
  step(log, { step: 'doc-card-located', who, trip });
  for (const w of [320, 360, 390, 430, 768, 1280, 1440]) {
    await page.setViewport({ width: w, height: 900 });
    await new Promise((r) => setTimeout(r, 600));
    const m = await page.evaluate(() => {
      const el = document.querySelector('.driver-task-footer__body');
      return el ? { h: Math.round(el.getBoundingClientRect().height), closed: el.className.includes('--closed') } : null;
    });
    step(log, { step: 'measure', width: w, ...m });
    await shot(page, `${dir}/B-doc-card-${w}.png`);
  }
  await browser.close();
}
step(log, { step: 'DONE' });
