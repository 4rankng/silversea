import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CargoTypes from './CargoTypesConfigPage';
import Trucks from './TrucksConfigPage';
import Trailers from './TrailersConfigPage';
import ExpenseCategories from './ExpenseCategoriesConfigPage';
import TirePositions from './TirePositionsConfigPage';
import CapTable from './CapTableConfigPage';
import BusinessCalendar from './BusinessCalendarConfigPage';

const save = vi.hoisted(() => vi.fn());
vi.mock('../../components/config/CrudTable', () => ({
  CrudTable: ({ renderForm }: { renderForm: (props: { saving: boolean; onSave: typeof save; onCancel: () => void }) => ReactNode }) =>
    <div>{renderForm({ saving: false, onSave: save, onCancel: () => {} })}</div>,
}));

const cases = [
  ['cargo type', CargoTypes, 'Tên loại hàng'],
  ['truck', Trucks, 'Biển số'],
  ['trailer', Trailers, 'Biển số rơ-moóc'],
  ['expense category', ExpenseCategories, 'Tên hạng mục'],
  ['tire position', TirePositions, 'Tên vị trí'],
  ['capital contribution', CapTable, 'Tên cổ đông'],
  ['business calendar', BusinessCalendar, 'Tên ngày nghỉ / ngày làm bù'],
] as const;

describe('configuration form required values', () => {
  beforeEach(() => save.mockClear());

  it.each(cases)('%s reports an invalid field instead of silently ignoring Add', (_name, Page, label) => {
    const { container } = render(<Page />);
    const input = screen.getByLabelText(label) as HTMLInputElement;
    const form = container.querySelector('[data-config-form]')! as HTMLElement;
    const report = vi.spyOn(HTMLInputElement.prototype, 'reportValidity');
    fireEvent.click(within(form).getByRole('button', { name: 'Thêm' }));
    expect(save).not.toHaveBeenCalled();
    expect(input).toBeRequired();
    expect(input.checkValidity()).toBe(false);
    expect(report).toHaveBeenCalled();
    expect(document.activeElement?.matches('input:invalid')).toBe(true);
    fireEvent.change(input, { target: { value: '   ' } });
    expect(input.checkValidity()).toBe(false);
    fireEvent.click(within(form).getByRole('button', { name: 'Thêm' }));
    expect(save).not.toHaveBeenCalled();
    report.mockRestore();
  });

  it.each(cases.slice(0, 5))('%s still submits a valid trimmed value', (_name, Page, label) => {
    render(<Page />);
    fireEvent.change(screen.getByLabelText(label), { target: { value: '  QA configuration  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(Object.values(save.mock.calls[0][0])).toContain('QA configuration');
  });
});
