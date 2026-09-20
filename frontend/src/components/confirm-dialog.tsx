import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { animate, spring, utils } from 'animejs';
import { useAnimatedOverlay, type EntranceFn, type ExitFn } from '../hooks/useAnimatedOverlay';
import { useFocusTrap } from '../hooks/useFocusTrap';

const entrance: EntranceFn = (overlay, content, prefersReduced) => {
  if (prefersReduced) {
    utils.set(overlay, { opacity: 1 });
    utils.set(content, { opacity: 1, scale: 1 });
    return;
  }
  utils.set(overlay, { opacity: 0 });
  animate(overlay, { opacity: [0, 1], duration: 180, ease: 'out(2)' });
  utils.set(content, { opacity: 0, scale: 0.92, willChange: 'opacity, transform' });
  animate(content, { opacity: [0, 1], scale: [0.92, 1], duration: 350, ease: spring({ stiffness: 320, damping: 22 }) });
};

const exit: ExitFn = (overlay, content, onDone) => {
  animate(overlay, { opacity: [1, 0], duration: 160, ease: 'in(2)' });
  animate(content, { opacity: [1, 0], scale: [1, 0.92], duration: 200, ease: 'in(3)', onComplete: onDone });
};

interface ConfirmDialogProps {
  isOpen: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ isOpen, message, confirmLabel = 'Xác nhận', cancelLabel = 'Hủy', variant = 'primary', onConfirm, onCancel }: ConfirmDialogProps) {
  const portalTarget = typeof document === 'undefined' ? null : document.body;
  const messageId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onCancel]);
  const { visible, handleClose } = useAnimatedOverlay({ overlayRef, contentRef: boxRef, isOpen, onClose: onCancel, entrance, exit });
  // Enter activates the focused native button. A window-level shortcut would
  // also confirm when the user explicitly activates Cancel with the keyboard.
  useFocusTrap(boxRef, visible && isOpen);
  if (!portalTarget) return null;
  const Icon = variant === 'danger' || variant === 'warning' ? AlertTriangle : HelpCircle;
  const iconColor = variant === 'danger' ? 'var(--danger)' : variant === 'warning' ? 'var(--warning)' : 'var(--accent)';
  const iconBg = variant === 'danger' ? 'confirm-icon--danger' : variant === 'warning' ? 'confirm-icon--warning' : 'confirm-icon--primary';
  return createPortal(visible ? (
    <div ref={overlayRef} className="confirm-overlay" onClick={handleClose}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-label="Xác nhận thao tác" aria-describedby={messageId} className="confirm-box" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-body">
          <div className={`confirm-icon ${iconBg}`}><Icon size={22} color={iconColor} /></div>
          <p id={messageId} className="confirm-message">{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="btn btn--secondary btn--sm" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn btn--${variant === 'danger' ? 'danger' : 'primary'} btn--sm`} onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </div>
  ) : null, portalTarget);
}

interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'warning';
}

interface ConfirmState extends ConfirmOptions {
  message: string;
  resolve: (value: boolean) => void;
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const confirm = (message: string, options?: ConfirmOptions): Promise<boolean> => new Promise((resolve) => setState({ message, resolve, ...options }));
  const handleConfirm = () => { state?.resolve(true); setState(null); };
  const handleCancel = () => { state?.resolve(false); setState(null); };
  const dialog = state ? <ConfirmDialog isOpen message={state.message} confirmLabel={state.confirmLabel} cancelLabel={state.cancelLabel} variant={state.variant} onConfirm={handleConfirm} onCancel={handleCancel} /> : null;
  return { confirm, dialog };
}
