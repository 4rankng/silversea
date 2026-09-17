import { useCallback, useRef, useState } from 'react';
import type { ShipmentListItem } from '../../../api/shipmentClient';

export type OperationalNoteSave = (shipment: ShipmentListItem, notes: string) => void | Promise<void>;

/** Owns one in-flight inline note edit without dropping failed drafts. */
export function useMasterPlanNoteEditor(onSave?: OperationalNoteSave) {
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [editingNotesValue, setEditingNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const noteSavePendingRef = useRef(false);
  const notesInputRef = useRef<HTMLTextAreaElement | null>(null);

  const startNotesEdit = useCallback((item: ShipmentListItem) => {
    if (noteSavePendingRef.current) return;
    setEditingNotesId(item.id);
    setEditingNotesValue(item.operationalNotes ?? '');
    setNotesError(null);
    requestAnimationFrame(() => notesInputRef.current?.focus());
  }, []);

  const cancelNotesEdit = useCallback(() => {
    if (noteSavePendingRef.current) return;
    setEditingNotesId(null);
    setEditingNotesValue('');
    setNotesError(null);
  }, []);

  const saveNotesEdit = useCallback(async (item: ShipmentListItem) => {
    if (noteSavePendingRef.current) return;
    const trimmed = editingNotesValue.trim();
    noteSavePendingRef.current = true;
    setSavingNotes(true);
    setNotesError(null);
    try {
      if (trimmed !== (item.operationalNotes ?? '')) await onSave?.(item, trimmed);
      setEditingNotesId(null);
      setEditingNotesValue('');
    } catch {
      setNotesError('Không lưu được ghi chú. Nội dung đã nhập được giữ lại, vui lòng thử lại.');
    } finally {
      noteSavePendingRef.current = false;
      setSavingNotes(false);
    }
  }, [editingNotesValue, onSave]);

  return {
    editingNotesId, editingNotesValue, setEditingNotesValue, savingNotes,
    notesError, notesInputRef, startNotesEdit, cancelNotesEdit, saveNotesEdit,
  };
}
