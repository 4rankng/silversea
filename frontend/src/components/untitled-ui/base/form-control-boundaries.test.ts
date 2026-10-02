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
});
