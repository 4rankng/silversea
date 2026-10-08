import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DateField } from './DateField';
import { TextField } from './TextField';

describe('TextField external validation state', () => {
  it.each([true, 'true'] as const)('styles aria-invalid=%s without duplicating the existing error announcement', invalid => {
    const { container, rerender } = render(<>
      <TextField id="external-field" label="Tài khoản" defaultValue="draft" prefix="@" aria-invalid={invalid} aria-describedby="external-error" />
      <div id="external-error" role="alert">Thông tin bị từ chối</div>
    </>);
    const input = screen.getByLabelText('Tài khoản');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'external-error');
    expect(input.closest('.ds-field')).toHaveClass('ds-field--error');
    expect(container.querySelector('.ds-field__input-group')).not.toBeNull();
    expect(container.querySelector('.ds-field__msg--error')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.change(input, { target: { value: 'corrected' } });
    rerender(<><TextField id="external-field" label="Tài khoản" defaultValue="draft" prefix="@" aria-invalid={false} /></>);
    expect(screen.getByLabelText('Tài khoản')).toHaveValue('corrected');
    expect(input.closest('.ds-field')).not.toHaveClass('ds-field--error');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it.each([undefined, 'short-number'] as const)('preserves normal and explicit false output for width=%s', controlWidth => {
    const { container, rerender } = render(<TextField id="valid-field" label="Hệ số" defaultValue="1.25" controlWidth={controlWidth} />);
    const original = container.innerHTML;
    rerender(<TextField id="valid-field" label="Hệ số" defaultValue="1.25" controlWidth={controlWidth} aria-invalid={false} />);
    expect(container.innerHTML).toBe(original);
    rerender(<TextField id="valid-field" label="Hệ số" defaultValue="1.25" controlWidth={controlWidth} aria-invalid="false" />);
    expect(container.innerHTML).toBe(original);
    expect(screen.getByLabelText('Hệ số')).toHaveValue('1.25');
    expect(container.querySelector('.ds-field')).not.toHaveClass('ds-field--error');
  });
});

describe('UI57 internally validated DateField boundary', () => {
  it('paints native select and textarea errors and the affix boundary once, leaving false and untouched states neutral', () => {
    render(<>
      <TextField label="Tiền" prefix="₫" aria-invalid="true" defaultValue="invalid draft" />
      <label>Ghi chú<textarea aria-invalid="true" defaultValue="draft" /></label>
      <label>Loại<select aria-invalid="true" defaultValue=""><option value="">Chọn loại</option></select></label>
      <label>Đúng<input aria-invalid="false" defaultValue="valid" /></label>
      <label>Bắt buộc<input required defaultValue="" /></label>
    </>);
    const css = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
    const owner = css.match(/\/\* Public aria-invalid boundary paint \(QA-AUDIT-UI57\)[\s\S]*?\*\/\s*([^{}]+)\{([^}]+)\}/);
    expect(owner).not.toBeNull();
    const selector = owner![1].trim();
    const inner = screen.getByLabelText('Tiền');
    expect(inner.matches(selector)).toBe(false);
    expect(inner.closest('.ds-field__input-group')!.matches(selector)).toBe(true);
    for (const label of ['Ghi chú', 'Loại']) expect(screen.getByLabelText(label).matches(selector)).toBe(true);
    for (const label of ['Đúng', 'Bắt buộc']) expect(screen.getByLabelText(label).matches(selector)).toBe(false);
  });

  it('uses native invalid paint without inventing a second wrapper error, then clears it on correction', () => {
    const changes: string[] = [];
    function ControlledDate() {
      const [value, setValue] = useState('2026-10-01');
      return <>
        <DateField label="Ngày chi" value={value} onChange={next => { changes.push(next); setValue(next); }} />
        <button>Rời trường</button>
      </>;
    }
    render(<ControlledDate />);
    const input = screen.getByLabelText('Ngày chi') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '33/10/2026' } });
    fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: 'Rời trường' }) });
    expect(input).toHaveValue('33/10/2026');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.validity.valid).toBe(false);
    expect(input.closest('.ds-field')).not.toHaveClass('ds-field--error');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập ngày hợp lệ theo DD/MM/YYYY.');
    expect(changes).toEqual([]);

    const css = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
    const owner = css.match(/\/\* Public aria-invalid boundary paint \(QA-AUDIT-UI57\)[\s\S]*?\*\/\s*([^{}]+)\{([^}]+)\}/);
    expect(owner, 'public native invalid state has a shared danger paint owner').not.toBeNull();
    expect(owner![2]).toContain('border-color: var(--danger)');
    expect(input.matches(owner![1].trim())).toBe(true);

    fireEvent.change(input, { target: { value: '31/10/2026' } });
    expect(input).toHaveValue('31/10/2026');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input.validity.valid).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input.matches(owner![1].trim())).toBe(false);
    expect(changes).toEqual(['2026-10-31']);
  });
});
