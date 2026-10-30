import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SplitDateTimeField } from './SplitDateTimeField';

/**
 * FB-002 (181026000027) + FB-030/075 (171026215500) — the segmented datetime
 * Enter/auto-advance contract, driven with the REAL browser keystroke shape
 * (keydown → inserted character → change) instead of whole-value
 * `fireEvent.change`, which bypasses the keydown path entirely.
 *
 *  - two complete in-range digits auto-focus the next segment (FB-030/075);
 *  - Enter on a hand-typed segment commits through onCommit when the host
 *    supplies one (FB-002, popover family);
 *  - without onCommit the key must reach an enclosing form UNPREVENTED so the
 *    native implicit submission can save (FB-002, dispatch dialog / add-row /
 *    create form) — the old code swallowed it and Enter saved nothing;
 *  - an incomplete draft still swallows Enter (never submit a stale value);
 *  - a single-digit segment is not flagged while typing.
 */

const hour = () => screen.getByLabelText('Giờ — Hẹn');
const minute = () => screen.getByLabelText('Phút — Hẹn');
const day = () => screen.getByLabelText('Ngày — Hẹn');

/** Browser-shaped typing: every keystroke lands on whatever segment holds
 * focus (auto-advance moves it between keystrokes), as keydown + inserted
 * character via change. Append-only: it models typing into an empty or
 * caret-tailed segment, not selection-aware type-over — extend with
 * selection state before reusing it for type-over cases. */
function typeReal(text: string) {
  for (const key of text) {
    const input = document.activeElement as HTMLInputElement;
    fireEvent.keyDown(input, { key });
    fireEvent.change(input, { target: { value: input.value + key } });
  }
}

function CommitHarness({ onCommit }: { onCommit: (value: string) => void }) {
  const [current, setCurrent] = useState('');
  return <SplitDateTimeField label="Hẹn" value={current} onChange={setCurrent} onCommit={onCommit} />;
}

describe('SplitDateTimeField — FB-002 + FB-030/075 segmented entry contract', () => {
  it('FB-030/075: typing "14" in the hour auto-advances focus to the minute segment', () => {
    render(<CommitHarness onCommit={vi.fn()} />);
    expect(document.activeElement).not.toBe(hour());
    hour().focus();
    typeReal('14');
    expect(hour()).toHaveValue('14');
    expect(document.activeElement).toBe(minute());
    expect(minute()).toHaveValue('');
  });

  it('FB-030/075: typing "17" in the day auto-advances focus to the month segment', () => {
    render(<CommitHarness onCommit={vi.fn()} />);
    day().focus();
    typeReal('17');
    expect(day()).toHaveValue('17');
    expect(document.activeElement).toBe(screen.getByLabelText('Tháng — Hẹn'));
  });

  it('FB-002: Enter after a hand-typed date+time commits through onCommit', () => {
    const onCommit = vi.fn();
    render(<CommitHarness onCommit={onCommit} />);
    // SIL-608 date-first entry: ngày (DD/MM/YYYY) typed first, năm complete
    // hands the caret to giờ; giờ (HH:mm) closes the draft.
    day().focus();
    typeReal('18102026');
    typeReal('1430');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('2026-10-18T14:30');
    expect(document.activeElement).not.toBe(minute()); // blurred after commit
  });

  it('FB-002: without onCommit, Enter is no longer swallowed by the field — it reaches the host unchanged', () => {
    // jsdom never synthesizes a form's implicit submission, and a form with
    // no submit button + several text inputs runs none in browsers either —
    // so this pins exactly what the component owes: the keydown arrives at
    // the host layer UNPREVENTED (the host then saves through its own path:
    // the CUS add-row's Enter handler, a requestSubmit-wired dialog form).
    const seen: Array<{ key: string; unprevented: boolean }> = [];
    function FormHarness() {
      const [current, setCurrent] = useState('');
      return (
        <form onKeyDown={(event) => seen.push({ key: event.key, unprevented: !event.defaultPrevented })}>
          <SplitDateTimeField label="Hẹn" value={current} onChange={setCurrent} />
        </form>
      );
    }
    render(<FormHarness />);
    // Date-first entry (SIL-608), then giờ — Enter lands on the last segment.
    day().focus();
    typeReal('18102026');
    typeReal('1430');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(seen.at(-1)).toEqual({ key: 'Enter', unprevented: true });
  });

  it('FB-002: an incomplete draft still swallows Enter — no stale submit, no commit', () => {
    const onCommit = vi.fn();
    const formKeys: Array<[key: string, prevented: boolean]> = [];
    function FormHarness() {
      const [current, setCurrent] = useState('');
      return (
        <form onKeyDown={(event) => formKeys.push([event.key, event.defaultPrevented])}>
          <SplitDateTimeField label="Hẹn" value={current} onChange={setCurrent} onCommit={onCommit} />
        </form>
      );
    }
    render(<FormHarness />);
    hour().focus();
    typeReal('14');
    fireEvent.keyDown(hour(), { key: 'Enter' }); // time only — date still empty
    expect(onCommit).not.toHaveBeenCalled();
    // Swallowed INSIDE the field: the enclosing form never sees the Enter
    // (stopPropagation) and no implicit submission can fire.
    expect(formKeys.filter(([key]) => key === 'Enter')).toHaveLength(0);
    // The touched draft also surfaces its own reason.
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập đủ giờ và ngày hợp lệ.');
  });

  it('a single-digit segment is not flagged while typing (FB-030/075 invalid rule)', () => {
    render(<CommitHarness onCommit={vi.fn()} />);
    hour().focus();
    typeReal('1');
    expect(hour()).toHaveValue('1');
    expect(hour()).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The field-level message only appears once touched (Enter/blur), not
    // mid-typing on a lone digit.
    fireEvent.blur(hour());
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập đủ giờ và ngày hợp lệ.');
  });
});
