import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, 'DispatchPlanEditorCell.css'), 'utf8');

describe('UI-CD-10 dispatch task tag touch targets', () => {
  it('gives task chips and their management actions a coarse-pointer touch floor', () => {
    const block = css.slice(css.lastIndexOf('@media (pointer: coarse)'));
    for (const selector of [
      '.dispatch-assignment-dialog__notes-tag',
      '.dispatch-assignment-dialog__notes-manage-btn',
      '.dispatch-assignment-dialog__notes-add-row input',
      '.dispatch-assignment-dialog__notes-add-row button',
      '.dispatch-tag-manager button',
      '.dispatch-tag-manager input',
    ]) expect(block).toContain(selector);
    expect(block).toContain('min-height: var(--control-touch-h, 44px)');
    expect(block).toContain('min-width: var(--control-touch-h, 44px)');
  });
});
