// Card 071026212500 — lead staging QA on cut 781f746a: a driver can remove a
// photo from their own DRAFT e-POD. Fixture: upload a small PNG to trip 79's
// DRAFT submission via API, remove it via the UI trash control, verify the
// slot is freed (API files list empty) — staging left as found.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb212500-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '781f746a' });
const healthCheck = String(health.buildHash || '').startsWith('781f746a');
log('health', { buildHash: health.buildHash, expect: '781f746a', ok: healthCheck });
if (!healthCheck) { log('build-currency-FAIL'); process.exit(2); }

const login = async (id) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  const j = await r.json();
  if (!j.token) throw new Error(`login ${id} failed`);
  return j.token;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const token = await login('bqhuong');
  const auth = { Authorization: `Bearer ${token}` };

  // --- Fixture: upload a small PNG to the DRAFT submission on trip 79 ---
  const trip = await fetch(`${API}/driver/me/trips/79`, { headers: auth }).then((r) => r.json());
  const t = trip.trip ?? trip;
  const fid = t.fulfillmentId ?? t.fulfillment_id ?? t.fulfillment?.id;
  log('trip79', { fulfillmentId: fid, keys: Object.keys(t).slice(0, 20) });
  if (!fid) throw new Error('no fulfillmentId on trip 79');

  const pod = await fetch(`${API}/driver/me/fulfillments/${fid}/pod`, { headers: auth }).then((r) => r.json());
  const sub = (pod.items || [])[0] ?? pod.submission ?? pod;
  const sid = sub.id;
  log('pod-submission', { id: sid, status: sub.status, version: sub.version, files: (sub.files || []).length });
  if (!sid || sub.status !== 'DRAFT') { log('FAIL-trip79-not-draft'); exitCode = 1; throw new Error('submission not DRAFT'); }

  // 1x1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'leadqa-212500.png');
  form.append('fileType', 'YARD_OR_DROP_RECEIPT');
  form.append('expectedVersion', String(sub.version ?? 0));
  const up = await fetch(`${API}/driver/me/fulfillments/${fid}/pod/${sid}/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `leadqa-212500-${Date.now()}` }, body: form });
  const upj = await up.json();
  const subAfter = upj.submission ?? upj;
  const uploaded = (subAfter.files || [])[0];
  log('upload', { status: up.status, fileId: uploaded?.id, filesAfter: (subAfter.files || []).length, name: uploaded?.originalName ?? uploaded?.fileName ?? uploaded?.storageKey ?? null });
  const fileId = uploaded?.id;
  if (!fileId) { log('FAIL-upload'); exitCode = 1; throw new Error('upload failed: ' + JSON.stringify(upj).slice(0, 200)); }

  // --- UI: open the pod page, click the trash control on that file row ---
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((tok) => localStorage.setItem('token', tok), token);
  await page.goto(`${BASE}/my-trips/79/pod`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);

  const rowInfo = await page.evaluate(() => {
    // The file row renders as 'Tải lên <timestamp>' inside the slot section.
    const upEl = [...document.querySelectorAll('*')].filter((e) => e.offsetParent !== null && e.children.length <= 1 && /Tải lên/.test(e.textContent || '')).pop();
    if (!upEl) return { found: false, reason: 'no Tải lên line' };
    let row = upEl;
    for (let i = 0; i < 5 && row; i += 1) {
      if (row.querySelector('button')) break;
      row = row.parentElement;
    }
    const btns = row ? [...row.querySelectorAll('button')].filter((e) => e.offsetParent !== null) : [];
    // The remove affordance is the last control on the file row (icon-only).
    const btn = btns[btns.length - 1] ?? null;
    if (!btn) return { found: true, btn: false, rowText: (row?.textContent || '').trim().slice(0, 120) };
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    return { found: true, btn: true, x: r.x + r.width / 2, y: r.y + r.height / 2, rowText: (row.textContent || '').trim().slice(0, 120) };
  });
  log('file-row', rowInfo);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-file-row.png` });
  if (!rowInfo.found || !rowInfo.btn) { log('FAIL-no-remove-control', rowInfo); exitCode = 1; throw new Error('no remove control'); }

  await page.mouse.move(rowInfo.x, rowInfo.y); await page.mouse.down(); await page.mouse.up();
  await sleep(2500);

  const after = await page.evaluate(() => {
    const body = document.body.textContent || '';
    return {
      emptySlotText: body.includes('Chưa có tệp nào cho mục này'),
      uploadLineGone: !/Tải lên \d{2}:\d{2}/.test(body),
      toast: [...document.querySelectorAll('[role="status"], [class*="toast"], [class*="Toast"]')].map((e) => (e.textContent || '').trim()).find((x) => x.length > 3) ?? null,
    };
  });
  log('after-remove', after);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-after-remove.png` });

  // --- API: the slot is really freed ---
  const podAfter = await fetch(`${API}/driver/me/fulfillments/${fid}/pod`, { headers: auth }).then((r) => r.json());
  const subAfter2 = (podAfter.items || [])[0] ?? podAfter.submission ?? podAfter;
  const filesLeft = (subAfter2.files || []).length;
  log('api-verify', { filesLeft, status: subAfter2.status });
  const apiOk = filesLeft === 0 && subAfter2.status === 'DRAFT';

  // Self-cleanup: sweep any leftover uploads (reruns) so trip 79 is left as found.
  for (const f of (subAfter2.files || [])) {
    await fetch(`${API}/driver/me/fulfillments/${fid}/pod/${sid}/files/${f.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `leadqa-212500-cleanup-${f.id}-${Date.now()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: subAfter2.version }),
    });
    await sleep(300);
  }
  const finalPod = await fetch(`${API}/driver/me/fulfillments/${fid}/pod`, { headers: auth }).then((r) => r.json());
  const finalSub = (finalPod.items || [])[0] ?? finalPod;
  log('cleanup', { filesFinal: (finalSub.files || []).length, status: finalSub.status });

  if (after.toast && String(after.toast).includes('Đã gỡ tệp') && after.emptySlotText && apiOk) {
    log('PASS-remove', { toast: after.toast, filesLeft });
  } else { log('FAIL', { hasToast: Boolean(after.toast), emptySlotText: after.emptySlotText, uploadLineGone: after.uploadLineGone, filesLeft }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
