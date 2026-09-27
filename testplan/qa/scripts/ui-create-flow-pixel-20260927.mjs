// ui-create-flow-pixel-20260927.mjs — the create-flow pixel-neutrality capture
// (card 20260927_146 criterion 3).
//
// The shipment-create workspace was split into section components (commit
// 79ed4e03, TSX-only — no CSS in the diff). Criterion 3 asks for before/after
// full-page captures of the create flow in two states (empty + with-data) at
// two widths, so a refactor that silently moved a pixel is caught.
//
// The script is deliberately state-free and re-runnable: run it once against the
// PRE-split build (the "before" set) and once against the POST-split build (the
// "after" set), then diff the two folders. It only types/picks in the form —
// nothing is submitted, so no data is written anywhere.
//
// Usage:
//   STAGING_URL=https://vantai.tingting.vip PREFIX=before \
//     node testplan/qa/scripts/ui-create-flow-pixel-20260927.mjs
//   OUT=<dir>  (default testplan/qa/evidence/<stamp>_create-flow-pixel)
// Evidence: <OUT>/<PREFIX>-<width>-<state>.png + a build-hash stamp.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QA_ROOT = path.resolve(__dirname, '..');
const PREFIX = process.env.PREFIX || 'shot';
const WIDTHS = (process.env.WIDTHS || '390,1440').split(',').map(Number);
const STAMP = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const OUT = process.env.OUT || path.join(QA_ROOT, 'evidence', `${STAMP}_create-flow-pixel`);
const CREATE_PATH = process.env.CREATE_PATH || '/shipments/new';

await fs.mkdir(OUT, { recursive: true });
const env = await loadEnv();
const session = await createSession({ env, role: 'CUS', evidenceDir: OUT, runId: `${PREFIX}-${STAMP}` });
const { page } = session;

/** First option of a listbox opened from `trigger` (label or placeholder). */
async function pickFirst(selector) {
  const handle = await page.$(selector);
  if (!handle) return `no-trigger:${selector}`;
  await handle.click();
  await new Promise((r) => setTimeout(r, 450));
  const option = await page.$('[role="option"], [role="listbox"] li, .searchable-select__option, [data-option]');
  if (!option) {
    await page.keyboard.press('Escape').catch(() => {});
    return `no-option:${selector}`;
  }
  const text = ((await option.evaluate((el) => el.textContent)) || '').trim().slice(0, 40);
  await option.click();
  await new Promise((r) => setTimeout(r, 500));
  return text;
}

async function typeInto(selector, value) {
  const handle = await page.$(selector);
  if (!handle) return `no-input:${selector}`;
  await handle.click({ clickCount: 3 }).catch(() => {});
  await page.keyboard.type(value, { delay: 20 });
  await new Promise((r) => setTimeout(r, 200));
  return value;
}

const buildHash = await page
  .goto(`${env.baseUrl}/login`, { waitUntil: 'networkidle2' })
  .then(() => fetch(`${env.api}/health`).then((r) => r.json()).then((j) => j.buildHash).catch(() => 'unknown'))
  .catch(() => 'unknown');

const notes = [];
for (const width of WIDTHS) {
  await page.setViewport({ width, height: width <= 768 ? 844 : 900, isMobile: width <= 768, hasTouch: width <= 768 });
  await page.goto(`${env.baseUrl}${CREATE_PATH}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-${width}-empty.png`), fullPage: true });

  // With-data state — deterministic picks, first option each time, no submit.
  notes.push(`customer=${await pickFirst('input[aria-label="Khách hàng"], input[placeholder="Chọn khách hàng"], #customerId')}`);
  notes.push(`direction=${await pickFirst('input[placeholder="Chọn Nhập hoặc Xuất"]')}`);
  notes.push(`containerType=${await pickFirst('input[aria-label="Loại container"]')}`);
  notes.push(`factory=${await pickFirst('input[aria-label="Nhà máy"]')}`);
  notes.push(`route=${await pickFirst('input[aria-label="Tuyến đường"]')}`);
  notes.push(`pickup=${await pickFirst('input[aria-label="Cảng nâng"]')}`);
  notes.push(`dropoff=${await pickFirst('input[aria-label="Cảng hạ"]')}`);
  notes.push(`number=${await typeInto('input[aria-label="Số container"]', 'MSCU7654329')}`);
  notes.push(`weight=${await typeInto('input[aria-label="Trọng lượng (kg)"]', '12000')}`);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-${width}-with-data.png`), fullPage: true });
}

await fs.writeFile(
  path.join(OUT, `${PREFIX}-meta.json`),
  JSON.stringify({ prefix: PREFIX, env: env.env, baseUrl: env.baseUrl, buildHash, user: session.username, widths: WIDTHS, picks: notes, at: new Date().toISOString() }, null, 1),
);
process.stdout.write(`${PREFIX}: build=${buildHash} user=${session.username} widths=${WIDTHS.join(',')} → ${OUT}\n`);
await session.browser.close();
