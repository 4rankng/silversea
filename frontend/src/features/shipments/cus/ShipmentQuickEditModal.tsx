// Shared lot-info quick-edit modal (one editor, two hosts).
//
// Extracted verbatim from pages/ShipmentsPage.tsx (FB-086 R29 remainder,
// steer 21/10): the Tổng quan grid opened this exact modal per cell, and the
// lot detail page (/shipments/:id) now opens the same modal from its Sửa-lô
// picker. State still lives in `useCusQuickEdit` (page-injected); this file
// owns ONLY the presentation — form ref, click-outside dismiss, Enter law,
// footer buttons — so both surfaces stay DOM-identical.
//
// TICKET-09 boundary (card 171026182554): this modal edits LOT INFORMATION
// only (identity/documents/classification/cargo/schedule/notes). Container
// add/remove is deliberately NOT part of it — that composition lives solely
// in the Tổng quan drawer (CusContainerLedger).

import { Save } from 'lucide-react';
import { useRef } from 'react';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { Modal } from '../../../components/UI';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { ShipmentQuickEditFields } from './CusQuickEdit';
import { quickEditTitle, type ShipmentQuickEditDraft } from './cusUtils';

export function ShipmentQuickEditModal({
  open,
  draft,
  item,
  saving,
  error,
  onDraftChange,
  close,
  save,
}: {
  /** Both hosts gate this on "draft resolved AND its live row present". */
  open: boolean;
  draft: ShipmentQuickEditDraft | null;
  /** Live row the draft was seeded from — must carry the draft's shipmentId. */
  item: ShipmentCusWorkspaceListItem | null;
  saving: boolean;
  error: string | null;
  onDraftChange: (draft: ShipmentQuickEditDraft) => void;
  close: () => void;
  save: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Outside pointerdown / global Escape dismisses the Chứng từ quick bubble,
  // matching the ledger inline editors (72725707); paused while saving so a
  // save can't be cancelled mid-flight. The whole .modal__content (head,
  // footer buttons, form) counts as inside — a press on "Lưu thay đổi" in the
  // Modal footer sits outside the form ref and must not cancel the draft —
  // and portaled select popovers keep owning their own interaction.
  useClickOutside(formRef, () => {
    if (!saving) close();
  }, {
    escapeKey: true,
    enabled: open,
    ignoreSelector: '.modal__content, .searchable-select__popover, .searchable-select__backdrop, .react-aria-Popover, .time-picker__popup, .time-picker__overlay, .time-picker__sheet, .time-picker__inline, [data-time-picker-overlay], [data-date-picker]',
  });

  return (
    <Modal
      isOpen={open}
      title={draft ? quickEditTitle(draft.field) : 'Chỉnh sửa lô hàng'}
      onClose={close}
      maxWidth={480}
      footer={<>
        <UUIButton size="sm" color="secondary" className="cus-quick-edit-modal__action" onPress={close} isDisabled={saving}>Hủy</UUIButton>
        <UUIButton
          size="sm"
          color="primary"
          className="cus-quick-edit-modal__action"
          isLoading={saving}
          showTextWhileLoading
          onPress={() => formRef.current?.requestSubmit()}
          iconLeading={<Save size={16} aria-hidden="true" />}
        >
          Lưu thay đổi
        </UUIButton>
      </>}
    >
      {open && draft && item && (
        <form ref={formRef} className="cus-quick-edit-modal"
          aria-busy={saving}
          onSubmit={(event) => {
            event.preventDefault();
            if (!event.currentTarget.reportValidity()) return;
            save();
          }}
          onKeyDown={(event) => {
            // FB-002 (round 17): the save button lives in the modal FOOTER,
            // outside this form, so the browser's implicit submission never
            // fires for the multi-field modes (documents with tờ khai rows,
            // cargo, classification) — Enter went dead. The form answers
            // Enter itself, through the same submit path the footer button
            // rides (requestSubmit keeps constraint validation intact).
            if (event.defaultPrevented) return;
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || saving) return;
            const target = event.target as HTMLElement;
            // The segmented date/time pickers own their Enter (commit the
            // draft / close the panel) — never steal it.
            if (target.closest('[data-date-picker], .time-picker__popup, [data-time-picker-overlay]')) return;
            if (target.isContentEditable || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.closest('.searchable-select, [role="listbox"], [role="option"]')) return;
            // Multiline notes: bare Enter inserts a newline; the modified
            // combo (Ctrl/Cmd+Enter) is what saves — same law as the
            // Chi tiết lô hàng inline editor.
            if (target.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) return;
            if (event.shiftKey) return;
            event.preventDefault();
            formRef.current?.requestSubmit();
          }}
        >
          <p className="cus-quick-edit-modal__context">{item.billOrBookNumber || item.declarationNumber || item.customerName || 'Lô hàng'}</p>
          <ShipmentQuickEditFields
            draft={draft}
            item={item}
            saving={saving}
            error={error}
            onChange={onDraftChange}
          />
        </form>
      )}
    </Modal>
  );
}
