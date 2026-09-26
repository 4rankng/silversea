import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { usePopoverPosition } from '../../hooks/usePopoverPosition';
import { useClickOutside } from '../../hooks/useClickOutside';
import './InlineLabelSelect.css';

/**
 * InlineLabelSelect (card 20260926_50 ribbon): a compact select whose label
 * lives INSIDE the trigger — 'Label: value ▾' — instead of a floating label
 * row. Portal listbox, flat chrome, trailing chevron. Used by the dispatch
 * ribbon (Hướng / Điều xe / Dữ liệu) and the settlement toolbar (Khóa lô).
 */

export interface InlineLabelSelectItem {
  id: string;
  label: string;
}

interface InlineLabelSelectProps {
  id: string;
  /** Prefix rendered before the colon in the trigger. */
  label: string;
  items: InlineLabelSelectItem[];
  selectedKey: string;
  onSelectionChange: (key: string) => void;
  ariaLabel: string;
  className?: string;
}

export function InlineLabelSelect({
  id,
  label,
  items,
  selectedKey,
  onSelectionChange,
  ariaLabel,
  className = '',
}: InlineLabelSelectProps) {
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(panelRef, triggerRef, true, 220, 260);
  const close = useCallback(() => setIsOpen(false), []);
  useClickOutside(panelRef, close, { escapeKey: true, additionalRefs: [triggerRef] });

  const selected = items.find((item) => item.id === selectedKey)
    ?? items[0];
  const triggerText = `${label}: ${selected?.label ?? ''}`;
  const rootClass = ['inline-label-select', className].filter(Boolean).join(' ');

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => panelRef.current?.setAttribute('data-open', 'true'));
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const panel = isOpen ? (
    <div ref={panelRef} id={listboxId} className="inline-label-select__popover" style={{ top: position?.top ?? 12, left: position?.left ?? 12 }} role="listbox" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={item.id === selectedKey}
          className="inline-label-select__option"
          data-option-id={item.id}
          onClick={() => { onSelectionChange(item.id); close(); }}
        >
          <span className="inline-label-select__check">
            {item.id === selectedKey ? <Check size={14} aria-hidden="true" /> : null}
          </span>
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={rootClass} data-component="inline-label-select">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`inline-label-select__trigger inline-label-select__trigger--sm${isOpen ? ' inline-label-select__trigger--open' : ''}`}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {triggerText}
        <ChevronDown size={14} className="inline-label-select__chevron" aria-hidden="true" />
      </button>
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
    </div>
  );
}
