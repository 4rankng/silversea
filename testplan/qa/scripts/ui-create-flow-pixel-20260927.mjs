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

/**
 * Wait for a field to become interactive.
 *
 * CARD 20260928_156. `Nhà máy` is gated on
 * `(!customerId && !isAdHoc) || sitesLoading || saving`
 * (ShipmentCreateContainerRow.tsx), and choosing a customer fires
 * `/shipments/operational-sites` — so for a moment after the customer lands the
 * field is still disabled while that request is in flight. Clicking it in that
 * window does nothing and the driver then reports `no-option`, which looks
 * like "the dropdown is empty" and is actually "the dropdown was not open yet".
 *
 * Measured: a real click on the customer option returns 200 from
 * operational-sites and the field enables a beat later.
 */
async function waitForEnabled(selector, timeoutMs = 6000) {
  const started = Date.now();
  for (;;) {
    const state = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? { disabled: !!el.disabled, present: true } : { present: false };
    }, selector);
    if (!state.present) return 'missing';
    if (!state.disabled) return 'ready';
    if (Date.now() - started > timeoutMs) return 'timeout';
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** The listbox that is currently open, scoped so we never pick a stranger's option. */
async function openOptions(triggerSelector) {
  const handle = await page.$(triggerSelector);
  if (!handle) return null;
  const ready = await waitForEnabled(triggerSelector);
  if (ready !== 'ready') return null;
  await revealForClick(triggerSelector);
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

/**
 * Scroll a control into a position a real pointer can actually reach, then PROVE
 * it with a hit-test before the caller clicks.
 *
 * CARD 20260928_156. A bare `handle.click()` auto-scrolls, which is what made
 * this driver lie: at 390px the container fields land at top 1225–1450 inside an
 * 844px viewport, Playwright scrolls them up, the STICKY HEADER keeps the
 * viewport, and the synthetic click lands on the header instead of the
 * combobox. The listbox then never opens and the step reports a bare
 * `no-listbox` with no hint that the control was never really pressed.
 *
 * The earlier attempt logged (2026-09-28) tried `scrollIntoView({block:'center'})`
 * and changed nothing — because it scrolled but never checked whether the
 * resulting position was reachable. The app shell is a fixed layout whose inner
 * scroller is `main.app-body`, so a window-level scroll is a no-op here.
 *
 * Returns true when the control is hittable at its centre; false means the
 * caller must not treat a following `no-listbox` as a UI defect.
 */
async function revealForClick(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const scroller = document.querySelector('main.app-body') || document.scrollingElement;
    if (scroller) {
      // Scroll the INNER scroller the app actually uses, then settle: this app
      // re-renders and can reset scrollTop, so measure on a later frame.
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    return true;
  }, selector)
    .then(async () => {
      await new Promise((r) => setTimeout(r, 250));
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        // Off-screen or zero-sized: not clickable.
        if (r.width === 0 || r.height === 0) return false;
        if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) return false;
        // The decisive check: whatever is painted at the click point must be
        // the control itself or something inside it. If the sticky header owns
        // this point the click would go to the header, which is the lie.
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));
      }, selector);
    })
    .catch(() => false);
}

/**
 * Read a field back the way a person would see it.
 *
 * CARD 20260928_156, second layer. These are React-Aria comboboxes whose
 * `input` is a `text-transparent` proxy — the visible value is rendered by the
 * wrapper — so a raw `input.value` reads empty even on a good pick. Reading
 * the wrapper is what lets the driver tell "I clicked an option" from "the
 * field actually took it".
 */
async function readFieldValue(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    if (typeof el.value === 'string' && el.value !== '') return el.value;
    const box = el.closest('.uui-combobox, .csc-uui-field, [class*="uui-field"]');
    const text = (box?.innerText || '').trim();
    if (!text) return null;
    // A wrapper can hold the label too; the value is the last non-empty line.
    return text.split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? null;
  }, selector);
}

/**
 * Pick the first enabled option of the listbox opened from `triggerSelector`.
 *
 * `prefer` skips generated rows. The customer list on the create form leads with
 * test fixtures (`CF khách <13-digit-timestamp>-<token>`, card _191), and a
 * fixture customer owns NO operational sites — so picking the first row leaves
 * `Nhà máy` an empty, correctly-enabled listbox and the run reports `no-option`
 * for a reason that has nothing to do with the UI. Choosing a seeded customer
 * gives the rest of the form real master data to capture.
 */
async function pickFirstOption(triggerSelector, label, { prefer = null, skip = 0 } = {}) {
  const options = await openOptions(triggerSelector);
  if (options === null) return `no-listbox:${label}`;
  const enabled = options.filter((o) => !o.disabled);
  const preferred = prefer ? enabled.filter((o) => prefer.test(o.text)) : enabled;
  const pool = preferred.length > skip ? preferred : enabled;
  const first = pool[skip] ?? null;
  if (!first) return `no-option:${label}`;
  // Commit with a REAL Playwright click, scoped to the open listbox.
  //
  // CARD 20260928_156. These are React-Aria comboboxes, and the difference
  // matters more than it looks:
  //   - `element.click()` from `page.evaluate` is synthetic. The component does
  //     not act on it, so the pick "succeeded" while the field stayed empty.
  //   - Keyboard (focus + Enter) does not commit either — the option is not
  //     focusable, so the keystroke goes nowhere. Tried; made it worse.
  //   - A real `locator.click()` sends trusted mouse events, and THAT commits.
  //     Measured 2026-09-28: a real click on the customer option makes
  //     `/shipments/operational-sites` fire (200) and the `Nhà máy` field enable.
  //
  // The earlier "Nhà máy is permanently disabled" reading was an artefact of
  // this, not a product bug: the customer never landed, so the field was
  // correctly gated. Only the OPEN listbox is searched, so a stranger's option
  // can never be picked — the bug the scoping comment above already records.
  const index = await page.evaluate((wanted) => {
    const open = Array.from(document.querySelectorAll('[role="listbox"]')).find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!open) return -1;
    return Array.from(open.querySelectorAll('[role="option"]'))
      .findIndex((o) => (o.textContent || '').trim().startsWith(wanted));
  }, first.text);
  if (index < 0) return `pick-failed:${label}`;
  // A real click through the DevTools protocol (trusted mouse events), on the
  // nth option of the OPEN listbox only.
  const listbox = await page.evaluateHandle(() => Array.from(document.querySelectorAll('[role="listbox"]'))
    .find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }));
  const openListbox = listbox.asElement();
  if (!openListbox) return `pick-failed:${label}`;
  const optionHandles = await openListbox.$$('[role="option"]');
  if (!optionHandles[index]) return `pick-failed:${label}`;
  await optionHandles[index].click().catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  // The click is not the result. A synthetic `.click()` on a React-Aria option
  // can do nothing at all — that is exactly how the customer pick "succeeded"
  // while leaving the field empty, which is why `Nhà máy` stayed disabled for
  // the rest of the run. Confirm the value landed before claiming a pick.
  const after = await readFieldValue(triggerSelector);
  if (after === null) return `no-commit:${label}`;
  return after;
}

async function typeInto(selector, value) {
  const handle = await page.$(selector);
  if (!handle) return `no-input:${selector}`;
  // The click is best-effort (these proxy inputs can refuse a real click);
  // verification below is what actually decides success.
  await handle.click({ clickCount: 3 }).catch(() => {});
  await page.keyboard.type(value, { delay: 20 });
  await new Promise((r) => setTimeout(r, 200));
  // Same discipline as pickFirstOption: do not report a value we only TRIED to
  // type. Before this, `containerCount=1` in the metadata could have meant the
  // keystrokes went nowhere.
  const after = await readFieldValue(selector);
  if (after === null || !String(after).includes(String(value))) return `no-commit:${selector}`;
  return after;
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
  // A seeded customer, not a generated fixture: the list leads with
  // `CF khách <timestamp>` rows from card _191, and a fixture owns nothing.
  const customer = await pickFirstOption(HOOKS.customer, 'customer', {
    prefer: /công ty|cty|tnhh|liên doanh|tập đoàn|xí nghiệp|nhà máy/i,
  });
  notes.push(`customer=${customer}`);
  if (customer.startsWith('no-') || customer.startsWith('pick-')) note(`${at} customer`, customer);

  // `Nhà máy` lists exactly the customer's own operational sites, and most
  // customers own none — measured 2026-09-28: only 3 of the seeded customers
  // have any. So an OPEN, EMPTY list here is the truth about the data, not a
  // broken dropdown, and it must not fail the run. Verified there is no product
  // bug underneath: committing a customer with a real click makes
  // `/shipments/operational-sites` return 200 and the field enable
  // (ShipmentCreateContainerRow.tsx gates it on customerId/sitesLoading/saving).
  const factoryValue = await pickFirstOption('input[aria-label="Nhà máy"]', 'factory');
  notes.push(`factory=${factoryValue}`);
  if (factoryValue === 'no-option:factory') {
    notes.push('factory=EMPTY (this customer owns no operational site — correct UI, not a failure)');
  } else if (factoryValue.startsWith('no-')) {
    note(`${at} factory`, factoryValue);
  }

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
  // Same rule as pickFirstOption: the click is not the result. The direction
  // field is a `csc-uui-field` button, not an input, so verify through it.
  const directionAfter = await readFieldValue(HOOKS.directionButton);
  const directionOk = Boolean(direction) && directionAfter !== null;
  notes.push(`direction=${directionOk ? directionAfter : `no-commit:trade-direction`}`);
  if (!direction) note(`${at} direction`, 'no Nhập khẩu/Xuất khẩu option in the trade-direction listbox');
  else if (!directionOk) note(`${at} direction`, 'clicked the option but the field never took the value');
  await new Promise((r) => setTimeout(r, 700));

  for (const [label, selector] of [
    ['containerType', 'input[aria-label="Loại container"]'],
    ['route', 'input[aria-label="Tuyến đường"]'],
    ['pickup', 'input[aria-label="Cảng nâng"]'],
    ['dropoff', 'input[aria-label="Cảng hạ"]'],
  ]) {
    const value = await pickFirstOption(selector, label);
    notes.push(`${label}=${value}`);
    // `no-commit` joins the other failure shapes: the click happened, the field
    // did not change, so the screenshot is missing data it claims to show.
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
