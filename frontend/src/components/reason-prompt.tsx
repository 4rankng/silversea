import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { animate, spring, utils } from 'animejs';
import { useAnimatedOverlay, type EntranceFn, type ExitFn } from '../hooks/useAnimatedOverlay';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './ReasonPrompt.css';

const entrance: EntranceFn = (overlay, content, prefersReduced) => {
  if (prefersReduced) {
    utils.set(overlay, { opacity: 1 });
    utils.set(content, { opacity: 1, scale: 1 });
    return;
  }
  utils.set(overlay, { opacity: 0 });
  animate(overlay, { opacity: [0, 1], duration: 180, ease: 'out(2)' });
  animate(content, { opacity: [0, 1], scale: [0.92, 1], duration: 350, ease: spring({ stiffness: 320, damping: 22 }) });
};

const exit: ExitFn = (overlay, content, onDone) => {
  animate(overlay, { opacity: [1, 0], duration: 160, ease: 'in(2)' });
  animate(content, { opacity: [1, 0], scale: [1, 0.92], duration: 200, ease: 'in(3)', onComplete: onDone });
};

export const REASON_MAX_LENGTH = 500;

interface ReasonPromptDialogProps {
  isOpen: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onReason: (reason: string | null) => void;
}

/** Q10 governed-delete prompt (card 20260922_78): the reason is free text —
 *  the field starts EMPTY (no canned constants), Confirm stays disabled while
 *  the trimmed input is empty, and the 500-char cap matches the backend zod. */
export function ReasonPromptDialog({
  isOpen, message, confirmLabel = 'Xác nhận', cancelLabel = 'Hủy', onReason,
}: ReasonPromptDialogProps) {
  const portalTarget = typeof document === 'undefined' ? null : document.body;
  const messageId = useId();
  const inputId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('');
  // A freshly opened prompt always starts empty — never pre-seeded.
  useEffect(() => {
    if (isOpen) setReason('');
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onReason(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onReason]);
  const { visible, handleClose } = useAnimatedOverlay({
    overlayRef, contentRef: boxRef, isOpen, onClose: () => onReason(null), entrance, exit,
  });
  useFocusTrap(boxRef, visible && isOpen);
  if (!portalTarget) return null;
  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onReason(trimmed);
  };
  return createPortal(visible ? (
    <div ref={overlayRef} className="confirm-overlay" onClick={handleClose}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label="Nhập lý do"
        aria-describedby={messageId}
        className="confirm-box"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-body">
          <div className="confirm-icon confirm-icon--danger"><AlertTriangle size={22} color="var(--danger)" /></div>
          <p id={messageId} className="confirm-message">{message}</p>
        </div>
        <div className="confirm-prompt">
          <label className="confirm-prompt__label" htmlFor={inputId}>Lý do xóa (bắt buộc)</label>
          <textarea
            id={inputId}
            className="confirm-prompt__textarea"
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            autoFocus
          />
        </div>
        <div className="confirm-actions">
          <button className="btn btn--secondary btn--sm" onClick={() => onReason(null)}>{cancelLabel}</button>
          <button
            className="btn btn--danger btn--sm"
            onClick={submit}
            disabled={!reason.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null, portalTarget);
}

interface ReasonPromptOptions {
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ReasonPromptState extends ReasonPromptOptions {
  isOpen: boolean;
  message: string;
  resolve: (value: string | null) => void;
}

export function useReasonPrompt() {
  const [state, setState] = useState<ReasonPromptState | null>(null);
  const prompt = (message: string, options?: ReasonPromptOptions): Promise<string | null> => (
    new Promise((resolve) => setState({ message, resolve, ...options, isOpen: true }))
  );
  const settle = (value: string | null) => {
    if (!state?.isOpen) return;
    state.resolve(value);
    setState({ ...state, isOpen: false });
  };
  // Retain message/options through the exit animation.
  const dialog = state
    ? <ReasonPromptDialog isOpen={state.isOpen} message={state.message} confirmLabel={state.confirmLabel} cancelLabel={state.cancelLabel} onReason={(value) => settle(value)} />
    : null;
  return { prompt, dialog };
}
