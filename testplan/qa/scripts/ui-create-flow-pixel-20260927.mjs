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
// CARD 20260928_156 — this driver used to capture NOTHING and still exit 0.
// The evidence was two blank "Đang tải..." screenshots while `shot-meta.json`
// recorded every pick as `no-trigger`. Two root causes, both fixed here:
//   1. every selector was stale (see the hook table below);
//   2. nothing asserted that the capture worked, so a total failure printed a
//      success line. It now exits nonzero and says exactly what it missed.
// The rule now: a run that captured nothing must LOOK like a failure.
//
// Usage:
//   STAGING_URL=https://vantai.tingting.vip PREFIX=before \
//     node testplan/qa/scripts/ui-create-flow-pixel-20260927.mjs
//   OUT=<dir>  (default testplan/qa/evidence/<stamp>_create-flow-pixel)
// Evidence: <OUT>/<PREFIX>-<width>-<state>.png + <PREFIX>-meta.json.

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

/**
 * Real hooks on the create workspace, measured against the live DOM
 * (card 20260928_156). The customer combobox has NO aria-label — it is
 * identified by the field wrapper that carries the "Khách hàng" label.
 */
const HOOKS = {
  // A stable id the page itself owns: the trade-direction select button.
  // Its presence is also the render signal — the workspace has mounted.
  directionButton: '#shipment-trade-direction',
  // First .csc-uui-field wrapping a combobox is the customer field.
  customer: '.csc-uui-field:has(input[role="combobox"])',
  customerInput: '.csc-uui-field:has(input[role="combobox"]) input[role="combobox"]',
  // Bill/Booking input — disabled until a direction is chosen. The OLD driver
  // used its placeholder to find the DIRECTION control, which is why it grabbed
  // the wrong field and reported "no-option".
  billBooking: 'input[placeholder="Chọn Nhập hoặc Xuất"]',
};

const problems = [];
const note = (where, message) => {
  problems.push(`${where}: ${message}`);
  process.stdout.write(`  ! ${where}: ${message}\n`);
};

/** Wait for the workspace to actually mount, not a fixed sleep. */
async function waitForWorkspace() {
  try {
    await page.waitForSelector(HOOKS.directionButton, { timeout: 20000 });
    return true;
  } catch {
    note('render', `${HOOKS.directionButton} never appeared — the create workspace did not mount within 20s`);
    return false;
  }
}

/** The listbox that is currently open, scoped so we never pick a stranger's option. */
async function openOptions(triggerSelector) {
  const handle = await page.$(triggerSelector);
  if (!handle) return null;
  await handle.click();
  await new Promise((r) => setTimeout(r, 450));
  // Only a listbox that is VISIBLE counts. The previous selector matched any
  // [role="option"] anywhere in the document, which is how three unrelated
  // fields all reported picking "Cảng Hải Phòng".
  return page.evaluate(() => {
    const open = Array.from(document.querySelectorAll('[role="listbox"]')).find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!open) return null;
    return Array.from(open.querySelectorAll('[role="option"]'))
      .map((o) => ({ text: (o.textContent || '').trim().slice(0, 40), disabled: o.getAttribute('aria-disabled') === 'true' }))
      // A listbox's FIRST option is often its empty-state placeholder
      // ("Không tìm thấy kết quả", "Chọn …", "— Chọn hình thức —"). Picking it
      // is how a previous run reported a factory of "Không tìm thấy kết quả".
      .filter((o) => o.text && !/^(\s*—|chọn\b|không tìm thấy|không có|trống)/i.test(o.text));
  });
}

/** Pick the first enabled option of the listbox opened from `triggerSelector`. */
async function pickFirstOption(triggerSelector, label) {
  const options = await openOptions(triggerSelector);
  if (options === null) return `no-listbox:${label}`;
  const first = options.find((o) => !o.disabled);
  if (!first) return `no-option:${label}`;
  const clicked = await page.evaluate((wanted) => {
    const open = Array.from(document.querySelectorAll('[role="listbox"]')).find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!open) return false;
    const target = Array.from(open.querySelectorAll('[role="option"]'))
      .find((o) => (o.textContent || '').trim().startsWith(wanted));
    if (!target) return false;
    target.click();
    return true;
  }, first.text);
  if (!clicked) return `pick-failed:${label}`;
  await new Promise((r) => setTimeout(r, 500));
  return first.text;
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
  const at = `@${width}`;
  await page.setViewport({ width, height: width <= 768 ? 844 : 900, isMobile: width <= 768, hasTouch: width <= 768 });
  await page.goto(`${env.baseUrl}${CREATE_PATH}`, { waitUntil: 'networkidle2' });

  const mounted = await waitForWorkspace();
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-${width}-empty.png`), fullPage: true });

  if (!mounted) continue; // waitForWorkspace already recorded why

  // With-data state — deterministic picks, first option each time, no submit.
  const customer = await pickFirstOption(HOOKS.customer, 'customer');
  notes.push(`customer=${customer}`);
  if (customer.startsWith('no-') || customer.startsWith('pick-')) note(`${at} customer`, customer);

  // Skip the "— Chọn hình thức —" placeholder option; pick a real direction.
  await page.click(HOOKS.directionButton);
  await new Promise((r) => setTimeout(r, 500));
  const direction = await page.evaluate(() => {
    const open = Array.from(document.querySelectorAll('[role="listbox"]')).find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    // Skip the "— Chọn hình thức —" placeholder; a real direction is the target.
    const wanted = Array.from(open?.querySelectorAll('[role="option"]') ?? [])
      .find((o) => /^(Nhập khẩu|Xuất khẩu)$/.test((o.textContent || '').trim()));
    if (!wanted) return null;
    wanted.click();
    return (wanted.textContent || '').trim();
  });
  notes.push(`direction=${direction ?? 'no-option:trade-direction'}`);
  if (!direction) note(`${at} direction`, 'no Nhập khẩu/Xuất khẩu option in the trade-direction listbox');
  await new Promise((r) => setTimeout(r, 700));

  for (const [label, selector] of [
    ['containerType', 'input[aria-label="Loại container"]'],
    ['factory', 'input[aria-label="Nhà máy"]'],
    ['route', 'input[aria-label="Tuyến đường"]'],
    ['pickup', 'input[aria-label="Cảng nâng"]'],
    ['dropoff', 'input[aria-label="Cảng hạ"]'],
  ]) {
    const value = await pickFirstOption(selector, label);
    notes.push(`${label}=${value}`);
    if (value.startsWith('no-') || value.startsWith('pick-')) note(`${at} ${label}`, value);
  }

  const number = await typeInto('input[aria-label="Số container cần thêm"], input[aria-label="Số container"]', '1');
  notes.push(`containerCount=${number}`);
  if (number.startsWith('no-')) note(`${at} containerCount`, number);

  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-${width}-with-data.png`), fullPage: true });
}

await fs.writeFile(
  path.join(OUT, `${PREFIX}-meta.json`),
  JSON.stringify(
    {
      prefix: PREFIX, env: env.env, baseUrl: env.baseUrl, buildHash,
      user: session.username, widths: WIDTHS, picks: notes,
      problems, ok: problems.length === 0,
      at: new Date().toISOString(),
    },
    null,
    1,
  ),
);

if (problems.length) {
  process.stdout.write(
    `\ncreate-flow-pixel: FAILED — ${problems.length} step(s) captured nothing, so these screenshots are NOT a usable before/after pair:\n`
    + problems.map((p) => `  - ${p}\n`).join('')
    + `evidence (unusable): ${OUT}\n`,
  );
} else {
  process.stdout.write(`${PREFIX}: build=${buildHash} user=${session.username} widths=${WIDTHS.join(',')} → ${OUT}\n`);
}
process.exitCode = problems.length ? 1 : 0;
await session.browser.close();
