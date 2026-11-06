// Lane SIL-697 UI drive — the REAL driver e-POD screen on the lane stack
// (FE :7180 → API :3004, this worktree's fixed code).
// Scenario (owner acceptance, Frank 06/11):
//   1. e-POD DRAFT with ONLY the yard receipt → HOÀN THÀNH CHUYẾN must be
//      refused BEFORE any submit: warning toast naming the missing type,
//      ZERO /pod/:id/submit requests, submission stays DRAFT.
//   2. Both file types present → the same button submits + completes.
// Screenshots + network log land in qa/2026-11-06-lane-696-697/.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const FE = process.env.LANE_FE || 'http://localhost:7180';
const API = process.env.LANE_API || 'http://localhost:3004/api';
const TRIP = Number(process.env.LANE_TRIP || 40);
const FULFILLMENT = Number(process.env.LANE_FULFILLMENT || 171);
const DRIVER = process.env.LANE_DRIVER || 'dvthuc';
const TRIP_VERSION = Number(process.env.LANE_TRIP_VERSION || 5);
const OUT = new URL('../2026-11-06-lane-696-697/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };

const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: DRIVER, password: 'Abc123' }) });
const { token } = await loginRes.json();
if (!token) throw new Error('driver login failed: ' + JSON.stringify(await loginRes.json()));
const adminRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const adminToken = (await adminRes.json()).token;

const apiCall = async (method, path, payload, key) => {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: payload == null ? undefined : JSON.stringify(payload) });
  let body; try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
};

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 414, height: 900 });
  const submitRequests = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/pod/') && url.endsWith('/submit')) submitRequests.push({ url, method: req.method(), at: new Date().toISOString() });
  });
  const completeRequests = [];
  page.on('request', (req) => { if (req.url().endsWith('/complete')) completeRequests.push({ url: req.url(), method: req.method() }); });

  await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
  await page.goto(`${FE}/my-trips/${TRIP}/pod`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);

  const footerText = await page.evaluate(() => document.querySelector('.driver-task-footer')?.textContent ?? null);
  check('footer renders Hoàn thành chuyến with required-files copy', /Cần đủ cả Phiếu bãi \/ phiếu hạ/.test(footerText ?? ''), footerText?.slice(0, 220));
  await page.screenshot({ path: `${OUT}sil-697_ui-1-initial-yard-only.png` });

  // Ensure a DRAFT exists and holds ONLY the yard receipt (UI file inputs drive
  // the real upload path; the slots are the two required types in shared order).
  // GET /pod returns { items: [submissions] } — latest first by version.
  const podLatest = async () => {
    const items = (await apiCall('GET', `/driver/me/fulfillments/${FULFILLMENT}/pod`)).body?.items ?? [];
    return [...items].sort((a, b) => (b.submissionVersion ?? 0) - (a.submissionVersion ?? 0))[0] ?? null;
  };
  let submission = await podLatest();
  if (!submission || submission.status === 'REJECTED') {
    const created = await apiCall('POST', `/driver/me/fulfillments/${FULFILLMENT}/pod`, { expectedVersion: TRIP_VERSION }, `lane697-draft-${Date.now()}`);
    submission = created.body;
    console.log('draft created', created.status, JSON.stringify(submission)?.slice(0, 200));
  }
  const files = submission?.files ?? [];
  const hasYard = files.some((f) => f.fileType === 'YARD_OR_DROP_RECEIPT');
  const hasSigned = files.some((f) => f.fileType === 'SIGNED_DELIVERY_NOTE');
  console.log('draft', submission?.id, 'status', submission?.status, 'yard', hasYard, 'signed', hasSigned);

  const inputs = await page.$$('input[type="file"]');
  console.log('file inputs on page:', inputs.length);
  if (!hasYard && inputs.length >= 1) {
    await inputs[0].uploadFile(new URL('lane-pod-yard.png', import.meta.url).pathname);
    await sleep(2500);
  }
  const afterYard = await podLatest();
  const yardFiles = (afterYard?.files ?? []).filter((f) => f.fileType === 'YARD_OR_DROP_RECEIPT');
  check('yard receipt attached (1/2 files)', yardFiles.length >= 1, `files=${JSON.stringify((afterYard?.files ?? []).map((f) => f.fileType))}`);
  await page.screenshot({ path: `${OUT}sil-697_ui-2-yard-only-draft.png` });

  // ── The bug path: tap HOÀN THÀNH CHUYẾN with 1/2 files ──
  submitRequests.length = 0; completeRequests.length = 0;
  const tapped = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('HOÀN THÀNH CHUYẾN'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('tapped HOÀN THÀNH CHUYẾN with yard-only draft', tapped);
  await sleep(1500);
  const toastText = await page.evaluate(() => {
    const toasts = [...document.querySelectorAll('[role="alert"], [role="status"], .toast, [class*="toast"]')];
    return toasts.map((t) => t.textContent?.trim()).filter(Boolean).join(' | ');
  });
  check('BLOCKED with message naming the missing type', /Chưa đủ chứng từ giao hàng/.test(toastText) && /Biên bản giao nhận/.test(toastText), toastText.slice(0, 220));
  check('ZERO submit requests went out', submitRequests.length === 0, JSON.stringify(submitRequests));
  check('ZERO complete requests went out', completeRequests.length === 0, JSON.stringify(completeRequests));
  const stillDraft = await podLatest();
  check('submission still DRAFT (no nháp nộp dở)', stillDraft?.status === 'DRAFT', `status=${stillDraft?.status}`);
  await page.screenshot({ path: `${OUT}sil-697_ui-3-blocked-toast.png` });

  // ── Acceptance path: upload the second type, then complete ──
  const inputs2 = await page.$$('input[type="file"]');
  if (inputs2.length >= 2) {
    await inputs2[1].uploadFile(new URL('lane-pod-signed.png', import.meta.url).pathname);
    await sleep(2500);
  }
  const afterSigned = await podLatest();
  const types = new Set((afterSigned?.files ?? []).map((f) => f.fileType));
  check('both required types present', types.has('YARD_OR_DROP_RECEIPT') && types.has('SIGNED_DELIVERY_NOTE'), JSON.stringify([...types]));

  submitRequests.length = 0; completeRequests.length = 0;
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('HOÀN THÀNH CHUYẾN'));
    btn?.click();
  });
  try {
    await page.waitForFunction(() => document.body.textContent?.includes('Hoàn tất chuyến hàng thành công!') || location.pathname === '/my-trips', { timeout: 20000 });
  } catch { /* fall through to API assertion */ }
  await sleep(1500);
  const finalTrip = await fetch(`${API}/trips/${TRIP}`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json()).catch(() => null);
  check('trip COMPLETED after both files', finalTrip?.status === 'COMPLETED', `status=${finalTrip?.status}`);
  check('exactly one submit + one complete fired', submitRequests.length === 1 && completeRequests.length === 1, `submits=${submitRequests.length} completes=${completeRequests.length}`);
  await page.screenshot({ path: `${OUT}sil-697_ui-4-completed.png` });

  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${OUT}sil-697_ui-driver-requests.json`, JSON.stringify({ submitRequests, completeRequests, results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'ALL UI CHECKS PASSED' : `${failed.length} CHECKS FAILED`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}
