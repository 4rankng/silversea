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
    expect(css).toMatch(/@media \(pointer: coarse\)[^{]*\{\s*\.ds-field--sm\s*\{[^}]*--field-control-h: var\(--control-touch-h\)\s*;\s*\}\s*\.ds-field--sm \.ds-field__input\s*\{[^}]*min-height: var\(--control-touch-h\)/);
  });
  it('keeps default fields and affix borders within the token ceiling without clipping multiline content', () => {
    const css = readFileSync('src/design-system/forms/TextField.css', 'utf8');
    expect(css).toContain('--field-control-h: var(--control-h)');
    expect(css).not.toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/:is\(#root, body\) \.ds-field \.ds-field__input-group > input\.ds-field__input[^,{]*,\s*:is\(#root, body\) \.ds-field \.ds-field__input-group > \.ds-field__affix\s*\{[^}]*min-height: calc\(var\(--field-control-h\) - 2px\)/);
    expect(css).not.toMatch(/(?:^|[;{])\s*(?:height|max-height):/m);
  });
  it('uses flat input and group surfaces while retaining brand and validation focus rings', () => {
    const css = readFileSync('src/design-system/forms/TextField.css', 'utf8');
    expect(css).not.toMatch(/linear-gradient|box-shadow:\s*inset/);
    expect(css).toMatch(/\.ds-field__input-group\s*\{[^}]*background: var\(--surface\)/);
    expect(css).toMatch(/\.ds-field__input:focus\s*\{[^}]*box-shadow: 0 0 0 4px color-mix\(in srgb, var\(--brand\)/);
    expect(css).toMatch(/\.ds-field--error \.ds-field__input-group:focus-within\s*\{[^}]*box-shadow: 0 0 0 3px color-mix\(in srgb, var\(--danger\)/);
    expect(css).toMatch(/\.ds-field__input-group:has\(\.ds-field__input:focus-visible\)\s*\{[^}]*outline: 2px solid var\(--accent-2\)/);
    expect(css).toMatch(/\.ds-field--error \.ds-field__input-group:has\(\.ds-field__input:focus-visible\)\s*\{[^}]*outline-color: var\(--danger\)/);
  });
  it('keeps embedded house actions inside the affix border without fixing field content height', () => {
    const css = readFileSync('src/design-system/forms/TextField.css', 'utf8');
    expect(css).toMatch(/\.ds-field__affix:has\(> \[data-uui-control='button'\]\)\s*\{[^}]*padding: 0/);
    expect(css).toMatch(/:is\(#root, body\) \.ds-field__affix > \[data-uui-control='button'\]\s*\{[^}]*--uui-control-h: calc\(var\(--field-control-h\) - 2px\);[^}]*min-height: calc\(var\(--field-control-h\) - 2px\)/);
    expect(css).toMatch(/:is\(#root, body\) \.ds-field__affix > \[data-uui-control='button'\]\[data-icon-only\]\s*\{[^}]*width: calc\(var\(--field-control-h\) - 2px\)/);
    expect(css).not.toMatch(/(?:^|[;{])\s*(?:height|max-height):/m);
  });
  it('sizes short numeric editors independently of their value and touch height', () => {
    render(<TextField label="Hệ số" defaultValue="0" inputMode="decimal" controlWidth="short-number" />);
    const input = screen.getByLabelText('Hệ số');
    expect(input.closest('.ds-field')).toHaveClass('ds-field--short-number', 'ds-field--md');
    expect(input).not.toHaveAttribute('controlWidth');
    expect(input).not.toHaveAttribute('maxLength');
    const css = readFileSync('src/design-system/forms/TextField.css', 'utf8');
    expect(css).toMatch(/\.ds-field\.ds-field--short-number\s*\{[^}]*--field-control-h: var\(--control-compact-h\);[^}]*width: 72px;[^}]*max-width: 100%/);
    expect(css).toMatch(/:is\(#root, body\) \.ds-field\.ds-field--short-number input\.ds-field__input[^}]*min-height: var\(--control-compact-h\);[^}]*padding-block: 5px/);
    expect(css).toMatch(/:is\(#root, body\) \.ds-field\.ds-field--short-number \.ds-field__input-group > input\.ds-field__input[^}]*min-height: calc\(var\(--control-compact-h\) - 2px\)/);
    expect(css).toMatch(/\.ds-field--short-number \.ds-field__input\s*\{[^}]*text-align: right;[^}]*font-family: var\(--font-data\)/);
  });
});
