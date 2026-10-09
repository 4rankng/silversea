// v8 — adaptive: discover the VAT input shape + the doc-card's trip/driver,
// then execute both contracts (set/verify/restore + height matrix).
import { launch, login, tap, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';

const dir = evidenceDir('20261008-leadqa-final');
const log = `${dir}/driver-v8.log`;

// ── A. discover + drive the VAT card ───────────────────────────────────────
{
  const { browser, page } = await launch();
  await login(page, 'admin');
  await page.goto(`${BASE}/admin-center`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  const shape = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input,select')].map((i) => ({
      tag: i.tagName, type: i.type, name: i.name, id: i.id, ph: i.placeholder, value: i.value,
    }));
    const vatIdx = document.body.innerText.indexOf('VAT');
    return { inputs, vatText: vatIdx >= 0 ? document.body.innerText.slice(Math.max(0, vatIdx - 80), vatIdx + 160) : null };
  });
  step(log, { step: 'admin-shape', shape });
  // find input near the VAT label via DOM proximity
  const found = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')].filter((n) => n.children.length === 0 && /VAT|Thuế suất/i.test(n.textContent || ''));
    for (const n of nodes) {
      let scope = n.parentElement;
      for (let d = 0; d < 4 && scope; d++) {
        const inp = scope.querySelector('input,select');
        if (inp) return { sel: inp.id ? `#${inp.id}` : (inp.name ? `[name="${inp.name}"]` : null), tag: inp.tagName, type: inp.type, value: inp.value };
        scope = scope.parentElement;
      }
    }
    return null;
  });
  step(log, { step: 'vat-input', found });
  if (found?.sel) {
    const sel = found.sel.startsWith('#') || found.sel.startsWith('[') ? found.sel : found.sel;
    const before = await page.$eval(sel, (e) => e.value);
    await page.click(sel, { clickCount: 3 });
    await page.type(sel, '8.5', { delay: 20 });
    await tap(page, 'xpath///button[contains(., "Lưu")]', log, 'vat-save');
    await new Promise((r) => setTimeout(r, 2500));
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 2000));
    const after = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('*')].filter((n) => n.children.length === 0 && /VAT|Thuế suất/i.test(n.textContent || ''));
      for (const n of nodes) {
        let scope = n.parentElement;
        for (let d = 0; d < 4 && scope; d++) {
          const inp = scope.querySelector('input,select');
          if (inp) return inp.value;
          scope = scope.parentElement;
        }
      }
      return null;
    });
    step(log, { step: 'vat-persisted', before, after, persisted: after === '8.5' });
    await shot(page, `${dir}/A2-vat-saved.png`);
    await page.click(sel, { clickCount: 3 });
    await page.type(sel, String(before), { delay: 20 });
    await tap(page, 'xpath///button[contains(., "Lưu")]', log, 'vat-restore');
    step(log, { step: 'vat-restored', to: before });
  }
  await browser.close();
}

// ── B. discover the doc-card trip + measure heights ────────────────────────
{
  const { browser, page } = await launch();
  let who = 'bqhuong';
  await login(page, who).catch(async () => { who = 'dvthuc'; await login(page, who); });
  let trip = null;
  for (const id of [138, 117]) {
    await page.goto(`${BASE}/my-trips/${id}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    if (await page.evaluate(() => Boolean(document.querySelector('.driver-task-footer__body')))) { trip = id; break; }
  }
  if (!trip) {
    await page.goto(`${BASE}/my-trips`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="/my-trips/"]')].map((a) => a.getAttribute('href')).slice(0, 6));
    step(log, { step: 'trip-links', links });
    for (const href of links ?? []) {
      await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 2000));
      if (await page.evaluate(() => Boolean(document.querySelector('.driver-task-footer__body')))) { trip = href; break; }
    }
  }
  step(log, { step: 'doc-card-located', who, trip });
  if (trip) {
    for (const w of [320, 360, 390, 430, 768, 1280, 1440]) {
      await page.setViewport({ width: w, height: 900 });
      await new Promise((r) => setTimeout(r, 600));
      const m = await page.evaluate(() => {
        const el = document.querySelector('.driver-task-footer__body');
        return el ? { h: Math.round(el.getBoundingClientRect().height), closed: el.className.includes('--closed'), txt: (el.innerText || '').slice(0, 40) } : null;
      });
      step(log, { step: 'measure', width: w, ...m });
      await shot(page, `${dir}/B2-doc-card-${w}.png`);
    }
  }
  await browser.close();
}
step(log, { step: 'DONE' });
