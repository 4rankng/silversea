import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { composeNote, parseNote, normalizeNote } from '../../../lib/dispatchTaskTags';
import { useCreateDispatchTaskTag, useDispatchTaskTags } from './useDispatchTaskTags';
import { DispatchDriverNote } from './DispatchDriverNote';
import { DispatchTaskTagManagerPopover } from './DispatchTaskTagManagerPopover';

/** Quick-select tag composer for the dispatch edit modal's driver note
 *  ("Ghi chú tác vụ"). Controlled: the parent draft holds the composed note
 *  string; chips and the free-text box derive from it via parse and re-emit a
 *  fresh composition on every interaction. Two clearly separated sections —
 *  tag chips ("Ghi chú tác vụ") and the typed note ("Ghi chú thêm", its own
 *  label + box) — so typed text is never mistaken for a task tag; both still
 *  join into the one stored note (tags first, then text). The inline
 *  "+ Thêm tag" input posts to the shared pool; a duplicate
 *  (case/diacritics-insensitive) surfaces as 409 and auto-selects the
 *  existing chip instead of blocking. The pencil button opens the
 *  "Quản lý tag" popover to rename or soft-delete pool tags.
 */
export function DispatchTaskTagEditor({ value, onChange, disabled = false }: {
  value: string | null;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { tags, error } = useDispatchTaskTags();
  const { createTag, invalidateTags, isCreating } = useCreateDispatchTaskTag();
  // Preserve the active input draft through parent renders. The composer
  // keeps whitespace while typing; normalization is an explicit blur/save
  // boundary so drivers' multiword instructions never fuse together.
  const [manualDraft, setManualDraft] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [isManaging, setIsManaging] = useState(false);
  const manageButtonRef = useRef<HTMLButtonElement>(null);
  const lastValueRef = useRef(value);
  // A dialog reopen clears the stored note (null/'') — drop the raw draft
  // then, but never while the parent value is merely still empty.
  useEffect(() => {
    if ((value ?? '') === '' && (lastValueRef.current ?? '') !== '') setManualDraft(null);
    lastValueRef.current = value;
  }, [value]);

  /** A pool rename keeps the current draft intact: re-parse with the OLD
   *  label set, swap the chip's label, re-compose. Manual text untouched. */
  function handleRenamed(oldLabel: string, nextLabel: string) {
    const labels = tags.map((tag) => tag.label);
    const { selectedLabels, manualText } = parseNote(value, labels);
    const swapped = selectedLabels.map((item) => (item === oldLabel ? nextLabel : item));
    onChange(composeNote(swapped, manualText));
  }

  const labels = tags.map((tag) => tag.label);
  const { selectedLabels, manualText } = parseNote(value, labels);

  function toggleTag(label: string) {
    const next = selectedLabels.includes(label)
      ? selectedLabels.filter((item) => item !== label)
      : [...selectedLabels, label];
    onChange(composeNote(next, manualText));
  }

  function setManual(nextManual: string) {
    onChange(composeNote(selectedLabels, nextManual));
  }

  async function submitNewTag() {
    const label = newLabel.trim();
    if (!label || isCreating) return;
    try {
      await createTag(label);
      onChange(composeNote([...selectedLabels, label], manualText));
      setNewLabel('');
      setIsAdding(false);
      setAddNotice(null);
    } catch (submitError) {
      const status = (submitError as { status?: number }).status;
      if (status === 409) {
        // The pool already holds this label in some casing — select it and
        // continue instead of blocking the dispatcher.
        const normalized = label.normalize('NFC').toLowerCase().trim();
        const existing = labels.find((item) => item.normalize('NFC').toLowerCase().trim() === normalized);
        if (existing) {
          onChange(composeNote([...selectedLabels, existing], manualText));
          setNewLabel('');
          setIsAdding(false);
          setAddNotice('Tag đã tồn tại — đã chọn tag có sẵn.');
        } else {
          // Server knows the label but the local pool doesn't (another
          // dispatcher just added it): refresh the pool and keep the input.
          void invalidateTags();
          setAddNotice('Tag đã tồn tại — đã tải lại danh sách, hãy chọn lại.');
        }
      } else {
        setAddNotice('Không thể thêm tag. Vui lòng thử lại.');
      }
    }
  }

  return (
    <div className="dispatch-assignment-dialog__notes">
      <div className="dispatch-assignment-dialog__notes-header">
        <span className="dispatch-assignment-dialog__notes-label" id="dispatch-task-tags-label">Ghi chú tác vụ</span>
        <button
          type="button"
          ref={manageButtonRef}
          className="dispatch-assignment-dialog__notes-manage-btn"
          aria-label="Quản lý tag"
          title="Quản lý tag"
          onClick={() => setIsManaging(true)}
          disabled={disabled}
        >
          <Pencil size={12} aria-hidden="true" />
        </button>
      </div>
      {error
        ? <p className="dispatch-assignment-dialog__notes-preview" role="alert">Không tải được danh sách tag.</p>
        : (
          <>
            <div className="dispatch-assignment-dialog__notes-tags" role="group" aria-labelledby="dispatch-task-tags-label">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className={`dispatch-assignment-dialog__notes-tag${selectedLabels.includes(tag.label) ? ' is-selected' : ''}`}
                  aria-pressed={selectedLabels.includes(tag.label)}
                  onClick={() => toggleTag(tag.label)}
                  disabled={disabled}
                >
                  {tag.label}
                </button>
              ))}
              {isAdding ? (
                <span className="dispatch-assignment-dialog__notes-add-row">
                  <input
                    aria-label="Tên tag mới"
                    placeholder="Tên tag mới…"
                    value={newLabel}
                    onChange={(event) => { setNewLabel(event.target.value); setAddNotice(null); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitNewTag(); } }}
                    disabled={disabled || isCreating}
                    autoFocus
                  />
                  <button type="button" onClick={() => void submitNewTag()} disabled={disabled || isCreating || newLabel.trim() === ''}>
                    Lưu
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="dispatch-assignment-dialog__notes-tag dispatch-assignment-dialog__notes-tag--add"
                  aria-label="Thêm tag mới vào danh sách"
                  onClick={() => setIsAdding(true)}
                  disabled={disabled}
                >
                  + Thêm tag
                </button>
              )}
            </div>
            {addNotice && <p className="dispatch-assignment-dialog__notes-preview" role="status">{addNotice}</p>}
            {isManaging && (
              <DispatchTaskTagManagerPopover
                triggerRef={manageButtonRef}
                onClose={() => setIsManaging(false)}
                onRenamed={handleRenamed}
              />
            )}
            <div className="dispatch-assignment-dialog__notes-manual">
              <label className="dispatch-assignment-dialog__notes-label" htmlFor="dispatch-task-note-text">Ghi chú thêm</label>
              <textarea
                id="dispatch-task-note-text"
                className="dispatch-assignment-dialog__notes-text"
                placeholder="Nhập ghi chú cho lái xe…"
                value={manualDraft ?? manualText}
                onChange={(event) => { setManualDraft(event.target.value); setManual(event.target.value); }}
                onBlur={() => {
                  setManualDraft(null);
                  if (value) {
                    const normalized = normalizeNote(value);
                    if (normalized !== value) onChange(normalized);
                  }
                }}
                disabled={disabled}
              />
            </div>
            {value !== null && value !== '' && (
              <div className="dispatch-assignment-dialog__notes-preview" aria-label="Xem trước ghi chú lái xe">
                <DispatchDriverNote value={value} labels={labels} />
              </div>
            )}
          </>
        )}
    </div>
  );
}
