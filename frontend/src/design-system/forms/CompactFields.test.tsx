import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TextField } from './TextField';
import { DateField } from './DateField';
import { NumberField } from './NumberField';

describe('shared compact operational field geometry', () => {
  it('uses the same semantic variant for text, amount and date without leaking it onto the input', () => {
    render(<><TextField label="Tên" value="Ops" onChange={vi.fn()} controlSize="sm" /><NumberField label="Tiền" value={500000} onChange={vi.fn()} controlSize="sm" /><DateField label="Ngày" value="2026-09-16" onChange={vi.fn()} controlSize="sm" /></>);
    for (const name of ['Tên', 'Tiền', 'Ngày']) {
      expect(screen.getByLabelText(name).closest('.ds-field')).toHaveClass('ds-field--sm');
      expect(screen.getByLabelText(name)).not.toHaveAttribute('controlSize');
    }
  });
  it('keeps the compact base and coarse-pointer touch floor in the shared primitive', () => {
    const css = readFileSync('src/design-system/forms/TextField.css', 'utf8');
    expect(css).toMatch(/\.ds-field--sm \.ds-field__input\s*\{[^}]*min-height: var\(--control-compact-h\)/);
    expect(css).toMatch(/@media \(pointer: coarse\)[^{]*\{\s*\.ds-field--sm \.ds-field__input\s*\{[^}]*min-height: var\(--control-touch-h\)/);
  });
});
