import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { REASON_MAX_LENGTH, ReasonPromptDialog, useReasonPrompt } from './reason-prompt';

function Probe({ onReason }: { onReason: (value: string | null) => void }) {
  const [isOpen, setOpen] = useState(true);
  return (
    <>
      <ReasonPromptDialog
        isOpen={isOpen}
        message="Xóa dòng phí này?"
        confirmLabel="Xóa"
        onReason={(value) => { onReason(value); setOpen(false); }}
      />
    </>
  );
}

describe('ReasonPromptDialog (card 20260922_78 Q10 contract)', () => {
  it('starts empty — no canned default reason is ever pre-seeded', () => {
    render(<Probe onReason={() => {}} />);
    expect((screen.getByLabelText('Lý do xóa (bắt buộc)') as HTMLTextAreaElement).value).toBe('');
  });

  it('blocks confirm while the reason is empty or whitespace', () => {
    const onReason = vi.fn();
    render(<Probe onReason={onReason} />);
    const confirmButton = screen.getByRole('button', { name: 'Xóa' });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Lý do xóa (bắt buộc)'), { target: { value: '   ' } });
    expect(confirmButton).toBeDisabled();
    expect(onReason).not.toHaveBeenCalled();
  });

  it('accepts a 500-char reason and delivers the trimmed value', () => {
    const onReason = vi.fn();
    render(<Probe onReason={onReason} />);
    const textarea = screen.getByLabelText('Lý do xóa (bắt buộc)');
    expect(textarea.getAttribute('maxlength')).toBe(String(REASON_MAX_LENGTH));
    fireEvent.change(textarea, { target: { value: 'L'.repeat(500) } });
    expect(screen.getByRole('button', { name: 'Xóa' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    waitFor(() => expect(onReason).toHaveBeenCalledWith('L'.repeat(500)));
  });

  it('cancel and Escape resolve null without delivering a reason', async () => {
    const onReason = vi.fn();
    render(<Probe onReason={onReason} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(onReason).toHaveBeenCalledWith(null));
    fireEvent.keyDown(window, { key: 'Escape' });
  });
});
// Card 20260923_8 group C — prompt field layout. RED-first: at HEAD the label
// and textarea are squeezed siblings of the 44px icon inside the flex-row
// .confirm-body (label wraps 4 lines, textarea ~69.7px), and the stylesheet
// below does not exist at all.
describe('prompt field layout (card 20260923_8 group C)', () => {
  it('label + textarea live in a full-width field block — never squeezed as siblings of the icon in the flex row', () => {
    render(<Probe onReason={() => {}} />);
    const label = screen.getByText('Lý do xóa (bắt buộc)');
    const block = label.closest('div');
    expect(block?.className).toContain('confirm-prompt');
    expect(block?.className).not.toContain('confirm-body');
    expect(block?.querySelector('textarea')).toBeTruthy();
    expect(document.querySelector('.confirm-body')?.querySelector('label, textarea')).toBeNull();
  });
});

describe('ReasonPrompt.css field contract (card 20260923_8 group C)', () => {
  it('label renders on one line; textarea spans the dialog width with a real minimum height', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/ReasonPrompt.css'), 'utf8');
    const label = css.match(/\.confirm-prompt__label\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(label).toContain('white-space: nowrap');
    const textarea = css.match(/\.confirm-prompt__textarea\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(textarea).toContain('width: 100%');
    expect(textarea).toMatch(/min-height:\s*84px/);
  });

  it('is imported BY the component module — rendering no longer depends on host-page css imports', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/reason-prompt.tsx'), 'utf8');
    expect(source).toContain("import './ReasonPrompt.css'");
  });
});
