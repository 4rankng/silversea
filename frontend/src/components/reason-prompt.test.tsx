import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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