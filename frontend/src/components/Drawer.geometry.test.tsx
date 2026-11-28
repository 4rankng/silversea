/**
 * 28/11 staging audit — systemic drawer geometry law (right-edge clipping +
 * mouse traps).
 *
 * Every drawer rides the shared primitive (components/UI.tsx `Drawer` +
 * components/Drawer.css): position fixed, inset-y 0, right 0, and a width
 * CLAMP — `width: 100%` under a `max-width: min(<px>, 100vw)` ceiling — so
 * the × button and the footer submit can never sit past the right edge, and
 * the body scrolls vertically inside (no horizontal wheel trap). Hosts that
 * need a wider ladder may raise the ceiling only through the same
 * `min(<px>, 100vw)` formula; bare fixed-px ceilings are banned.
 *
 * Surfaces audited here: /users (Thêm/Chỉnh sửa tài khoản), /customers
 * (Chi tiết khách hàng), /penalties (Lập biên bản), /dispatch (Chi tiết
 * cont). The route law (drawer closes on pathname change while open) is
 * pinned behaviourally below.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Drawer } from './UI';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} rule must exist`).toBeTruthy();
  return match?.[1] ?? '';
}

describe('shared drawer geometry law (28/11 audit)', () => {
  it('anchors the panel to the right edge with inset-y 0 and the clamp formula', () => {
    const base = rule(read('src/components/Drawer.css'), '.drawer');
    expect(base).toMatch(/position:\s*fixed/);
    expect(base).toMatch(/top:\s*0/);
    expect(base).toMatch(/bottom:\s*0/);
    expect(base).toMatch(/right:\s*0/);
    expect(base).toMatch(/width:\s*100%/);
    // The clamp ceiling carries the 100vw term — a bare fixed-px ceiling
    // cannot guarantee the × stays on a narrow canvas.
    expect(base).toMatch(/max-width:\s*min\(\d+px,\s*100vw\)/);
  });

  it('scrolls the drawer body vertically and contains the scroll inside', () => {
    const body = rule(read('src/components/Drawer.css'), '.drawer__body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/overscroll-behavior:\s*contain/);
    expect(body).toMatch(/min-width:\s*0/);
  });

  it('keeps the /users add-edit drawer at the audit ceiling through the clamp formula', () => {
    const css = read('src/features/users/users.css');
    const users = rule(css, '.drawer:has(.users-form-cards)');
    expect(users).toMatch(/max-width:\s*min\(640px,\s*100vw\)/);
    // No bare fixed-px ceiling may sneak back in on any .drawer rule here.
    const offenders = [...css.matchAll(/\.drawer[^{]*\{[^}]*\}/g)]
      .map((m) => m[0])
      .filter((r) => /max-width:\s*\d+px/.test(r) && !/min\(\d+px,\s*100vw\)/.test(r));
    expect(offenders).toEqual([]);
  });

  it('clamps the /dispatch Chi tiết cont drawer to the viewport-fitting formula', () => {
    const css = read('src/features/dispatch/master-plan/DispatchContainerDetailDrawer.css');
    const host = rule(css, '.dispatch-container-detail-drawer');
    // Table drawer keeps its FB-045/SIL-530 wide ceiling — clamped to 100vw
    // so the audit's no-overflow law holds (never exceeds the viewport).
    // SIL-1301: the ceiling funds the table's own floor + padding (1200 +
    // 2 × 16 = 1232 ≤ 1240) so the whole table fits the panel at desktop —
    // 1120px left it band-scrolling (QA: bảng tràn 78px khỏi mép phải).
    expect(host).toMatch(/width:\s*min\(1240px,\s*100vw\)/);
    expect(host).toMatch(/max-width:\s*min\(1240px,\s*100vw\)/);
  });

  it('lets /customers and /penalties drawers ride the shared base with no width override', () => {
    for (const file of ['src/pages/CustomersPage.css', 'src/pages/PenaltyPage.css']) {
      const css = read(file);
      const overrides = [...css.matchAll(/(\.drawer[\w:.-]*)\s*\{([^}]*)\}/g)]
        .filter(([, selector, body]) => /^\.drawer[\s,{:]/.test(selector) && /width/.test(body));
      expect(overrides, `${file} must not override .drawer width`).toEqual([]);
    }
  });
});

describe('drawer route law (28/11 audit): pathname change closes the drawer', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  function Harness({ onClose }: { onClose: () => void }) {
    return <Drawer isOpen onClose={onClose} title="Luật định vị">Nội dung</Drawer>;
  }

  it('closes when the pathname changes while open, not on a query-only refilter', () => {
    window.history.pushState({}, '', '/users');
    const onClose = vi.fn();
    const { rerender } = render(<Harness onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();

    // Query-only change (filter refilter) must NOT dismiss the drawer.
    window.history.pushState({}, '', '/users?filter=x');
    rerender(<Harness onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();

    // A real route navigation closes it (same contract as the host page
    // unmount, extended to same-page param navigation).
    window.history.pushState({}, '', '/customers');
    rerender(<Harness onClose={onClose} />);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the host re-renders on the same pathname', () => {
    window.history.pushState({}, '', '/penalties');
    const onClose = vi.fn();
    const { rerender } = render(<Harness onClose={onClose} />);
    rerender(<Harness onClose={onClose} />);
    rerender(<Harness onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();
  });
});
