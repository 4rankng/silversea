import { useEffect, useState } from 'react';
import { Modal } from '../UI';
import { TripEditConflictError } from '../../hooks/tripSubmitReconcile';

interface Props {
  conflict: TripEditConflictError | null;
  submitting: boolean;
  onClose: () => void;
  onConflict: (conflict: TripEditConflictError) => void;
  onSave: (version: number, choices: Record<string, 'local' | 'server'>) => Promise<void>;
}

/** Explicit reconciliation of simultaneous edits; never an approval step. */
export function TripEditConflictDialog({ conflict, submitting, onClose, onConflict, onSave }: Props) {
  const [choices, setChoices] = useState<Record<string, 'local' | 'server'>>({});
  useEffect(() => setChoices({}), [conflict]);
  const save = async () => {
    if (!conflict) return;
    try {
      await onSave(conflict.latestVersion, choices);
      onClose();
    } catch (error) {
      if (error instanceof TripEditConflictError) onConflict(error);
      else onClose();
    }
  };
  return (
    <Modal
      isOpen={conflict !== null}
      title="Đối chiếu thay đổi"
      onClose={onClose}
      maxWidth={620}
      footer={<>
        <button type="button" className="btn btn--secondary" onClick={onClose} disabled={submitting}>Giữ bản nháp</button>
        <button type="button" className="btn btn--primary" disabled={submitting || !conflict || conflict.fields.some(field => !choices[field.key])} onClick={() => void save()}>{submitting ? 'Đang lưu…' : 'Lưu giá trị đã chọn'}</button>
      </>}
    >
      <p>Chọn giá trị cho các trường cùng được sửa. Các thay đổi ở trường khác được giữ nguyên. Nếu chuyến tiếp tục thay đổi, hệ thống sẽ kiểm tra lại trước khi lưu.</p>
      {conflict?.fields.map(field => (
        <fieldset key={field.key} className="tc-edit-conflict-field">
          <legend>{field.label}</legend>
          {(['server', 'local'] as const).map(choice => (
            <label key={choice} className="tc-edit-conflict-choice">
              <input type="radio" name={`conflict-${field.key}`} checked={choices[field.key] === choice} onChange={() => setChoices(previous => ({ ...previous, [field.key]: choice }))} />
              <span><strong>{choice === 'server' ? 'Đã lưu trên hệ thống' : 'Bản nháp của tôi'}</strong><br />{formatConflictValue(choice === 'server' ? field.latest : field.local)}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </Modal>
  );
}

function formatConflictValue(value: unknown): string {
  if (value == null || value === '') return 'Trống';
  if (Array.isArray(value)) return value.map(leg => `${leg.origin} → ${leg.destination} (${leg.km} km)`).join('; ') || 'Không có chặng';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  return String(value);
}
