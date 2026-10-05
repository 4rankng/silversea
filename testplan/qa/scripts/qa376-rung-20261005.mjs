// Card 376 — audit rung: THEO DÕI HÓA ĐƠN KẾT HỢP vs spec bảng 1.1.2.
// Read-only: staging login, DOM contract extraction, full-page captures at
// 1280/1440/1920/2560, one alternate-period state. No mutation taps — the
// Tiến độ select and row actions are observed, never operated.
import {
  loginApi, launch, auth, probe, shot, setViewport, logEvidence, sleep, tapAt, STAGING,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_card376-invoice-tracking-spec-audit';
const LOG = [];

function log(step, obj) {
  const entry = { at: new Date().toISOString(), step, ...obj };
  LOG.push(entry);
  console.log(JSON.stringify(entry));
}

const health = await fetch(`${STAGING}/api/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, status: health.status });

const session = await loginApi('admin', 'Abc123');
const token = session.token ?? session.accessToken ?? session?.data?.token;
if (!token) throw new Error(`no token in login response: ${Object.keys(session)}`);
log('login', { ok: true, role: session.user?.role ?? session.role ?? 'unknown' });

const { browser, page } = await launch({ width: 1440, height: 1000 });
try {
  await auth(page, token, '/accounting/invoice-tracking');
  log('nav', { url: page.url() });

  const contract = await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const headers = [...document.querySelectorAll('.record-table thead th')].map(text);
    const firstRow = [...document.querySelectorAll('.record-table tbody tr')][0];
    const cells = firstRow ? [...firstRow.querySelectorAll('td')].map((td) => ({
      label: td.getAttribute('data-label'),
      text: text(td).slice(0, 80),
    })) : [];
    const rail = [...document.querySelectorAll('[aria-label="Tổng cộng theo kỳ"] *')].map(text).filter(Boolean);
    const filters = [...document.querySelectorAll('input, select, button')].slice(0, 40).map((el) => ({
      tag: el.tagName,
      type: el.type || null,
      aria: el.getAttribute('aria-label'),
      placeholder: el.placeholder || null,
      text: el.tagName === 'BUTTON' ? text(el).slice(0, 40) : null,
    })).filter((f) => f.aria || f.placeholder || f.text);
    const progressOptions = [...document.querySelectorAll('.invoice-tracking-progress select option')].map((o) => text(o));
    return {
      title: document.title,
      h1: text(document.querySelector('h1')),
      headers,
      rowCount: document.querySelectorAll('.record-table tbody tr').length,
      firstRow: cells,
      rail: rail.slice(0, 12),
      filters,
      progressOptions,
      progressRendered: [...document.querySelectorAll('[data-label="Tiến độ"]')].slice(0, 3).map(text),
    };
  });
  log('contract', contract);

  // Full-page captures at the mandated widths. The table is unpaginated, so
  // guard fullPage: if rows ever exceed 300, fall back to viewport captures.
  const full = contract.rowCount <= 300;
  for (const width of [1280, 1440, 1920, 2560]) {
    await setViewport(page, width, 1000);
    const path = `${EV}/376-invoice-tracking-${width}${full ? '-full' : '-viewport'}.png`;
    await shot(page, path, { full });
    log('shot', { path: path.replace(EV + '/', ''), width, full });
  }

  // Alternate period state (Tháng trước preset) — real trusted tap only.
  try {
    const preset = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Tháng trước');
      if (!btn) return null;
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!preset) throw new Error('Tháng trước preset button not found');
    await tapAt(page, preset.x, preset.y, { label: 'preset:Tháng trước', settle: 1200 });
    const alt = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('.record-table tbody tr').length,
      empty: Boolean(document.querySelector('[class*="empty" i], [role="status"]')),
      emptyText: (document.querySelector('[class*="empty" i]')?.textContent || '').trim().slice(0, 120),
    }));
    log('alt-state', alt);
    await setViewport(page, 1440, 1000);
    await shot(page, `${EV}/376-invoice-tracking-alt-period-1440-full.png`, { full: alt.rowCount <= 300 });
    log('shot', { path: '376-invoice-tracking-alt-period-1440-full.png' });
  } catch (e) {
    log('alt-state-failed', { error: String(e.message || e) });
  }

  logEvidence(EV, 'driver-contract.json', { health, contract, altState: LOG.find((l) => l.step === 'alt-state') ?? null, log: LOG });
  const p = await probe(page);
  log('probe', p);
  console.log(`DONE rows=${contract.rowCount} headers=${contract.headers.length}`);
} finally {
  await browser.close();
}
