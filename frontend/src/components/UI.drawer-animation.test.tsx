/**
 * Drawer slide regression fence — card 20260923_1 defects D1/D2.
 *
 * The panel's resting position is observable DOM state: `.drawer` carries the
 * inline `translateX` anime.js writes, and QA measured exactly that (`rect.x
 * === viewport.width` while `aria-hidden="false"`). Both cases below therefore
 * assert the rendered transform, not the animation wiring.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Drawer } from './UI';

/** Longest slide the drawer may run (the old spring exit settled at ≈1020ms;
 *  the deterministic exit is 240ms). Waiting past it guarantees every in-flight
 *  animation has written its final value before the assertion runs. */
const SETTLE_MS = 1600;

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Mở chi tiết</button>
      <button type="button" onClick={() => setOpen(false)}>Đóng chi tiết</button>
      <Drawer isOpen={open} onClose={() => setOpen(false)} title="Chi tiết lô hàng">
        <button type="button">Lưu thay đổi</button>
      </Drawer>
    </>
  );
}

describe('Drawer slide (card 20260923_1 D1/D2)', () => {
  it('D1: reopening mid-exit still leaves the open panel at rest', async () => {
    render(<DrawerHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở chi tiết' }));
    const drawer = await screen.findByRole('dialog', { name: 'Chi tiết lô hàng' });
    await waitFor(() => expect(drawer.style.transform).toBe('translateX(0%)'), { timeout: 2500 });

    // Close, then reopen while the exit slide is still running: the stale exit
    // must not outlive the fresh entrance and park the panel off-screen.
    fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết' }));
    await delay(120);
    fireEvent.click(screen.getByRole('button', { name: 'Mở chi tiết' }));
    await delay(SETTLE_MS);

    expect(drawer.getAttribute('aria-hidden')).toBe('false');
    expect(drawer.style.transform).toBe('translateX(0%)');
  });

  it('D2: the panel reaches rest within the slide budget', async () => {
    render(<DrawerHarness />);
    const startedAt = performance.now();
    fireEvent.click(screen.getByRole('button', { name: 'Mở chi tiết' }));
    const drawer = await screen.findByRole('dialog', { name: 'Chi tiết lô hàng' });
    await waitFor(() => expect(drawer.style.transform).toBe('translateX(0%)'), { timeout: 2500 });

    // Budget 700ms: the deterministic 300ms slide clears it with room for a
    // loaded CI box, while the old spring (settlingDuration ≈860ms) does not.
    expect(performance.now() - startedAt).toBeLessThan(700);
  });
});
