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
    'src/components/untitled-ui/base/select/multi-select.tsx',
    'src/components/untitled-ui/base/select/tag-select.tsx',
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
    expect(select).toContain('root: "py-2 pl-3 pr-10 text-sm"');
    expect(select).toContain('root: "py-2 pl-3 pr-10 text-md"');
    expect(select).toContain('root: "py-2.5 pl-3.5 pr-11 text-md"');
  });

  it('gives select popovers a real boundary under the app-wide no-shadow contract', () => {
    expect(read('src/components/untitled-ui/base/select/popover.tsx')).toContain('border border-secondary');
    expect(read('src/components/untitled-ui/base/select/multi-select.tsx')).toContain('border border-secondary');
  });
});
