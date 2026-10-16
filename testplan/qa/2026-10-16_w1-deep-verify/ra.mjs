// Driving helpers for the app's React Aria select surface (UuiSelectField):
// no native <select> is user-facing (eslint @tingting/no-native-select), so a
// pick = click the field's trigger, then click the portalled option.
//
// Field addressing — plain RAC Selects (Nhóm chi phí, Bên thực chi) render no
// visible <label> element in the DOM (only the hidden form <label> that wraps
// the hidden native <select>), while ComboBoxes do. So a field is addressed by
//   a string  → matches the visible label text (trailing "*" stripped), or
//   {options} → every string must appear among the wrapper's hidden <option>s.
// Shared by the W1 deep-verify drivers. Run from repo root.
import { log } from './w1-lib.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WRAP_MATCH = (spec) => `(() => {
  const want = ${JSON.stringify(spec)};
  const wraps = [...document.querySelectorAll('.ds-uui-select')];
  const norm = (t) => (t || '').replace(/\\*+\s*$/, '').trim();
  if (typeof want === 'string') {
    const hit = wraps.find(w => [...w.querySelectorAll('label')]
      .some(l => !l.querySelector('select') && norm(l.textContent) === want)
      || [...w.querySelectorAll('[aria-label]')].some(n => norm(n.getAttribute('aria-label')) === want));
    if (hit) return hit;
  }
  if (want && typeof want === 'object' && Array.isArray(want.options)) {
    return wraps.find(w => {
      const opts = [...w.querySelectorAll('select option')].map(o => (o.textContent || '').trim());
      return want.options.every(o => opts.includes(o));
    });
  }
  return null;
})()`;

function wrapSpec(spec) {
  if (typeof spec === 'string' || (spec && Array.isArray(spec.options))) return spec;
  throw new Error(`bad field spec: ${JSON.stringify(spec)}`);
}

/** Find a UuiSelectField wrapper; returns null when absent. */
export async function findUuiField(page, spec) {
  const found = await page.evaluate(`Boolean(${WRAP_MATCH(wrapSpec(spec))})`);
  log(`FIND field ${JSON.stringify(spec)} -> ${found}`);
  return found;
}

/**
 * Open a UuiSelectField: click the trigger button (plain select) or focus the
 * input (combobox, opens on focus/menuTrigger=focus).
 */
export async function openUuiSelect(page, spec) {
  const opened = await page.evaluate(`${WRAP_MATCH(wrapSpec(spec))} ? (w => {
    const btn = w.querySelector('button[aria-haspopup]');
    const input = w.querySelector('input');
    if (btn) { btn.scrollIntoView({ block: 'center' }); btn.click(); return 'button'; }
    if (input) { input.scrollIntoView({ block: 'center' }); input.focus(); return 'input'; }
    return 'no-trigger';
  })(${WRAP_MATCH(wrapSpec(spec))}) : 'no-field'`);
  log(`OPEN select ${JSON.stringify(spec)} -> ${opened}`);
  if (opened === 'no-field' || opened === 'no-trigger') throw new Error(opened);
  await sleep(700);
  return opened;
}

/** Click the portalled option whose text matches (exact by default). */
export async function pickOption(page, optionText, { exact = true } = {}) {
  const picked = await page.evaluate((needle, isExact) => {
    const options = [...document.querySelectorAll('[role="option"]')]
      .filter(o => o.getBoundingClientRect().height > 0);
    const target = options.find(o => {
      const t = (o.textContent || '').trim();
      return isExact ? t === needle : t.includes(needle);
    });
    if (!target) return { ok: false, available: options.map(o => (o.textContent || '').trim()).slice(0, 25) };
    target.scrollIntoView({ block: 'center' });
    target.click();
    return { ok: true, picked: (target.textContent || '').trim() };
  }, optionText, exact);
  log(`PICK option "${optionText}" -> ${JSON.stringify(picked).slice(0, 300)}`);
  if (!picked.ok) throw new Error(`option not found: ${optionText} (available: ${(picked.available ?? []).join(' | ')})`);
  await sleep(600);
  return picked.picked;
}

/** Escape out of an open popover without choosing. */
export async function closePopover(page) {
  await page.keyboard.press('Escape');
  await sleep(400);
}

/** List the options currently offered by an open popover. */
export async function listOpenOptions(page) {
  const opts = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')]
    .filter(o => o.getBoundingClientRect().height > 0)
    .map(o => (o.textContent || '').trim()));
  log(`OPTIONS open = ${JSON.stringify(opts)}`);
  return opts;
}

/** Read what a UuiSelectField currently shows: trigger text for plain selects,
 *  input value for comboboxes. */
export async function readUuiSelect(page, spec) {
  const state = await page.evaluate(`(() => {
    const w = ${WRAP_MATCH(wrapSpec(spec))};
    if (!w) return { found: false };
    const input = w.querySelector('input');
    if (input) return { found: true, kind: 'combobox', value: input.value };
    const btn = w.querySelector('button');
    return { found: true, kind: 'select', value: btn ? (btn.textContent || '').trim() : null };
  })()`);
  log(`READ select ${JSON.stringify(spec)} = ${JSON.stringify(state)}`);
  return state;
}

/** Type into a combobox's filter input, then pick from the filtered listbox. */
export async function comboboxPick(page, spec, query, optionText) {
  await openUuiSelect(page, spec);
  await page.evaluate(`${WRAP_MATCH(wrapSpec(spec))} ? (w => {
    const input = w.querySelector('input');
    if (!input) throw new Error('no combobox input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(query)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })(${WRAP_MATCH(wrapSpec(spec))}) : (() => { throw new Error('no-field'); })()`);
  await sleep(900);
  return pickOption(page, optionText, { exact: false });
}

/** Set a plain labelled text/number input (TextField/NumberField). RAC
 *  associates label→input via context (no htmlFor), so climb from the label
 *  until an ancestor holds the field's input. */
export async function setLabelledInput(page, labelText, value) {
  const done = await page.evaluate((needle, val) => {
    const norm = (t) => (t || '').replace(/\*+\s*$/, '').trim();
    const label = [...document.querySelectorAll('label')]
      .find(l => !l.querySelector('select') && !l.querySelector('input[type="checkbox"]') && norm(l.textContent) === norm(needle));
    if (!label) return false;
    let input = null;
    let node = label;
    for (let hop = 0; hop < 5 && node; hop += 1) {
      input = [...(node.querySelectorAll ? node.querySelectorAll('input') : [])]
        .find(i => i.type !== 'checkbox' && i.type !== 'radio');
      if (input) break;
      node = node.parentElement;
    }
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
    input.blur();
    return true;
  }, labelText, value);
  log(`SET input "${labelText}" = ${JSON.stringify(value)} -> ${done}`);
  if (!done) throw new Error(`no input for label "${labelText}"`);
  await sleep(300);
  return done;
}

/** Does a visible labelled field exist in the DOM? */
export async function hasLabel(page, labelText) {
  return page.evaluate((needle) => {
    const norm = (t) => (t || '').replace(/\*+\s*$/, '').trim();
    return [...document.querySelectorAll('label')]
      .some(l => !l.querySelector('select') && norm(l.textContent) === norm(needle));
  }, labelText);
}
