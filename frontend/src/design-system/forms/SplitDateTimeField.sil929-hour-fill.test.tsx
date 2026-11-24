// SIL-929 (KB §3.2.5 K3.31, QA staging 3e9a28fa): typing the complete hour
// ('08') into the Giờ segment auto-fills the EMPTY minute ('00') and hands it
// focus — the time reads '08:00', never the half-filled '08:mm' QA filed on
// the "Ngày giờ đóng trả" container cell of the Tạo lô form. A minute already
// holding digits is retained (the retain contract —
// DateTimeField.retain.test.tsx), and the fill rides the same complete-draft
// emission every other entry path uses.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SplitDateTimeField } from './SplitDateTimeField';

function Harness({ value = '', onChange, combinedPicker }: {
  value?: string;
  onChange?: (value: string) => void;
  combinedPicker?: boolean;
}) {
  const [current, setCurrent] = useState(value);
  return (
    <form>
      <SplitDateTimeField
        label="Ngày giờ đóng trả"
        value={current}
        onChange={(next) => { setCurrent(next); onChange?.(next); }}
        combinedPicker={combinedPicker}
      />
    </form>
  );
}

const hour = () => screen.getByLabelText('Giờ — Ngày giờ đóng trả') as HTMLInputElement;
const minute = () => screen.getByLabelText('Phút — Ngày giờ đóng trả') as HTMLInputElement;
const day = () => screen.getByLabelText('Ngày — Ngày giờ đóng trả') as HTMLInputElement;
const month = () => screen.getByLabelText('Tháng — Ngày giờ đóng trả') as HTMLInputElement;
const year = () => screen.getByLabelText('Năm — Ngày giờ đóng trả') as HTMLInputElement;

describe("SIL-929 — a complete hour fills the empty minute '00' (KB §3.2.5 K3.31)", () => {
  it("typing '08' into Giờ on an empty field fills Phút '00' and hands it focus", () => {
    render(<Harness />);
    act(() => hour().focus());
    fireEvent.change(hour(), { target: { value: '08' } });
    expect(hour()).toHaveValue('08');
    expect(minute()).toHaveValue('00');
    expect(minute()).toHaveFocus();
  });

  it("the QA repro path: with the 'Chọn ngày giờ' picker open, typing '08' reads '08:00' — never '08:mm'", () => {
    render(<Harness combinedPicker />);
    fireEvent.click(hour());
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]!.textContent).toContain('Chọn ngày giờ');
    fireEvent.change(hour(), { target: { value: '08' } });
    expect(hour()).toHaveValue('08');
    expect(minute()).toHaveValue('00');
  });

  it('a minute that already holds digits is retained on hour type-over', () => {
    render(<Harness value="2026-10-06T14:45" />);
    fireEvent.change(hour(), { target: { value: '08' } });
    expect(hour()).toHaveValue('08');
    expect(minute()).toHaveValue('45');
  });

  it("the separator jump pads a lone digit and fills the empty minute too ('8:' → '08:00')", () => {
    render(<Harness />);
    act(() => hour().focus());
    fireEvent.change(hour(), { target: { value: '8' } });
    fireEvent.keyDown(hour(), { key: ':' });
    expect(hour()).toHaveValue('08');
    expect(minute()).toHaveValue('00');
    expect(minute()).toHaveFocus();
  });

  it('the filled minute completes the draft: a seeded date plus typed hour emits the full timestamp', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(day(), { target: { value: '19' } });
    fireEvent.change(month(), { target: { value: '09' } });
    fireEvent.change(year(), { target: { value: '2026' } });
    fireEvent.change(hour(), { target: { value: '08' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-09-19T08:00');
    expect(minute()).toHaveValue('00');
  });
});
