// Lead QA rung FINAL — card 091026091510 on staging (build ⊇ 45993f90).
// TEST-LCL-362 quick-edit schedule: set → save → clear → save → set → save → no-op save → clear/restore.
// AC: 5/5 saves succeed; the guard toast 'Dữ liệu hoặc quyền chỉnh sửa vừa thay đổi...' appears ZERO times.
// Rot-aware: trusted CDP input dies intermittently after in-session navigation
// (capture-phase evidence, standing ruling) — on a dead tap the whole cycle
// restarts in a FRESH browser pointed straight at the list page.
import { launch, login, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('2026-10-09_round8-leadqa');
const log = `${dir}/driver-leadqa-091510-final.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png` });
const SAVED = 'Đã cập nhật lịch đóng/trả.';

async function oneAttempt(attempt) {
  const { browser, page } = await launch({ width: 1440, height: 900 });
  try {
    await page.goto(`${BASE}/api/health`, { waitUntil: 'networkidle2', timeout: 60000 });
    const health = await page.evaluate(() => document.body.innerText);
    step(log, { attempt, step: 'build-currency', buildHash: health.match(/"buildHash":"([^"]+)"/)?.[1] ?? health.slice(0, 60) });

    // House pattern (AGENTS §9): token-inject BEFORE any SPA navigation — the
    // UI-login + in-session navigation path is what kills trusted CDP input
    // (rot proven by capture-phase counters earlier today).
    const token = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) }).then((r) => r.json()).then((b) => b.token);
    if (!token) throw new Error('api login failed');
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(3000);

    const openCell = async () => {
      // the lot moves with sorting after each save — narrow the list first
      const filter = await page.$('input[placeholder*="Bill, Book"]');
      if (filter) {
        // React controlled input: set via the native value setter + input
        // event (filter is navigation transport; the AC taps live in the editor)
        await filter.evaluate((n) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(n, 'TEST-LCL-362');
          n.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await sleep(2500);
      }
      // arm the capture-phase counter right before the FIRST trusted tap
      await page.evaluate(() => { window.__rot = { down: 0 }; document.addEventListener('mousedown', () => { try { window.__rot.down++; } catch {} }, { capture: true, passive: true }); });
      const cell = await page.evaluateHandle(() => {
        const tr = [...document.querySelectorAll('tr')].find((n) => n.textContent.includes('TEST-LCL-362'));
        return tr ? [...tr.querySelectorAll('button')].find((b) => b.className.includes('cus-inline-trigger') && (b.getAttribute('aria-label') || '').includes('lịch trình')) : null;
      });
      let el = cell.asElement();
      // the post-save list refetch can lag — poll before giving up
      for (let i = 0; i < 3 && !el; i++) {
        await sleep(3000);
        const retry = await page.evaluateHandle(() => {
          const tr = [...document.querySelectorAll('tr')].find((n) => n.textContent.includes('TEST-LCL-362'));
          return tr ? [...tr.querySelectorAll('button')].find((b) => b.className.includes('cus-inline-trigger') && (b.getAttribute('aria-label') || '').includes('lịch trình')) : null;
        });
        el = retry.asElement();
      }
      if (!el) {
        const diag = await page.evaluate(() => ({ filter: document.querySelector('input[placeholder*="Bill, Book"]')?.value, trCount: document.querySelectorAll('tr').length, hasRow: document.body.innerText.includes('TEST-LCL-362') }));
        throw new Error(`schedule cell not found (poll exhausted): ${JSON.stringify(diag)}`);
      }
      await el.evaluate((n) => n.scrollIntoView({ block: 'center', inline: 'center' }));
      await sleep(500);
      const bb = await el.boundingBox();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(1200);
      const rot = await page.evaluate(() => window.__rot.down);
      const modal = await page.$('.cus-quick-edit-modal');
      if (!modal) throw new Error(`ROT(${rot === 0 ? 'no-events' : 'events-but-no-editor'})`);
      step(log, { attempt, step: 'editor-open', mousedowns: rot });
    };
    const setField = async (input, text) => {
      await input.click({ clickCount: 3 });
      await sleep(200);
      await page.keyboard.type(text, { delay: 45 });
      await sleep(200);
    };
    const typeSchedule = async (hhmm, ddmmyyyy) => {
      const inputs = await page.$$('.cus-quick-edit-modal input');
      if (inputs.length < 2) throw new Error(`expected time+date inputs, found ${inputs.length}`);
      await setField(inputs[0], hhmm);
      await setField(inputs[1], ddmmyyyy);
      step(log, { attempt, step: 'typed', hhmm, ddmmyyyy });
    };
    const clearSchedule = async () => {
      const inputs = await page.$$('.cus-quick-edit-modal input');
      if (inputs.length < 2) throw new Error(`expected time+date inputs, found ${inputs.length}`);
      for (const input of inputs) {
        const bb = await input.boundingBox();
        await page.mouse.move(bb.x + 8, bb.y + bb.height / 2);
        await page.mouse.down();
        await page.mouse.up();
        await sleep(180);
        await page.keyboard.press('End');
        await sleep(80);
        await page.keyboard.down('Shift');
        await page.keyboard.press('Home');
        await page.keyboard.up('Shift');
        await sleep(80);
        await page.keyboard.press('Backspace');
        await sleep(120);
        for (let i = 0; i < 12; i++) { await page.keyboard.press('Backspace'); await sleep(60); }
        await sleep(150);
      }
      step(log, { attempt, step: 'cleared' });
    };
    const saveModal = async (label, expectText) => {
      let sawGuard = false;
      const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lưu thay đổi'));
      const el = btn.asElement();
      if (!el) throw new Error('Lưu thay đổi not found');
      await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
      await sleep(250);
      const bb = await el.boundingBox();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      // success signal = the modal closes (draft dropped only on success or
      // 409-guard); disambiguate by the row's cell text afterwards
      await page.waitForFunction(() => !document.querySelector('.cus-quick-edit-modal'), { timeout: 30000 }).catch(() => {});
      await sleep(1500);
      const guard = await page.evaluate(() => document.body.innerText.includes('Dữ liệu hoặc quyền chỉnh sửa vừa thay đổi'));
      if (guard) sawGuard = true;
      // read the schedule cell text of the target row
      const cellText = await page.evaluate(() => {
        const tr = [...document.querySelectorAll('tr')].find((n) => n.textContent.includes('TEST-LCL-362'));
        if (!tr) return 'ROW-NOT-FOUND';
        const b = [...tr.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('lịch trình'));
        return b ? b.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) : 'NO-CELL';
      });
      const res = sawGuard ? 'guard' : (expectText && cellText.includes(expectText) ? 'saved' : (expectText ? 'mismatch' : 'closed'));
      step(log, { attempt, step: 'save', label, result: res, cellText, sawGuard });
      await shot(page, `s1510-${label}`);
      const modalOpen = await page.evaluate(() => !!document.querySelector('.cus-quick-edit-modal'));
      if (modalOpen) {
        const huy = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Hủy'));
        const h = huy.asElement();
        if (h) { const bb2 = await h.boundingBox(); await page.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2); await page.mouse.down(); await page.mouse.up(); await sleep(800); }
      }
      await sleep(600);
      return res;
    };

    await openCell();
    await typeSchedule('0800', '12102026');
    const r1 = await saveModal('set1', '12/10/2026');

    await openCell();
    await clearSchedule();
    const r2 = await saveModal('clear-REPORTED-LOCK', 'Chưa chốt ngày');

    await openCell();
    await typeSchedule('0900', '12102026');
    const r3 = await saveModal('set2', '12/10/2026');

    await openCell();
    const r4 = await saveModal('noop', '12/10/2026');

    await openCell();
    await clearSchedule();
    const r5 = await saveModal('restore-original', 'Chưa chốt ngày');

    const all = { r1, r2, r3, r4, r5 };
    const fails = Object.entries(all).filter(([, v]) => v !== 'saved');
    step(log, { attempt, step: 'CYCLE-RESULTS', ...all, pass: fails.length === 0 });
    await shot(page, `s1510-a${attempt}-final`);
    if (fails.length) return { outcome: 'FAIL', all };
    return { outcome: 'PASS', all };
  } catch (err) {
    step(log, { attempt, step: 'attempt-error', error: String(err && err.message || err).slice(0, 140) });
    return { outcome: 'ROT', error: String(err && err.message || err).slice(0, 140) };
  } finally {
    await browser.close();
  }
}

let final = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  const r = await oneAttempt(attempt);
  if (r.outcome === 'PASS' || r.outcome === 'FAIL') { final = r; break; }
  step(log, { step: 'relaunch-fresh', attempt, error: r.error });
}
if (!final) {
  step(log, { step: 'DONE', verdict: 'EXHAUSTED-3-FRESH-SESSIONS' });
  console.log('EXHAUSTED — see driver log');
  process.exit(2);
}
step(log, { step: 'DONE', verdict: final.outcome, ...final.all });
console.log(final.outcome === 'PASS' ? 'PASS 5/5 — no guard toast' : `FAIL: ${JSON.stringify(final.all)}`);
if (final.outcome !== 'PASS') process.exit(1);
