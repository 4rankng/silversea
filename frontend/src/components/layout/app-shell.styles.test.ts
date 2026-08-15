import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/layout/app-shell.css'), 'utf8');

describe('app shell scrolling', () => {
  it('lets a page whose content height changes, such as the LCL shipment form, scroll within the fixed shell', () => {
    expect(css).toMatch(/\.app-body,[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/);
  });
});
