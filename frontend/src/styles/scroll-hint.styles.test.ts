import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// P2 QA design sweep 28/11 — horizontally-scrollable lanes cut their last
// values at the right edge with zero indication (/accounting/chot-debit at
// 820px: 'Tổng thu'; /timesheet at 390px: the 720px+ grid; /config/
// freight-rate-terms). styles/scroll-hint.css is the shared affordance: a
// right-edge fade + 'Kéo ngang' chip painted on a presentation-only host div
// around the lane (an overlay on the scroller itself would sit at the
// CONTENT's right edge and scroll away), gated by the lane's inline scroll
// timeline so it appears only when the lane actually overflows.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = read('src/styles/scroll-hint.css');

describe('scroll-hint pattern (P2 QA sweep 28/11)', () => {
  it('is imported by the global entry ahead of the responsive overrides', () => {
    const index = read('src/index.css');
    expect(index).toContain('./styles/scroll-hint.css');
    expect(index.indexOf('styles/scroll-hint.css')).toBeLessThan(index.indexOf('styles/responsive.css'));
  });

  it('paints a right-edge fade and a Kéo ngang chip that never trap pointers', () => {
    // Both pseudos key off the shared host list; match the first (base) rule
    // of each — the @supports block's comma-joined selectors don't match.
    const fade = css.match(/\)::before\s*\{([^}]*)\}/)?.[1] ?? '';
    const chip = css.match(/\)::after\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(fade, 'the fade rule exists').not.toBe('');
    expect(fade).toMatch(/background:\s*linear-gradient\(to right,\s*transparent,\s*var\(--surface\)\s*78%\)/);
    expect(fade).toMatch(/pointer-events:\s*none/);
    expect(fade).toMatch(/opacity:\s*0/);
    expect(fade).toMatch(/right:\s*var\(--scroll-hint-inset,\s*0px\)/);

    expect(chip, 'the chip rule exists').not.toBe('');
    expect(chip).toContain("content: 'Kéo ngang'");
    expect(chip).toMatch(/pointer-events:\s*none/);
    expect(chip).toMatch(/opacity:\s*0/);
    // The ≤640px responsive.css `.table-scroll::after` band leaks
    // top/bottom: 0 into this pseudo on the freight host; the chip must
    // keep its own half-height geometry there.
    expect(chip).toMatch(/bottom:\s*auto/);
  });

  it('binds the lane scroll timeline through the host scope', () => {
    expect(css).toMatch(/timeline-scope:\s*--scroll-hint-x/);
    expect(css).toMatch(/scroll-timeline-name:\s*--scroll-hint-x/);
    expect(css).toMatch(/scroll-timeline-axis:\s*inline/);
    // The host is presentation-only: relative, never a scroll container or
    // clip — the record-table sticky laws (P2-21 / SIL-1177) stay intact.
    const host = css.match(/\)::(?:before)/) ? css.match(/:is\(\.scroll-hint,\s*\.cfg-page--freight-rate-terms \.table-scroll\)\s*\{([^}]*)\}/)?.[1] ?? '' : '';
    expect(host).toMatch(/position:\s*relative/);
    expect(host).not.toMatch(/overflow/);
  });

  it('gates visibility on scroll-driven animations, fading out at the end', () => {
    expect(css).toMatch(/@supports \(animation-timeline: scroll\(\)\)/);
    expect(css).toMatch(/animation-timeline:\s*--scroll-hint-x/);
    const keyframes = css.match(/@keyframes scroll-hint-fade\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(keyframes, 'the fade keyframes exist').not.toBe('');
    expect(keyframes).toMatch(/0%,\s*72%\s*\{\s*opacity:\s*1;\s*\}/);
    expect(keyframes).toMatch(/100%\s*\{\s*opacity:\s*0;\s*\}/);
  });

  it('keeps a static fallback only where the lanes overflow by construction', () => {
    expect(css).toMatch(/@supports not \(animation-timeline: scroll\(\)\)/);
    // Debit: below the 1184px clip floor the 1136px board always overflows
    // the edge-to-edge rail. Unconditional band — a display:none board's
    // host has no box (the rounds board keeps its lane ≤640px).
    expect(css).toMatch(/@media \(max-width: 1150\.98px\)\s*\{\s*\.scroll-hint::before,/);
    // Timesheet: the 720px grid always overflows the phone frame — scoped
    // so the freight host (card mode ≤639px, no lane) never false-positives.
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.ts-page \.scroll-hint::before,/);
  });

  it('freight terms binds the CrudTable lane structurally, not through shared markup', () => {
    expect(css).toMatch(/\.cfg-page--freight-rate-terms \.table-scroll/);
    expect(css).toMatch(/\.cfg-page--freight-rate-terms \.record-table-wrap--scroll/);
    // No wrapper was added inside CrudTable — every other catalogue is
    // untouched (CrudTable renders only .table-scroll / record-table-wrap).
    const crud = read('src/components/config/CrudTable.tsx');
    expect(crud).not.toContain('scroll-hint');
  });

  it('debit and timesheet lanes adopt the host + lane classes in their own markup', () => {
    const board = read('src/pages/accounting/AccountingDebitClosePage.board.tsx');
    expect(board).toContain('className="scroll-hint"');
    expect(board).toMatch(/debit-board__wrap ledger-desktop scroll-hint__lane/);
    const rounds = read('src/pages/accounting/AccountingDebitClosePage.rounds.tsx');
    expect(rounds).toMatch(/debit-board__wrap scroll-hint__lane/);
    const ts = read('src/pages/TimesheetGridPage.tsx');
    expect(ts).toMatch(/record-table-wrap scroll-hint__lane/);
  });

  it('pulls the debit overlay out to the true edge-to-edge lane edge', () => {
    const debitCss = read('src/pages/accounting/AccountingDebitClosePage.css');
    expect(debitCss).toMatch(/\.debit-page \.scroll-hint\s*\{[^}]*--scroll-hint-inset:\s*calc\(-1 \* var\(--app-body-pad-x,\s*24px\)\)/);
  });
});
