// SIL-630 (id 734) — pin for the Loại container dropdown value mapping.
// QA regression 31/10 (staging build 6e6c921a): picking "20DC" displayed
// "20RF" and stored the 20RF row; "40DC" stored "40RF". Root cause (card
// 7af84183): NOT a mapping defect — every interactive probe committed the
// correct id; the popover painted TÁCH KHỎI the trigger while react-aria
// re-positioned the overlay post-mount, so a pointer click aimed at the
// painted "20DC" row landed on the row really under the cursor (+2 catalog
// positions ≈ one card height → the row under it was the RF row). The fix
// lives at the shared owner (base Popover settle gate,
// popover.tsx useSettledPointerEvents) and is pinned in
// popover.settle-gate.test.tsx.
//
// This file pins the OTHER half of the contract on the create-form cell:
// whatever option is picked commits ITS OWN catalog row id and displays ITS
// OWN code — the value↔label channel is id-mapped, never index-mapped — for
// every seeded row (20DC/40DC/40RF/20RF/45HC) and for an externally restored
// value (form prefill / dialog-create success).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerTypeCellPicker } from './ContainerTypeCellPicker';

// Mirrors the seeded catalog (backend/src/seed/data/reference.ts); ids are
// the insertion-order ids a fresh seed assigns.
const CATALOG = [
  { id: 1, code: '20DC', name: "20'DC" },
  { id: 2, code: '40DC', name: "40'DC" },
  { id: 3, code: '40RF', name: "40'RF" },
  { id: 4, code: '20RF', name: "20'RF" },
  { id: 5, code: '45HC', name: "45'HC" },
];

function PickerHarness({ initial = '', onCommitted }: { initial?: string; onCommitted?: (id: string) => void } = {}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <ContainerTypeCellPicker
        value={value}
        onChange={(id) => { setValue(id); onCommitted?.(id); }}
        options={CATALOG}
        fieldId="container-0-type"
        saving={false}
      />
      <output data-testid="committed">{value}</output>
    </div>
  );
}

async function openMenu(input: HTMLElement) {
  await act(async () => {
    input.focus();
    fireEvent.focusIn(input);
    fireEvent.click(input);
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

describe('SIL-630 — Loại container dropdown shows and stores the picked row (id-mapped, never index-mapped)', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      return DOMRect.fromRect({ x: 200, y: 470, width: 160, height: 36 });
    });
  });

  it.each([
    { pick: '20DC', id: '1' },
    { pick: '40DC', id: '2' },
    { pick: '40RF', id: '3' },
    { pick: '20RF', id: '4' },
    { pick: '45HC', id: '5' },
  ])('picking $pick commits its own row id $id and displays "$pick"', async ({ pick, id }) => {
    const committed: string[] = [];
    const utils = render(<PickerHarness onCommitted={(v) => committed.push(v)} />);
    const input = utils.getByLabelText('Loại container') as HTMLInputElement;

    await openMenu(input);
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: pick }));
    });

    expect(committed).toEqual([id]);
    expect(utils.getByTestId('committed').textContent).toBe(id);
    expect(input.value).toBe(pick);
    utils.unmount();
  });

  it('an externally restored id displays its own code (prefill / dialog-create path)', () => {
    const utils = render(<PickerHarness initial="1" />);
    const input = utils.getByLabelText('Loại container') as HTMLInputElement;
    expect(input.value).toBe('20DC');
    utils.unmount();
  });
});
