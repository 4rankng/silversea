import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanCardList.css'), 'utf8');

/**
 * MasterPlanCardList.css is the ONLY sheet allowed to truncate/paint on the
 * /dispatch phone card (the pinned no-truncation law stays in
 * MasterPlanGrid.css for the contract suites). These pins guard the 25/11
 * owner directive sweep — every rule here exists because a live defect
 * proved it:
 *
 *  - SIL-976 (id 1135): cards read as flat transparent rows on the sage page
 *    — the card box recipe (dpcard's white surface, 10px radius, hairline
 *    border) must exist on .mpcard-list .mpcard, and the pinned sibling
 *    hairline must stay retired.
 *  - SIL-977/978/995 (ids 1136/1137/1156): `white-space: nowrap` ALONE does
 *    not stop the base `overflow-wrap: anywhere` from shattering a squeezed
 *    token ('W3A-LCL-0' / '3', 'Long' / 'Minh' at a 22px track). Every
 *    one-line identity rule must ALSO reset the break law — this is the
 *    exact half of the fix commit 702d3170 shipped without.
 *  - SIL-982 (id 1141) → SIL-1234 (id 1457): the clock's no-break law rides
 *    the per-entry token (.mpcard__slot); the container folds BETWEEN
 *    entries so five appointment heads wrap at the seams, never off the card.
 *  - SIL-980/1000 (ids 1139/1161): the note preview clamps to TWO lines with
 *    overflow hidden — the modal is the way back.
 */
describe('MasterPlanCardList phone-card override contract (25/11 owner sweep)', () => {
  it('SIL-976: the card paints the dpcard white box — surface, radius, border — over the pinned divider list', () => {
    const card = css.match(/(^|\n)\.mpcard-list \.mpcard \{([\s\S]*?)\n\}/)?.[2] ?? '';
    expect(card, 'the card box override must exist').toBeTruthy();
    expect(card).toContain('background: var(--surface)');
    expect(card).toContain('border-radius: 10px');
    expect(card).toMatch(/border: 1px solid var\(--border-color-secondary, var\(--line\)\)/);
    // The pinned sibling hairline (.mpcard + .mpcard border-top) stays retired.
    const divider = css.match(/(^|\n)\.mpcard-list \.mpcard \+ \.mpcard \{([\s\S]*?)\n\}/)?.[2] ?? '';
    expect(divider).toContain('border-top: 0');
  });

  it.each([
    ['.mpcard-list .mpcard__bill', 'SIL-978/995 — the Bill/Booking token never breaks mid-string'],
    ['.mpcard-list .mpcard__customer', 'SIL-977/995 — the customer name never breaks mid-word'],
  ])('%s holds one ellipsized line: the full trio AND the overflow-wrap reset (%s)', (selector) => {
    const body = css.match(new RegExp(`(^|\\n)${selector.replace(/\./g, '\\.')} \\{([\\s\\S]*?)\\n\\}`))?.[2] ?? '';
    expect(body, `${selector} rule must exist`).toBeTruthy();
    expect(body).toContain('white-space: nowrap');
    expect(body).toContain('overflow: hidden');
    expect(body).toContain('text-overflow: ellipsis');
    // The 702d3170 miss: nowrap without this reset still shatters under squeeze.
    expect(body).toContain('overflow-wrap: normal');
    expect(body).toContain('word-break: normal');
  });

  it.each([
    ['.mpcard-list .mpcard__slot', 'SIL-982 — one clock entry never breaks between date and time'],
    ['.mpcard-list .mpcard__type', 'SIL-995 — the badge keeps its whole label in the merge-mode head'],
  ])('%s never breaks internally: nowrap AND the overflow-wrap reset (%s)', (selector) => {
    const body = css.match(new RegExp(`(^|\\n)${selector.replace(/\./g, '\\.')} \\{([\\s\\S]*?)\\n\\}`))?.[2] ?? '';
    expect(body, `${selector} rule must exist`).toBeTruthy();
    expect(body).toContain('white-space: nowrap');
    expect(body).toContain('overflow-wrap: normal');
    expect(body).toContain('word-break: normal');
  });

  // SIL-1234: the joined multi-head clock measured 497px in a 318px card row
  // (nowrap container, overflow off the card edge, no horizontal scroll). The
  // container now wraps BETWEEN entries; the token law above keeps each
  // entry whole.
  it('SIL-1234: the clock container folds BETWEEN entries — normal white-space, the break law reset, shrinkable', () => {
    const time = css.match(/(^|\n)\.mpcard-list \.mpcard__time \{([\s\S]*?)\n\}/)?.[2] ?? '';
    expect(time, 'the time rule must exist').toBeTruthy();
    expect(time).toContain('white-space: normal');
    expect(time).toContain('overflow-wrap: normal');
    expect(time).toContain('word-break: normal');
    expect(time).toContain('min-width: 0');
    expect(time).not.toContain('white-space: nowrap');
  });

  it('SIL-980/1000: the note preview clamps to two lines and hides its overflow', () => {
    const clamp = css.match(/(^|\n)\.mpcard-list \.mpcard__note-text \{([\s\S]*?)\n\}/)?.[2] ?? '';
    expect(clamp, 'the note clamp rule must exist').toBeTruthy();
    expect(clamp).toContain('-webkit-line-clamp: 2');
    expect(clamp).toContain('overflow: hidden');
  });

  // SIL-1064 — the facts row folds BETWEEN clusters; the demand ("1 CARTON"),
  // the measures ("0,5 tấn · 1 CBM") and the vehicle/status line ("Chưa phân
  // xe") never shatter mid-cluster at 360px.
  it('SIL-1064: facts clusters hold the no-break trio and the row folds between clusters', () => {
    const facts = css.match(/(^|\n)\.mpcard-list \.mpcard__facts \{([\s\S]*?)\n\}/)?.[2] ?? '';
    expect(facts, 'the facts row rule must exist').toBeTruthy();
    expect(facts).toContain('flex-wrap: wrap');

    const cluster = css.match(
      /(^|\n)\.mpcard-list \.mpcard__cargo,\n\.mpcard-list \.mpcard__measures,\n\.mpcard-list \.mpcard__fleet \{([\s\S]*?)\n\}/,
    )?.[2] ?? '';
    expect(cluster, 'the facts cluster rule must exist').toBeTruthy();
    expect(cluster).toContain('white-space: nowrap');
    expect(cluster).toContain('overflow-wrap: normal');
    expect(cluster).toContain('word-break: normal');
    // A cluster is a phrase, never an ellipsized fragment — no clip here.
    expect(cluster).not.toContain('text-overflow');
    expect(cluster).not.toContain('overflow: hidden');
  });
});
