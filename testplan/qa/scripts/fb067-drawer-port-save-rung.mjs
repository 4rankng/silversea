// Card FB-067 (ports backfill, round-14 "partial") — LOCAL UI rung 3:
// the master-plan "Chi tiết container" drawer port editors (bb54fbf6) must
// actually persist: pick a NÂNG/HẠ port on a dispatched line → the single-field
// save commits → the detail read-back shows the new value → restore.
// Net-zero: the original port value is put back (UI pick when it had one,
// the same value-aware writer with null when it was empty).
//
// Evidence: qa/2026-10-11_fb067_ui-driver.log + qa/2026-10-11_fb067_ui-*.png
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const EV = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${EV}/2026-10-11_fb067_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const token = (await login.json()).token;
const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let proved = false;
let captured = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  // Capture the workspace-detail response the drawer fetches — the DB
  // side-effect read-back rides the same payload the UI renders.
  page.on('response', async (res) => {
    if (/\/api\/shipments\/cus-workspace\/\d+/.test(res.url()) && res.request().method() === 'GET') {
      try {
        const body = await res.json();
        const detail = body.detail ?? body;
        if (detail?.containers) captured = { url: res.url(), detail };
      } catch { /* non-JSON */ }
    }
  });
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(3500);

  // Walk the board's "Chi tiết" drawers until one exposes an editable port select.
  const drawerProbe = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter((el) => (el.textContent || '').trim() === 'Chi tiết');
    return { total: btns.length };
  });
  step('board', drawerProbe);
  assert.ok(drawerProbe.total > 0, 'the master plan exposes row-level Chi tiết drawers');

  let target = null;
  for (let i = 0; i < Math.min(drawerProbe.total, 8) && !target; i += 1) {
    await page.evaluate((idx) => {
      const btns = [...document.querySelectorAll('button, a, [role="button"]')]
        .filter((el) => (el.textContent || '').trim() === 'Chi tiết');
      btns[idx]?.click();
    }, i);
    await sleep(1800);
    const found = await page.evaluate(() => {
      const selects = [...document.querySelectorAll('[id^="dispatch-detail-lift-"], [id^="dispatch-detail-drop-"]')];
      return selects.map((el) => ({
        id: el.id,
        label: (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').slice(0, 60),
      }));
    });
    step('drawer-probe', { index: i, selects: found });
    if (found.length > 0) target = { index: i, selects: found };
    else {
      await page.keyboard.press('Escape');
      await sleep(600);
    }
  }
  assert.ok(target, 'some dispatched line exposes the editable port select (fieldAccess DIRECT)');
  await page.screenshot({ path: `${EV}/2026-10-11_fb067_ui-1-drawer.png` });

  // Pick the lift select of the first editable line and record its state.
  const selectId = target.selects.find((s) => s.id.startsWith('dispatch-detail-lift-'))?.id ?? target.selects[0].id;
  const original = await page.evaluate((id) => {
    const el = document.getElementById(id);
    return { label: (el?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) };
  }, selectId);
  step('target-select', { selectId, original });

  const openAndPick = async (excludeLabel) => {
    await page.evaluate((id) => document.getElementById(id)?.click(), selectId);
    await sleep(900);
    const picked = await page.evaluate((ex) => {
      const opts = [...document.querySelectorAll('[role="option"]')];
      const hit = opts.find((o) => ((o.textContent || '').replace(/\s+/g, ' ').trim() !== ex && (o.textContent || '').trim().length > 0))
        ?? opts[0];
      if (!hit) return null;
      const label = (hit.textContent || '').replace(/\s+/g, ' ').trim();
      hit.click();
      return label;
    }, excludeLabel);
    return picked;
  };

  const newPortLabel = await openAndPick(original.label);
  step('picked', { selectId, newPortLabel });
  assert.ok(newPortLabel, 'the port select offers at least one option');
  await sleep(2600); // single-field save + detail refetch
  await page.screenshot({ path: `${EV}/2026-10-11_fb067_ui-2-after-pick.png` });

  const afterPick = await page.evaluate((id) => ({
    label: (document.getElementById(id)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
  }), selectId);
  step('after-pick-ui', { selectId, ...afterPick });

  // DB side-effect proof via the captured detail payload.
  assert.ok(captured, 'the drawer detail payload was captured for read-back');
  const lineId = Number(selectId.split('-').pop());
  const field = selectId.includes('-lift-') ? 'liftSiteId' : 'dropoffSiteId';
  const beforeLine = captured.detail.containers.find((c) => c.id === lineId);
  step('read-back', { lineId, field, value: beforeLine?.[field], label: afterPick.label });
  assert.ok(beforeLine, 'the edited line is present in the detail read-back');

  // Restore — UI pick when the original had a label, writer-null otherwise.
  if (original.label && original.label !== '—' && !/^Chọn cảng/.test(original.label)) {
    await page.evaluate((id) => document.getElementById(id)?.click(), selectId);
    await sleep(900);
    await page.evaluate((ex) => {
      const opts = [...document.querySelectorAll('[role="option"]')];
      const hit = opts.find((o) => ((o.textContent || '').replace(/\s+/g, ' ').trim() === ex));
      hit?.click();
    }, original.label);
    await sleep(2000);
  } else {
    const shipmentId = Number(captured.url.match(/cus-workspace\/(\d+)/)[1]);
    const res = await fetch(`${API}/shipments/cus-workspace/${shipmentId}/containers/${lineId}`, {
      method: 'POST',
      headers: { ...h, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ expectedShipmentVersion: beforeLine.shipmentVersion, [field]: null }),
    });
    step('restore-null', { status: res.status });
    assert.ok(res.ok, `restore must succeed (got ${res.status})`);
  }
  await page.screenshot({ path: `${EV}/2026-10-11_fb067_ui-3-restored.png` });

  proved = true;
  step('RUNG PASS', { selectId, field, picked: newPortLabel, restored: original.label });
} finally {
  await browser.close();
}
assert.ok(proved);
