// Lead QA rung — cards 20261008_1/_3/_4/_5 (disabled reasons, chip counts,
// toast load, tab accessible names). Real mouse taps/hover only; build-currency
// gate refuses to score a build older than the freeze sha.
import { launch, login, tap, hoverAndFocus, shot, step, watchNet, evidenceDir, BASE } from './lead-qa-harness.mjs';

const FREEZE = 'dc599a82';
const dir = evidenceDir('20261008-leadqa-batch');
const log = `${dir}/driver.log`;
const sha = (await (await fetch(`${BASE}/api/health`)).json()).buildHash;
step(log, { step: 'build-currency', served: sha, freeze: FREEZE });
if (!sha.startsWith(FREEZE)) {
  step(log, { step: 'FAIL', error: `stale build ${sha} != ${FREEZE} — refusing to score` });
  process.exit(2);
}

const reasons = [
  'Chưa có bộ lọc nào để xóa.',
  'Không có dữ liệu để xuất',
  'Chưa có dữ liệu',
  'Đang tải',
  'Đã gán hết',
  'Lưu thay đổi điều phối trước khi phát lệnh',
];
const bodyHas = (text) => document.body.innerText.includes(text);

// ── A. admin: /customers load produces ZERO toasts (card _4) ────────────────
{
  const { browser, page } = await launch();
  const fails = watchNet(page, log);
  await login(page, 'admin');
  let toasts = 0;
  await page.evaluate(() => {
    window.__toasts = 0;
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && /toast/i.test(n.className || '')) window.__toasts += 1;
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
  await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  toasts = await page.evaluate(() => window.__toasts ?? 0);
  step(log, { step: 'customers-load', toasts, netFails: fails.slice(0, 5) });
  await shot(page, `${dir}/A-customers-load-no-toast.png`);
  await browser.close();
}

// ── B. admin: /shipments tab accessible names carry the space (card _5) ─────
{
  const { browser, page } = await launch();
  await login(page, 'admin');
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  const names = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => ({
      name: (t.getAttribute('aria-label') ?? t.textContent ?? '').trim(),
      text: (t.textContent ?? '').trim(),
    })));
  step(log, { step: 'tab-accessible-names', names });
  await shot(page, `${dir}/B-shipments-tabs.png`);
  await browser.close();
}

// ── C. dungnv: /dispatch-detail chips + a disabled footer reason (cards _3,_1)
{
  const { browser, page } = await launch();
  await login(page, 'dungnv');
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  const chips = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role="button"], label')) {
      const t = (el.textContent || '').trim();
      if (/Chưa gán xe|Đã gán xe/.test(t)) out.push(t.replace(/\s+/g, ' '));
    }
    return out;
  });
  step(log, { step: 'assignment-chips', chips });
  await shot(page, `${dir}/C-detailplan-chips.png`);
  // hover the footer's disabled controls to reveal reasons
  for (const label of ['Phát lệnh', 'Lưu thay đổi', 'Hoàn thành chuyến']) {
    try { await hoverAndFocus(page, `xpath///button[contains(normalize-space(.), "${label}")]`, log, label); } catch (e) { step(log, { step: 'hover-miss', label, err: String(e).slice(0, 80) }); }
    await new Promise((r) => setTimeout(r, 200));
  }
  const reasonHit = await page.evaluate((rs) => rs.filter((r) => document.body.innerText.includes(r)), reasons);
  step(log, { step: 'detailplan-reasons-visible', reasonHit });
  await shot(page, `${dir}/C-detailplan-disabled-reasons.png`);
  await browser.close();
}

// ── D. thanhdc: /shipments-debit export + Xóa lọc reasons (card _1) ─────────
{
  const { browser, page } = await launch();
  await login(page, 'thanhdc');
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  for (const label of ['Xuất Debit Note', 'Xóa lọc']) {
    try { await hoverAndFocus(page, `xpath///button[contains(normalize-space(.), "${label}")]`, log, label); } catch (e) { step(log, { step: 'hover-miss', label, err: String(e).slice(0, 80) }); }
    await new Promise((r) => setTimeout(r, 200));
  }
  const reasonHit = await page.evaluate((rs) => rs.filter((r) => document.body.innerText.includes(r)), reasons);
  step(log, { step: 'debit-reasons-visible', reasonHit });
  await shot(page, `${dir}/D-shipment-debit-reasons.png`);
  await browser.close();
}

step(log, { step: 'DONE' });
