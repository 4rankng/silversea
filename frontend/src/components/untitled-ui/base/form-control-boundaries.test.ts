import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Untitled UI flat-surface control boundaries', () => {
  it.each([
    'src/components/untitled-ui/base/input/input.tsx',
    'src/components/untitled-ui/base/textarea/textarea.tsx',
    'src/components/untitled-ui/base/select/select-native.tsx',
    'src/components/untitled-ui/base/select/select.tsx',
    'src/components/untitled-ui/base/select/combobox.tsx',
    // multi-select.tsx / tag-select.tsx: deleted by the 2026-09-30
    // verified-unreferenced audit (d195b7e0); their pins went with them.
  ])('%s uses a real border instead of a shadow-only boundary', (path) => {
    expect(read(path)).toContain('border border-primary');
  });

  it('clips input contents to the rounded control boundary', () => {
    expect(read('src/components/untitled-ui/base/input/input.tsx')).toContain('overflow-hidden rounded-lg border border-primary');
  });

  it('keeps the textarea focus outline active and avoids double borders in composed native selects', () => {
    expect(read('src/components/untitled-ui/base/textarea/textarea.tsx')).not.toContain('focus:outline-hidden');
    expect(read('src/components/untitled-ui/base/select/select-native.tsx')).toContain('in-data-input-wrapper:border-0');
  });

  it('reserves a trailing icon lane in every native-select size', () => {
    const select = read('src/components/untitled-ui/base/select/select-native.tsx');
    expect(select).toContain('root: "min-h-[34px] py-1 pl-2.5 pr-8');
    expect(select).toContain('max-md:pr-10');
    expect(select).toContain('fieldTextSizes[size]');
    expect(select).toContain('root: "py-2 pl-3 pr-10"');
    expect(select).toContain('root: "py-2.5 pl-3.5 pr-11"');
  });

  it('constrains native selects to their layout column when a selected label is long', () => {
    expect(read('src/components/untitled-ui/base/select/select-native.tsx')).toContain('w-full min-w-0 max-w-full appearance-none');
  });

  it('gives select popovers a real boundary under the app-wide no-shadow contract', () => {
    expect(read('src/components/untitled-ui/base/select/popover.tsx')).toContain('border border-secondary');
  });

  it('wrapper inputs fit inside the visible touch boundary despite the universal root floor', () => {
    const css = read('src/components/untitled-ui/base/control-geometry.css');
    expect(css).toMatch(/:is\(#root, body\) \[data-uui-control='input'\] > input:not\([^}]+min-height: 0;\s*height: calc\(var\(--uui-control-h\) - 2px\)/);
    expect(css).toMatch(/:is\(#root, body\) \[data-uui-control='combobox'\] input\[role='combobox'\]:not\([^}]+min-height: 0;\s*height: auto/);
  });

  // FB-048 (2026-10-14): an invalid select/combobox must paint its danger
  // border AT REST. The old paint gated on focus/open, so a failed-validation
  // select sat on the neutral border until clicked — while native .input
  // fields and SearchableSelect already painted red. aria-invalid also feeds
  // the house QA-AUDIT-UI57 boundary paint in base.css.
  it.each([
    ['select trigger', 'src/components/untitled-ui/base/select/select.tsx', 'AriaButton', 'data-uui-control="select"'],
    ['combobox group', 'src/components/untitled-ui/base/select/combobox.tsx', 'AriaGroup', 'data-uui-control="combobox"'],
  ])('%s paints the invalid danger border at rest and exposes aria-invalid', (_label, path, _node, marker) => {
    const source = read(path);
    expect(source).toContain(marker);
    // Rest-state paint: border-error no longer keys on focus/open.
    expect(source).toMatch(/isInvalid\s*\?\s*cx\(\s*"border-error"/);
    expect(source).not.toMatch(/isInvalid && \(isFocused \|\| isOpen\)/);
    expect(source).not.toMatch(/isInvalid && isFocusWithin\s*\?\s*"border-error/);
    // Semantics for the QA-AUDIT-UI57 house paint.
    expect(source).toContain('aria-invalid={isInvalid || undefined}');
    // Error still wins over focus: no brand ring on an invalid control.
    expect(source).not.toMatch(/isInvalid[\s\S]{0,200}border-brand/);
  });

  // FB-048 (2026-10-16 re-report, card 141026003600): the pins above only
  // prove the COMPONENT emits `border-error` + `aria-invalid`. They cannot
  // prove the paint reaches the border — and they cannot fail if the danger
  // rule in base.css loses its select/combobox selectors, which would restore
  // exactly the reported defect (a neutral border at rest) with every
  // component-side pin still green. Pin the half that actually paints.
  it('the house danger paint covers the select and combobox boundaries', () => {
    const base = read('src/styles/base.css');
    // The rule that paints var(--danger) must name both UUI boundaries…
    const paint = base.match(/:is\(#root, body\)[^{]*:where\(([\s\S]*?)\)\s*\{[^}]*border-color:\s*var\(--danger\)/)?.[1] ?? '';
    expect(paint).toContain("[data-uui-control='select'][aria-invalid='true']");
    expect(paint).toContain("[data-uui-control='combobox'][aria-invalid='true']");
  });

  it('the neutral border rule never overpaints an invalid control', () => {
    // The neutral rule is the only higher-specificity competitor. It must keep
    // excluding invalid controls, or it would repaint the danger border the
    // moment focus leaves.
    const base = read('src/styles/base.css');
    const neutral = base.match(/border-color:\s*var\(--control-border\)/) ? base.slice(0, base.indexOf('border-color: var(--control-border)')) : '';
    const guard = neutral.slice(neutral.lastIndexOf(':not('));
    expect(guard).toContain("[aria-invalid='true']");
    expect(guard).toContain('.border-error');
  });
});
