import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BufferedUuiDateInput } from '../forms/BufferedUuiDateInput';
import { DateInput } from '../forms/DateInput';

function renderControlled(changes: string[]) {
  function ControlledDate() {
    const [value, setValue] = useState('2026-10-01');
    return <>
      <BufferedUuiDateInput id="controlled-date" label="Ngày vận chuyển" value={value}
        onChange={next => { changes.push(next); setValue(next); }} fieldPrefix="Từ" />
      <output data-testid="committed-date">{value}</output>
      <button onClick={() => setValue('2026-02-28')}>Đặt ngày bên ngoài</button>
      <button>Rời trường</button>
    </>;
  }
  render(<ControlledDate />);
  return screen.getByLabelText('Ngày vận chuyển') as HTMLInputElement;
}

const edit = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
const leave = (input: HTMLElement) => fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: 'Rời trường' }) });

describe('UI55 controlled segmented date draft acknowledgement', () => {
  it('keeps both replacement digits of an invalid day and never echoes a padded partial endpoint', () => {
    const changes: string[] = [];
    const day = renderControlled(changes);
    edit(day, '3');
    expect(day).toHaveValue('3');
    expect(changes).toEqual([]);
    edit(day, '33');
    leave(day);
    expect(day).toHaveValue('33');
    expect(day.checkValidity()).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập ngày hợp lệ theo DD/MM/YYYY.');
    expect(screen.getByTestId('committed-date')).toHaveTextContent('2026-10-01');
    expect(changes).toEqual([]);
  });

  it('commits complete31 and26 corrections once without formatting their first key', () => {
    const changes: string[] = [];
    const day = renderControlled(changes);
    edit(day, '3');
    expect(day).toHaveValue('3');
    edit(day, '31');
    expect(changes).toEqual(['2026-10-31']);
    edit(day, '2');
    expect(day).toHaveValue('2');
    expect(changes).toEqual(['2026-10-31']);
    edit(day, '26');
    leave(day);
    expect(day).toHaveValue('26');
    expect(changes).toEqual(['2026-10-31', '2026-10-26']);
    expect(day.checkValidity()).toBe(true);
  });

  it('retains month/year keys until complete and still clears only an entirely empty endpoint', () => {
    const changes: string[] = [];
    const day = renderControlled(changes);
    const month = screen.getByLabelText('Tháng — Ngày vận chuyển');
    const year = screen.getByLabelText('Năm — Ngày vận chuyển');
    edit(month, '1');
    expect(month).toHaveValue('1');
    expect(changes).toEqual([]);
    edit(month, '12');
    expect(changes).toEqual(['2026-12-01']);
    for (const digits of ['2', '20', '202']) {
      edit(year, digits);
      expect(year).toHaveValue(digits);
      expect(changes).toEqual(['2026-12-01']);
    }
    edit(year, '2027');
    expect(changes).toEqual(['2026-12-01', '2027-12-01']);
    edit(day, '');
    edit(month, '');
    expect(changes).toEqual(['2026-12-01', '2027-12-01']);
    edit(year, '');
    expect(changes).toEqual(['2026-12-01', '2027-12-01', '']);
    expect(screen.getByTestId('committed-date')).toBeEmptyDOMElement();
    expect(day.checkValidity()).toBe(true);
  });

  it('commits valid shorthand only when focus leaves the whole field and normalizes it once', () => {
    const changes: string[] = [];
    const day = renderControlled(changes);
    const month = screen.getByLabelText('Tháng — Ngày vận chuyển');
    edit(day, '3');
    fireEvent.blur(day, { relatedTarget: month });
    expect(changes).toEqual([]);
    expect(day).toHaveValue('3');
    leave(month);
    expect(changes).toEqual(['2026-10-03']);
    expect(day).toHaveValue('03');
    leave(day);
    expect(changes).toEqual(['2026-10-03']);
  });

  it('commits valid shorthand on Enter through the existing native keyboard path', () => {
    const changes: string[] = [];
    const day = renderControlled(changes);
    edit(day, '3');
    fireEvent.keyDown(day, { key: 'Enter' });
    expect(changes).toEqual(['2026-10-03']);
    expect(day).toHaveValue('03');
  });

  it('accepts an external parent reset after an invalid draft and retains calendar selection', () => {
    const changes: string[] = [];
    const day = renderControlled(changes);
    edit(day, '33');
    leave(day);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt ngày bên ngoài' }));
    expect(day).toHaveValue('28');
    expect(screen.getByLabelText('Tháng — Ngày vận chuyển')).toHaveValue('02');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(day);
    fireEvent.click(screen.getByRole('button', { name: '26 Tháng 2 2026' }));
    expect(changes).toEqual(['2026-02-26']);
    expect(day).toHaveValue('26');
    expect(screen.queryByRole('dialog', { name: 'Chọn ngày — Ngày vận chuyển' })).not.toBeInTheDocument();
    expect(day).toHaveFocus();
  });
});

function renderNativeControlled(changes: string[], blurs: string[] = [], limits: { min?: string; max?: string } = {}) {
  function ControlledDate() {
    const [value, setValue] = useState('2026-10-01');
    return <>
      <label htmlFor="native-date">Ngày trên biểu mẫu</label>
      <DateInput id="native-date" name="departureDate" value={value} {...limits}
        onChange={next => { changes.push(next); setValue(next); }}
        onBlur={() => blurs.push('blur')} />
      <output data-testid="committed-date">{value}</output>
      <button>Rời trường</button>
    </>;
  }
  const result = render(<ControlledDate />);
  return {
    input: screen.getByLabelText('Ngày trên biểu mẫu') as HTMLInputElement,
    hidden: result.container.querySelector<HTMLInputElement>('input[type="hidden"][name="departureDate"]')!,
  };
}

describe('UI55 DateInput hook-caller compatibility', () => {
  it.each(['blur', 'Enter'])('commits valid shorthand on %s and updates the actual hidden ISO once', (commit) => {
    const changes: string[] = [];
    const blurs: string[] = [];
    const { input, hidden } = renderNativeControlled(changes, blurs);
    edit(input, '3/10/2026');
    expect(input).toHaveValue('3/10/2026');
    expect(hidden).toHaveValue('2026-10-01');
    expect(changes).toEqual([]);
    if (commit === 'blur') leave(input);
    else fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('03/10/2026');
    expect(hidden).toHaveValue('2026-10-03');
    expect(changes).toEqual(['2026-10-03']);
    leave(input);
    expect(changes).toEqual(['2026-10-03']);
    expect(blurs).toHaveLength(commit === 'blur' ? 2 : 1);
  });

  it.each([
    ['33/10/2026', {}, 'Nhập ngày hợp lệ theo DD/MM/YYYY.'],
    ['3/10/2026', { min: '2026-10-10' }, 'Chọn ngày từ10/10/2026.'],
    ['31/10/2026', { max: '2026-10-20' }, 'Chọn ngày đến20/10/2026.'],
  ] as const)('retains invalid or out-of-range draft %s without altering hidden ISO', (draft, limits, message) => {
    const changes: string[] = [];
    const { input, hidden } = renderNativeControlled(changes, [], limits);
    edit(input, draft);
    fireEvent.keyDown(input, { key: 'Enter' });
    leave(input);
    expect(input).toHaveValue(draft);
    expect(input.checkValidity()).toBe(false);
    expect(screen.getByRole('alert').textContent?.replace(/\s/g, '')).toBe(message.replace(/\s/g, ''));
    expect(hidden).toHaveValue('2026-10-01');
    expect(changes).toEqual([]);
  });
});

describe.each(['native', 'segmented'] as const)('UI55 %s calendar draft boundaries', (caller) => {
  function setup() {
    const changes: string[] = [];
    const input = caller === 'native' ? renderNativeControlled(changes).input : renderControlled(changes);
    edit(input, caller === 'native' ? '3/10/2026' : '3');
    fireEvent.click(input);
    return { changes, input, dialog: screen.getByRole('dialog', { name: caller === 'native' ? 'Chọn ngày' : 'Chọn ngày — Ngày vận chuyển' }) };
  }

  it.each(['outside pointer', 'calendar blur'])('commits shorthand once on genuine %s exit', (exit) => {
    const { changes, input } = setup();
    const outside = screen.getByRole('button', { name: 'Rời trường' });
    if (exit === 'calendar blur') {
      const calendarButton = screen.getByRole('button', { name: 'Đóng lịch' });
      fireEvent.focus(calendarButton);
      fireEvent.blur(input, { relatedTarget: calendarButton });
      expect(changes).toEqual([]);
      fireEvent.blur(calendarButton, { relatedTarget: outside });
    }
    else if (typeof window.PointerEvent === 'function') fireEvent.pointerDown(outside);
    else fireEvent.mouseDown(outside);
    expect(changes).toEqual(['2026-10-03']);
    expect(input).toHaveValue(caller === 'native' ? '03/10/2026' : '03');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    leave(input);
    expect(changes).toEqual(['2026-10-03']);
  });

  it.each(['input Escape', 'panel Escape', 'BODY Escape', 'close button'])('keeps shorthand uncommitted when canceled by %s', (cancel) => {
    const { changes, input, dialog } = setup();
    if (cancel === 'close button') fireEvent.click(screen.getByRole('button', { name: 'Đóng lịch' }));
    else fireEvent.keyDown(cancel === 'BODY Escape' ? document.body : cancel === 'panel Escape' ? dialog : input,
      { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input).toHaveValue(caller === 'native' ? '3/10/2026' : '3');
    expect(screen.getByTestId('committed-date')).toHaveTextContent('2026-10-01');
    expect(changes).toEqual([]);
  });

  it('emits only the actual calendar selection once', () => {
    const { changes, input } = setup();
    fireEvent.click(screen.getByRole('button', { name: '26 Tháng 10 2026' }));
    expect(changes).toEqual(['2026-10-26']);
    expect(input).toHaveValue(caller === 'native' ? '26/10/2026' : '26');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });
});
