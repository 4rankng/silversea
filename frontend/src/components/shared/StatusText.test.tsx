// Card 20260924_21 (BATCH A — systemic UX purge).
// Pins the shared text+dot treatment: NO pill bubble, NO rounded background
// fill, NO border. Plain text + a single house color-dot. The legacy
// `<Badge>` API delegates to StatusText and inherits the same contract.
// Pinning here keeps the purge safe — re-introducing pill chrome will
// surface as a test failure before it lands.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusText } from './StatusText';
import { Badge } from './Badge';

function readStyle(el: HTMLElement): Record<string, string> {
  const cs = (el.style as CSSStyleDeclaration);
  return {
    background: cs.background || '',
    backgroundColor: cs.backgroundColor || '',
    borderTopStyle: cs.borderTopStyle || '',
    borderTopWidth: cs.borderTopWidth || '',
    borderRightStyle: cs.borderRightStyle || '',
    borderBottomStyle: cs.borderBottomStyle || '',
    borderLeftStyle: cs.borderLeftStyle || '',
    borderRadius: cs.borderRadius || '',
    color: cs.color || '',
    display: cs.display || '',
    gap: cs.gap || '',
    padding: cs.padding || '',
    textTransform: cs.textTransform || '',
  };
}

function hasNoBorder(style: Record<string, string>): boolean {
  // `border: none` in JSX serializes across the four sides; check them all so
  // the test pins the contract regardless of inline-style normalization.
  return (
    style.borderTopStyle === 'none' &&
    style.borderRightStyle === 'none' &&
    style.borderBottomStyle === 'none' &&
    style.borderLeftStyle === 'none'
  );
}

describe('StatusText — shared text+dot contract (card 20260924_21)', () => {
  it('renders plain text with a preceding colored dot, never a pill bubble', () => {
    const { container, getByText } = render(<StatusText variant="success">2 chiều</StatusText>);
    const root = container.firstElementChild as HTMLElement;
    const style = readStyle(root);
    expect(style.background).toBe('transparent');
    expect(hasNoBorder(style)).toBe(true);
    expect(['0', '0px']).toContain(style.borderRadius);
    expect(['0', '0px']).toContain(style.padding);
    expect(style.textTransform).toBe('none');
    expect(style.display).toBe('inline-flex');
    expect(style.gap).not.toBe('');
    // House color rides the success-text triad, NOT a filled bubble.
    expect(style.color).toContain('--success-text');
    // The label text is present.
    expect(getByText('2 chiều')).toBeTruthy();
  });

  it('renders the dot before the text and skips the dot when dot=false', () => {
    const withDot = render(<StatusText variant="warning">Đang mở</StatusText>);
    const withDotRoot = withDot.container.firstElementChild as HTMLElement;
    const dot = withDotRoot.firstElementChild as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.borderRadius).toBe('50%');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    // The label sits inside the second span (the text wrapper), not the dot.
    expect(dot.textContent).toBe('');
    const textWrap = withDotRoot.lastElementChild as HTMLElement;
    expect(textWrap.textContent).toBe('Đang mở');

    const noDot = render(<StatusText variant="warning" dot={false}>Đang mở</StatusText>);
    const noDotRoot = noDot.container.firstElementChild as HTMLElement;
    const noDotFirst = noDotRoot.firstElementChild as HTMLElement | null;
    expect((noDotFirst?.style.borderRadius ?? '') !== '50%').toBe(true);
    expect(noDotRoot.lastElementChild?.textContent).toBe('Đang mở');
  });

  it('uses the matching dot color token for every variant', () => {
    const cases: Array<['success' | 'warning' | 'danger' | 'info' | 'neutral', string]> = [
      ['success', '--success'],
      ['warning', '--warning'],
      ['danger',  '--danger'],
      ['info',    '--info'],
      ['neutral', '--ink-3'],
    ];
    for (const [variant, dotVar] of cases) {
      const { container } = render(<StatusText variant={variant}>x</StatusText>);
      const root = container.firstElementChild as HTMLElement;
      const dot = root.firstElementChild as HTMLElement;
      expect(dot.style.background, `dot bg for variant=${variant}`).toContain(dotVar);
    }
  });
});

describe('Badge — legacy API now delegates to the text+dot treatment', () => {
  it('renders no pill bubble for the existing variants', () => {
    for (const variant of ['success', 'warning', 'danger', 'info', 'neutral', 'outline'] as const) {
      const { container } = render(<Badge variant={variant}>x</Badge>);
      const root = container.firstElementChild as HTMLElement;
      const style = readStyle(root);
      expect(style.background).toBe('transparent');
      expect(hasNoBorder(style)).toBe(true);
      expect(['0', '0px']).toContain(style.borderRadius);
      expect(['0', '0px']).toContain(style.padding);
    }
  });

  it('outline maps to the neutral variant (no decorative border)', () => {
    const { container } = render(<Badge variant="outline">x</Badge>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.color).toContain('--ink-2');
    const firstChild = root.firstElementChild as HTMLElement | null;
    expect(firstChild?.style.background).toContain('--ink-3');
  });
});

describe('--status-text-* tokens exist in tokens.css', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

  it('declares the canonical text+dot spacing/font tokens', () => {
    for (const token of [
      '--status-text-font-size',
      '--status-text-line-height',
      '--status-text-gap',
      '--status-text-dot-size',
      '--status-text-weight',
      '--status-text-letter-spacing',
    ]) {
      const escaped = token.replace(/[-]/g, '\\-');
      expect(css.match(new RegExp(`${escaped}\\s*:`)) !== null, `token ${token}`).toBe(true);
    }
  });
});