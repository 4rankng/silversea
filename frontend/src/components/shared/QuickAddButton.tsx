import { Plus } from 'lucide-react';
import './QuickAddButton.css';

/**
 * FB-066 — the shared "+ Thêm nhanh" trailing affordance shown beside a
 * plate/driver selector to register a new catalog row without leaving the form.
 *
 * This is the ONE shared implementation of the quick-add button the dispatch
 * editor (`dispatch-assignment-dialog__quick-add`) and the trip form
 * (`tc-field-quick-add`) each grew separately; the LCL group dialogs mount this
 * component so a third copy of the style never lands. Visual contract: a small
 * borderless accent text button with a leading Plus glyph.
 */
export function QuickAddButton({ onClick, disabled, children = 'Thêm nhanh' }: {
  onClick: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button type="button" className="quick-add-button" onClick={onClick} disabled={disabled}>
      <Plus size={14} aria-hidden="true" />
      {children}
    </button>
  );
}
