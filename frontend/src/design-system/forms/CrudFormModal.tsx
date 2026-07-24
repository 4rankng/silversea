import { useEffect, useState, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, Loader2 } from 'lucide-react';
import './CrudFormModal.css';

export interface CrudFormModalProps<T extends Record<string, unknown>> {
  isOpen: boolean;
  saving?: boolean;
  title: string;
  initial: T;
  onSave: (data: T) => void;
  onCancel: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  maxWidth?: number;
  /** Render-prop: receives current form state and a `set` updater. */
  children: (form: T, set: <K extends keyof T>(key: K, value: T[K]) => void) => ReactNode;
}

/**
 * Generic modal-form primitive that consolidates the 6+ near-identical
 * pattern that lived in:
 *   - FleetPage's TruckFormModal / DriverFormModal / TrailerFormModal
 *   - CustomersPage's CustomersFormModal
 *   - ConfigPage's per-endpoint modals
 *   - CrudTable's renderForm callback
 *
 * Owns: local form state, re-init on open, footer buttons, Enter to submit.
 * The body is a render-prop so each domain keeps full control over its
 * fields without this primitive needing to know about them.
 */
export function CrudFormModal<T extends Record<string, unknown>>({
  isOpen,
  saving = false,
  title,
  initial,
  onSave,
  onCancel,
  submitLabel = 'Lưu',
  cancelLabel = 'Hủy',
  maxWidth = 540,
  children,
}: CrudFormModalProps<T>) {
  const [form, setForm] = useState<T>(initial);
  const lastOpenId = useRef<symbol | null>(null);

  // Reset the form when the modal opens with a different entity
  useEffect(() => {
    if (!isOpen) return;
    setForm(initial);
    lastOpenId.current = Symbol('open');
  }, [isOpen, initial]);

  const set = useRef<<K extends keyof T>(key: K, value: T[K]) => void>((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }).current;

  // Enter submits (when focus is in a textarea/contenteditable, defer to default)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      if (!saving) onSave(form);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, form, saving, onSave]);

  if (!isOpen) return null;

  return createPortal(
    <div className="ds-crud-overlay" onClick={saving ? undefined : onCancel} role="presentation">
      <div
        className="ds-crud-modal"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="ds-crud-modal__head">
          <h3 className="ds-crud-modal__title">{title}</h3>
          <button
            className="ds-crud-modal__close"
            onClick={onCancel}
            disabled={saving}
            aria-label="Đóng"
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <div className="ds-crud-modal__body">
          {children(form, set)}
        </div>
        <div className="ds-crud-modal__foot">
          <button
            className="btn btn--ghost btn--sm"
            onClick={onCancel}
            disabled={saving}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => onSave(form)}
            disabled={saving}
            type="button"
          >
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
