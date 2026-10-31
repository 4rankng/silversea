// SIL-630 (id 734) — the popover settle gate. react-aria positions its
// overlay with a post-mount pass, so the first painted frames can sit
// displaced from the hit-tested rect: on the LOẠI container picker an
// operator aiming at the painted "20DC" row committed the row that really
// lived under the cursor ("20RF") — every pick landed +2 catalog positions
// down. The gate (popover.tsx useSettledPointerEvents) keeps pointer events
// off until the overlay's rect stops moving, so a too-early click is
// swallowed instead of committing a neighbour row. These pins:
//   1. fresh open → pointer events OFF;
//   2. they stay OFF while the rect keeps moving (geometry-driven, not time);
//   3. they come back after the rect holds still for the settle window;
//   4. close + reopen re-arms the gate (the overlay remounts per open).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComboBox } from './combobox';
import { SelectItem } from './select-item';

const frameQueue: Array<FrameRequestCallback> = [];

function installFramePump() {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frameQueue.push(cb);
    return frameQueue.length;
  });
}

/** One animation frame: run every callback queued since the last pump. */
const pumpFrame = () => act(async () => {
  for (const cb of frameQueue.splice(0)) cb(performance.now());
});

const overlayEl = () => document.querySelector('[data-placement]') as HTMLElement | null;

/**
 * Stub the OVERLAY's own rect reads (never the prototype — react-aria's
 * positioning reads other elements and would consume the movement budget).
 * `moves` = how many reads report a shifted top (one option row per read,
 * the "post-mount pass relocated the list" simulation) before holding still.
 */
function stubOverlayRect(moves: number) {
  const overlay = overlayEl();
  if (!overlay) throw new Error('overlay not mounted');
  let calls = 0;
  vi.spyOn(overlay, 'getBoundingClientRect').mockImplementation(() => {
    const top = Math.min(calls, moves) * 30;
    calls += 1;
    return DOMRect.fromRect({ x: 10, y: top, width: 276, height: 240 });
  });
}

async function openPicker() {
  render(
    <ComboBox label="Loại container" menuTrigger="focus" items={[
      { id: '1', label: '20DC' },
      { id: '6', label: '20RF' },
      { id: '3', label: '40DC' },
    ]}>
      {(item) => <SelectItem id={item.id} value={item} label={item.label} />}
    </ComboBox>,
  );
  const input = screen.getByRole('combobox', { name: 'Loại container' });
  await act(async () => {
    input.focus();
    fireEvent.focusIn(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return input;
}

describe('popover settle gate (SIL-630)', () => {
  beforeEach(() => {
    installFramePump();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    frameQueue.length = 0;
  });

  it('keeps pointer events off at open, releases after the rect settles', async () => {
    const input = await openPicker();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(overlayEl()).toBeTruthy();

    // Gate ON at mount — a click in the first frames must not reach options.
    expect(overlayEl()!.style.pointerEvents).toBe('none');
    stubOverlayRect(0);
    await pumpFrame(); // read 1: baseline (never counts as settled)
    expect(overlayEl()!.style.pointerEvents).toBe('none');
    await pumpFrame(); // read 2: identical
    expect(overlayEl()!.style.pointerEvents).toBe('none');
    await pumpFrame(); // read 3: identical again → two identical in a row
    expect(overlayEl()!.style.pointerEvents).toBe('');
  });

  it('stays suppressed while the overlay keeps moving, releases once still', async () => {
    const input = await openPicker();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    // Each read shifts a row for the first 5 reads: the gate must hold.
    stubOverlayRect(5);
    expect(overlayEl()!.style.pointerEvents).toBe('none');
    await pumpFrame();
    await pumpFrame();
    await pumpFrame();
    await pumpFrame();
    expect(overlayEl()!.style.pointerEvents).toBe('none');
    // Reads now hold still: two identical in a row release the gate. The
    // first still read only sets the baseline (the last moving read differs).
    for (let i = 0; i < 8 && overlayEl()!.style.pointerEvents === 'none'; i += 1) {
      await pumpFrame();
    }
    expect(overlayEl()!.style.pointerEvents).toBe('');
  });

  it('tears the gate down with the overlay on close (re-arms via remount)', async () => {
    // The gate is a CHILD of the overlay element, so arming is bound to the
    // overlay's own mount — test 1 pins arm-on-open; here we pin the other
    // half of the remount law: closing unmounts the overlay AND its gate,
    // leaving no stale gate state behind for the next open.
    const input = await openPicker();
    expect(overlayEl()!.style.pointerEvents).toBe('none');
    expect(overlayEl()!.getAttribute('data-popover-gate')).toBe('settling');
    expect(document.querySelector('[data-popover-settle-gate]')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-popover-settle-gate]')).toBeNull();
  });
});
