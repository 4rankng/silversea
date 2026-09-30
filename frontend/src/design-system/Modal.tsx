import React, { createContext, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { animate, utils } from 'animejs';
import { isTopOverlayToken, useAnimatedOverlay, type EntranceFn, type ExitFn } from '../hooks/useAnimatedOverlay';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Tooltip } from '../components/shared/Tooltip';
import { currentPathname, hasOperationalDensity } from '../lib/operational-density';
import { usePortalTarget } from './hooks/usePortalTarget';
import { useScrollLock } from './hooks/useScrollLock';

/**
 * The one modal module (card 20260930_227).
 *
 * Owns the full overlay contract for every dialog in the app: portal to
 * document.body, scrim, backdrop dismissal, Escape (with nested-picker
 * deference), Enter-to-confirm, focus trap + focus return to the opener,
 * body scroll lock, overlay stacking (topmost overlay owns the dismissal
 * keys), header/close/body/footer chrome and size.
 *
 * Anatomy follows the Untitled UI PRO modals reference (consulted 2026-09-30:
 * `ModalOverlay` + `Modal` + `Dialog` + `CloseButton`, React Aria underneath,
 * `isDismissable` gating backdrop/Escape). The vendored install ships no
 * overlay component, so this module implements that contract on the house
 * hooks stack (useAnimatedOverlay / useFocusTrap) instead of installing one.
 *
 * Two chrome modes:
 *  - 'house' (default) — this module renders the shared `.modal__*` chrome
 *    (eyebrow/title/header-right/close, body, footer) and the caller passes
 *    content. The 30+ dialogs importing `Modal` from components/UI ride this.
 *  - 'bare' — the module renders the overlay mechanics only and the children
 *    own the whole dialog surface (the ops shell skin, positioned dispatch
 *    panels). Bare overlays default `backdropDismiss` to false: their hosts
 *    are usually editable forms where an accidental scrim click must not
 *    discard work.
 */

/* Polished-modal compact context. */
export const ModalCompactContext = createContext(false);

/* ─── Shared overlay animation defaults ──────────────────────────────────── */

const overlayEntrance: EntranceFn = (overlay, content, prefersReduced) => {
  if (prefersReduced) {
    utils.set(overlay, { opacity: 1 });
    utils.set(content, { opacity: 1 });
    return;
  }
  utils.set(overlay, { opacity: 0 });
  animate(overlay, { opacity: [0, 1], duration: 180, ease: 'out(2)' });
  utils.set(content, { opacity: 0, willChange: 'opacity' });
  animate(content, {
    opacity: [0, 1],
    duration: 180,
    ease: 'out(2)',
  });
};

const overlayExit: ExitFn = (overlay, content, onDone) => {
  animate(overlay, { opacity: [1, 0], duration: 160, ease: 'in(2)' });
  animate(content, {
    opacity: [1, 0],
    duration: 160,
    ease: 'in(3)',
    onComplete: onDone,
  });
};

/* Bare overlays have no module-owned content node, so the overlay itself is
 * the animation target. A single animate() per phase — never two handles on
 * the same element/property (see the Drawer cancel-note in UI.tsx). */
const bareEntrance: EntranceFn = (overlay, _content, prefersReduced) => {
  if (prefersReduced) {
    utils.set(overlay, { opacity: 1 });
    return;
  }
  utils.set(overlay, { opacity: 0 });
  animate(overlay, { opacity: [0, 1], duration: 180, ease: 'out(2)' });
};

const bareExit: ExitFn = (overlay, _content, onDone) => {
  animate(overlay, { opacity: [1, 0], duration: 160, ease: 'in(2)', onComplete: onDone });
};

/* ─── Global confirm shortcuts ──────────────────────────────────────────────
 * Canonical keyboard pattern for any dialog/modal/drawer that asks the user
 * to confirm or cancel something:
 *   - Enter  → triggers the primary/confirm action (if provided)
 *   - Escape → triggers the cancel/close action
 *
 * Used by Modal (here), Drawer and ConfirmDialog (components/UI). Exported so
 * any one-off custom dialog elsewhere in the app can opt in.
 *
 * Listener is only attached while `isOpen` is true. Enter is suppressed when
 * focus is inside a <textarea> or contenteditable element so multi-line
 * editing still works naturally.
 *
 * Escape defers to a nested picker: React Aria comboboxes/date pickers keep
 * DOM focus on their trigger while a portalled list is open and may not mark
 * their Escape consumed by the time this window-level listener runs, so a
 * capture pass records those presses and the dialog underneath survives its
 * picker's own dismissal key.
 * -------------------------------------------------------------------------- */

export function useConfirmShortcuts(opts: {
  isOpen: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  overlayToken?: number | null;
}) {
  const { isOpen, onConfirm, onCancel, overlayToken } = opts;
  React.useEffect(() => {
    if (!isOpen) return;
    const pickerEscapes = new WeakSet<KeyboardEvent>();
    const capturePickerKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !(event.target instanceof Element)) return;
      if (event.target.closest('[aria-expanded="true"][aria-haspopup], [role="combobox"][aria-expanded="true"]')) {
        pickerEscapes.add(event);
      }
    };
    const handler = (e: KeyboardEvent) => {
      // Nested controls (including React Aria comboboxes) consume selection
      // and dismissal keys before this window-level form shortcut runs.
      if (e.defaultPrevented || pickerEscapes.has(e)) return;
      if (overlayToken != null && !isTopOverlayToken(overlayToken)) return;
      if (e.key === 'Escape' && onCancel) {
        // _34: inner surfaces (appointment popover) own their own Escape —
        // the window-level shortcut must not close the whole drawer too.
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('[data-escape-boundary]')) return;
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter' && onConfirm) {
        const target = e.target as HTMLElement | null;
        if (e.shiftKey || e.isComposing) return;
        if (target) {
          const tag = target.tagName;
          if (tag === 'TEXTAREA') return;
          if (target.isContentEditable) return;
          if (tag === 'BUTTON') return;
        }
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', capturePickerKey, true);
    window.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', capturePickerKey, true);
      window.removeEventListener('keydown', handler);
    };
  }, [isOpen, onConfirm, onCancel, overlayToken]);
}

/* ─── Modal chips (status badges for polished dialogs) ──────────────────── */

export function ModalChip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`modal__chip ${className}`}>{children}</span>;
}

export function ModalChipLive({ children }: { children: React.ReactNode }) {
  return (
    <span className="modal__chip modal__chip--live">
      <span className="modal__chip-dot" />
      {children}
    </span>
  );
}

export function ModalChipGhost({ children }: { children: React.ReactNode }) {
  return <span className="modal__chip modal__chip--ghost">{children}</span>;
}

/* ─── Modal ─────────────────────────────────────────────────────────────── */

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Dialog title (house chrome headings + the default accessible name). */
  title: string;
  footer?: React.ReactNode;
  onConfirm?: () => void;
  maxWidth?: number | string;
  /** Eyebrow text displayed above the title (polished variant). */
  subtitle?: string;
  /** Right-aligned slot in the header — typically status chips. */
  headerRight?: React.ReactNode;
  /** Enable the polished visual treatment (corner accents, gradient, eyebrow). */
  polished?: boolean;
  /** Explicit accessible dialog name. Needed when `title` is a display name
   * (e.g. the entity's own name) so the dialog still announces the action.
   * Required for bare overlays — their children own the visible chrome, so
   * the module cannot derive a name from markup. */
  ariaLabel?: string;
  /** Id of the element that describes the dialog (aria-describedby). */
  ariaDescribedBy?: string;
  /** 'house' renders the shared chrome; 'bare' renders mechanics only. */
  chrome?: 'house' | 'bare';
  /** Whether a scrim click dismisses the dialog. House dialogs default to
   * true; bare overlays default to false (editable-form hosts). */
  backdropDismiss?: boolean;
}

export function Modal({
  isOpen,
  title,
  onClose,
  children,
  footer,
  onConfirm,
  maxWidth = 480,
  subtitle,
  headerRight,
  polished,
  ariaLabel,
  ariaDescribedBy,
  chrome = 'house',
  backdropDismiss,
}: ModalProps) {
  const bare = chrome === 'bare';
  const scrimDismisses = backdropDismiss ?? !bare;
  const titleId = useId();
  const portalTarget = usePortalTarget();
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const { visible, handleClose, overlayToken } = useAnimatedOverlay({
    overlayRef,
    // Bare mode has no module-owned content node; the overlay is the animation
    // target and the bare entrance/exit callbacks animate it exactly once.
    contentRef: bare ? overlayRef : contentRef,
    isOpen,
    onClose,
    entrance: bare ? bareEntrance : overlayEntrance,
    exit: bare ? bareExit : overlayExit,
  });

  // useAnimatedOverlay returns focus on the isOpen→false transition. A dialog
  // that unmounts while still open (route change, parent conditional) owes the
  // opener the same restoration — the module owns focus return in both paths.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!visible) return;
    if (openerRef.current == null) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [visible]);
  // The close path consumed the opener (useAnimatedOverlay restored it) —
  // drop it so a later unmount never yanks focus back to a long-gone trigger.
  useEffect(() => {
    if (!visible) openerRef.current = null;
  }, [visible]);
  useEffect(() => {
    return () => {
      if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
    };
  }, []);

  useConfirmShortcuts({ isOpen, onConfirm, onCancel: onClose, overlayToken });
  useScrollLock(visible);
  useFocusTrap(bare ? overlayRef : contentRef, bare ? visible : visible && isOpen);

  if (!portalTarget) return null;

  // Forward maxWidth via CSS variable so mobile overrides (max-width: 100%) win.
  const cssVars = { '--modal-max-w': typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth } as React.CSSProperties;
  const densityClass = hasOperationalDensity(currentPathname()) ? ' modal--operational-density' : '';
  const polishedClass = polished ? ' modal--polished' : '';
  const bareClass = bare ? ' modal--bare' : '';
  return createPortal(
    visible ? (
      <div
        ref={overlayRef}
        className={`modal${bareClass}${densityClass}${polishedClass}`}
        onClick={scrimDismisses
          ? (event) => {
            // Self-hit only: clicks that bubble up from the dialog (or from a
            // child portalled elsewhere) must never read as a scrim hit.
            if (event.target === overlayRef.current) handleClose();
          }
          : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={bare || ariaLabel ? undefined : titleId}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
      >
        {bare ? children : (
          <div
            ref={contentRef}
            className="modal__content"
            style={cssVars}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <div>
                {subtitle && <p className="modal__eyebrow">{subtitle}</p>}
                <h3 id={titleId} className="modal__title">{title}</h3>
              </div>
              {headerRight && <div className="modal__head-right">{headerRight}</div>}
              <Tooltip label="Đóng (Esc)" side="bottom">
                <button
                  className="btn btn--ghost btn--icon btn--sm modal__close"
                  onClick={handleClose}
                  aria-label="Đóng"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
            <div className="modal__body">
              <ModalCompactContext.Provider value={Boolean(polished)}>
                {children}
              </ModalCompactContext.Provider>
            </div>
            {footer && (
              <div className="modal__foot">
                {footer}
              </div>
            )}
          </div>
        )}
      </div>
    ) : null,
    portalTarget,
  );
}
