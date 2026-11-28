import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input } from '../../components/untitled-ui/base/input/input';
import { Button } from '../../components/untitled-ui/base/buttons/button';
import { BufferedUuiDateInput } from './BufferedUuiDateInput';
import { BufferedUuiDateTimeInput } from './BufferedUuiDateTimeInput';
import { UuiSelectField } from './UuiSelectField';

const expectCompactField = (element: Element) => {
  expect(element).toHaveClass('text-[length:var(--text-control-compact-size)]', 'leading-[1.35]', 'max-md:text-[length:var(--control-zoom-safe-font-size)]', '[@media(pointer:coarse)]:text-[length:var(--control-zoom-safe-font-size)]');
};

describe('shared field typography roles', () => {
  it('gives text, date and time values the same compact and touch sizes while keeping labels and hints independent', () => {
    render(<>
      <Input label="Nội dung" size="sm" hint="Gợi ý" />
      <BufferedUuiDateInput label="Ngày" size="sm" value="" onChange={vi.fn()} />
      <BufferedUuiDateTimeInput label="Giờ" size="sm" value="" onChange={vi.fn()} />
      <Button size="sm">Lưu</Button>
    </>);
    for (const name of ['Nội dung', 'Ngày', 'Giờ — Giờ', 'Ngày — Giờ']) expectCompactField(screen.getByLabelText(name));
    for (const name of ['Nội dung', 'Ngày', 'Gợi ý']) expect(screen.getByText(name)).toHaveClass('text-xs', 'leading-[1.5]');
    expect(screen.getByText('Giờ')).toHaveClass('split-datetime__label');
    const action = screen.getByRole('button', { name: 'Lưu' });
    expect(action).toHaveClass('max-md:text-[length:var(--text-control-size)]');
    expect(action).not.toHaveClass('max-md:text-[length:var(--control-zoom-safe-font-size)]');
  });

  it('matches the selected value and portalled option text without shrinking a long option to one clipped line', async () => {
    const label = 'Công ty vận tải có tên đầy đủ cần đọc trước khi chọn';
    render(<UuiSelectField label="Khách hàng" value="customer" onChange={vi.fn()} options={[{ value: 'customer', label }]} />);
    const trigger = screen.getByRole('button', { name: /Khách hàng/ });
    expectCompactField(within(trigger).getByText(label));
    fireEvent.click(trigger);
    const option = await screen.findByRole('option', { name: label });
    const text = within(option).getByText(label);
    expectCompactField(text);
    expect(text).toHaveClass('whitespace-normal', 'break-words');
    expect(text).not.toHaveClass('truncate', 'whitespace-nowrap');
  });

  it('keeps a searchable dropdown placeholder on the same field scale as typed text', () => {
    render(<UuiSelectField label="Tuyến" value="" onChange={vi.fn()} options={Array.from({ length: 5 }, (_, index) => ({ value: String(index), label: `Tuyến ${index}` }))} placeholder="Tìm tuyến" />);
    const input = screen.getByRole('combobox', { name: /Tuyến/ });
    expectCompactField(input);
    const boundary = input.closest('[role="group"]');
    expect(boundary).toHaveClass('uui-combobox');
    expect(boundary).toHaveAttribute('data-size', 'sm');
  });

  // SIL-1283 — the required mark is " *": one real separating space before
  // the red star, so a required label reads "Lái xe *" like the hand-built
  // "Số tiền *" labels — never the glued "Lái xe*". The pin reads the
  // label's full textContent (the exact string QA measures); getByText
  // cannot span the label-text + star-element split.
  // SIL-1349 (kiểm toán 28/11 §2.2) — the separating space is NON-BREAKING:
  // a wrapped label ("Thực thu — thu khách (VND) *") must never strand the
  // star alone on the next line, so the mark glues to the label's last word.
  it('renders the required mark as a glued non-breaking " *", never an orphan star', () => {
    render(<UuiSelectField label="Lái xe" required value="" onChange={vi.fn()} options={[{ value: '1', label: 'Nguyễn Văn A' }]} />);
    const label = document.querySelector('[data-label="true"]') as HTMLElement | null;
    expect(label?.textContent).toBe('Lái xe\u00A0*');
    // The star never starts a line: the space before it offers no break point.
    expect(label?.textContent?.startsWith('\u00A0*')).toBe(false);
    expect(label?.textContent).not.toBe('Lái xe *');
  });
});
