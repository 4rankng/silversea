import { parseNote } from '../../../lib/dispatchTaskTags';
import './DispatchDriverNote.css';

/** Read the existing tags-first format without rewriting historical notes.
 * Unknown task labels stay visible as manual text instead of disappearing. */
export function DispatchDriverNote({ value, labels, compact = false }: {
  value: string;
  labels: readonly string[];
  compact?: boolean;
}) {
  const { selectedLabels, manualText } = parseNote(value, labels);
  return (
    <span className={`dispatch-driver-note${compact ? ' dispatch-driver-note--compact' : ''}`}>
      {selectedLabels.length > 0 && (
        <span className="dispatch-driver-note__section" data-note-section="tasks">
          <span className="dispatch-driver-note__label">Tác vụ</span>
          <span className="dispatch-driver-note__tasks">
            {selectedLabels.map((label) => label.toLocaleUpperCase('vi')).join('; ')}
          </span>
        </span>
      )}
      {manualText && (
        <span className="dispatch-driver-note__section" data-note-section="manual">
          {selectedLabels.length > 0 && <span className="dispatch-driver-note__label">Ghi chú</span>}
          <span className="dispatch-driver-note__text">
            {compact && selectedLabels.length === 0 ? `Xe: ${manualText}` : manualText}
          </span>
        </span>
      )}
    </span>
  );
}
