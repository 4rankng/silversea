import { useState, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2, X } from 'lucide-react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { usePopoverPosition } from '../../../hooks/usePopoverPosition';
import {
  useDeactivateDispatchTaskTag,
  useDispatchTaskTags,
  useUpdateDispatchTaskTag,
} from './useDispatchTaskTags';

/**
 * Tag-pool manager for the dispatch note composer ("Ghi chú tác vụ"). Opens
 * from the pencil button next to the section label and lists the shared pool
 * with inline rename (Enter/Escape, 409 → "Tag đã tồn tại.") and two-step
 * delete confirm. Rides the house popover idiom (card 20260930_227): portal +
 * shared viewport-aware positioning + click-outside/Escape dismissal — the
 * same contract as the design-system picker surfaces — so the panel never
 * clips inside the assignment dialog. Deletion is a soft delete — historical
 * notes keep their text (parseNote degrades unmatched segments to manual
 * text), and re-adding the label later reactivates the row.
 */
export function DispatchTaskTagManagerPopover({ triggerRef, onClose, onRenamed }: {
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Lets the composer keep the current draft's chip intact across a rename. */
  onRenamed?: (oldLabel: string, nextLabel: string) => void;
}) {
  const { tags, isLoading } = useDispatchTaskTags();
  const { updateTag, isUpdating } = useUpdateDispatchTaskTag();
  const { deactivateTag, isDeactivating } = useDeactivateDispatchTaskTag();

  const popoverRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);

  useClickOutside(popoverRef, onClose, {
    escapeKey: true,
    enabled: true,
    additionalRefs: [triggerRef],
  });

  // Viewport-aware positioning relative to the trigger — the shared hook
  // (CusAppointmentPopover lineage) flips above when space is tight, clamps
  // to the viewport and re-measures on resize/scroll/trigger move.
  const position = usePopoverPosition(popoverRef, triggerRef, true, 280, 300);

  function beginRename(tag: { id: number; label: string }) {
    setEditingId(tag.id);
    setDraftLabel(tag.label);
    setDeletingId(null);
    setRowNotice(null);
  }

  function cancelRename() {
    setEditingId(null);
    setDraftLabel('');
    setRowNotice(null);
  }

  async function saveRename() {
    const next = draftLabel.trim();
    if (!next || editingId == null || isUpdating) return;
    try {
      await updateTag({ id: editingId, label: next });
      const original = tags.find((tag) => tag.id === editingId);
      if (original && original.label !== next) onRenamed?.(original.label, next);
      setEditingId(null);
      setRowNotice(null);
    } catch (submitError) {
      const status = (submitError as { status?: number }).status;
      if (status === 409) {
        setRowNotice('Tag đã tồn tại.');
      } else {
        setRowNotice('Không thể đổi tên tag. Vui lòng thử lại.');
      }
    }
  }

  function beginDelete(tag: { id: number; label: string }) {
    setDeletingId(tag.id);
    setEditingId(null);
    setRowNotice(null);
  }

  async function confirmDelete() {
    if (deletingId == null || isDeactivating) return;
    try {
      await deactivateTag(deletingId);
      setDeletingId(null);
      setRowNotice(null);
      // Invalidation refreshes the pool for every open modal; the deleted
      // tag drops from this list and from the composer's chip row.
    } catch {
      setRowNotice('Không thể xóa tag. Vui lòng thử lại.');
    }
  }

  if (isLoading) {
    return null;
  }

  const popoverElement = (
    <div
      ref={popoverRef}
      className="dispatch-tag-manager"
      style={position ? {
        top: `${position.top}px`,
        left: `${position.left}px`,
      } : undefined}
      role="dialog"
      aria-label="Quản lý tag"
      data-escape-boundary="true"
      onKeyDown={(event) => {
        // The panel owns its Escape (DatePickerSurface contract): consume it
        // here so the hosting assignment dialog never closes underneath.
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
        <div className="dispatch-tag-manager__header">
          <strong>Quản lý tag</strong>
          <span className="dispatch-tag-manager__count">{tags.length}</span>
          <button
            type="button"
            className="dispatch-tag-manager__close"
            onClick={onClose}
            aria-label="Đóng bảng quản lý tag"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {tags.length === 0 ? (
          <p className="dispatch-tag-manager__empty">Chưa có tag nào.</p>
        ) : (
          <div className="dispatch-tag-manager__list">
            {tags.map((tag) => {
              const isEditing = editingId === tag.id;
              const isConfirming = deletingId === tag.id;
              return (
                <div className="dispatch-tag-manager__row" key={tag.id}>
                  {isEditing ? (
                    <div className="dispatch-tag-manager__edit-row">
                      <input
                        aria-label="Tên tag"
                        value={draftLabel}
                        onChange={(e) => { setDraftLabel(e.target.value); setRowNotice(null); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void saveRename(); }
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); }
                        }}
                        disabled={isUpdating}
                        autoFocus
                      />
                      <button type="button" onClick={() => void saveRename()} disabled={isUpdating || !draftLabel.trim()}>
                        Lưu
                      </button>
                      <button type="button" onClick={cancelRename} disabled={isUpdating}>
                        Hủy
                      </button>
                    </div>
                  ) : isConfirming ? (
                    <div className="dispatch-tag-manager__confirm">
                      <span>Xóa tag này?</span>
                    <button type="button" className="dispatch-tag-manager__confirm-yes" onClick={() => void confirmDelete()} disabled={isDeactivating}>
                        Xóa
                      </button>
                      <button type="button" onClick={() => setDeletingId(null)} disabled={isDeactivating}>
                        Hủy
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="dispatch-tag-manager__label">{tag.label}</span>
                      <span className="dispatch-tag-manager__row-actions">
                        <button
                          type="button"
                          className="dispatch-tag-manager__icon-btn"
                          aria-label={`Đổi tên tag ${tag.label}`}
                          onClick={() => beginRename(tag)}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="dispatch-tag-manager__icon-btn dispatch-tag-manager__icon-btn--danger"
                          aria-label={`Xóa tag ${tag.label}`}
                          onClick={() => beginDelete(tag)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {rowNotice && <p className="dispatch-tag-manager__notice" role="status">{rowNotice}</p>}
        <div className="dispatch-tag-manager__footer">
          <span>Xóa tag chỉ ẩn tag khỏi danh sách; ghi chú cũ giữ nguyên nội dung.</span>
          <span>Bấm ra ngoài để đóng</span>
        </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(popoverElement, document.body);
  }
  return popoverElement;
}
