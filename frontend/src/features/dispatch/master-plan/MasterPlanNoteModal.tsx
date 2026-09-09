import { useCallback, useState } from 'react';
import { Check, Copy, Edit3 } from 'lucide-react';
import type { ShipmentListItem } from '../../../api/shipmentClient';
import { Modal } from '../../../components/UI';

export const MAX_NOTE_LENGTH = 60;

export function isNoteLong(text: string | null | undefined, maxLen = MAX_NOTE_LENGTH): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length > maxLen) return true;
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  return lines.length > 1;
}

export function truncateNote(text: string, maxLen = MAX_NOTE_LENGTH): string {
  const trimmed = text.trim();
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? trimmed;
  if (firstLine.length > maxLen) {
    return `${firstLine.slice(0, maxLen).trim()}…`;
  }
  if (trimmed.length > firstLine.length) {
    return `${firstLine}…`;
  }
  return trimmed;
}

export interface ActiveNoteDetail {
  title: string;
  note: string;
  shipmentCode?: string | null;
  customerName?: string | null;
  blNumber?: string | null;
  isOperational?: boolean;
  shipment?: ShipmentListItem;
}

interface MasterPlanNoteModalProps {
  activeNote: ActiveNoteDetail | null;
  onClose: () => void;
  onEditOperationalNote?: (shipment: ShipmentListItem) => void;
}

export function MasterPlanNoteModal({ activeNote, onClose, onEditOperationalNote }: MasterPlanNoteModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!activeNote?.note) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(activeNote.note).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = activeNote.note;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(textarea);
      }
    }
  }, [activeNote]);

  if (!activeNote) return null;

  return (
    <Modal
      isOpen={Boolean(activeNote)}
      title={activeNote.title}
      subtitle={[
        activeNote.customerName,
        activeNote.blNumber ? `BL: ${activeNote.blNumber}` : activeNote.shipmentCode,
      ].filter(Boolean).join(' · ')}
      onClose={() => {
        setCopied(false);
        onClose();
      }}
      maxWidth={540}
      footer={(
        <div className="master-plan-grid__note-modal-actions">
          <button
            type="button"
            className="btn btn--secondary master-plan-grid__note-modal-copy-btn"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check size={15} aria-hidden="true" />
                <span>Đã sao chép</span>
              </>
            ) : (
              <>
                <Copy size={15} aria-hidden="true" />
                <span>Sao chép</span>
              </>
            )}
          </button>
          {activeNote.isOperational && onEditOperationalNote && activeNote.shipment && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                const shipmentToEdit = activeNote.shipment!;
                setCopied(false);
                onClose();
                onEditOperationalNote(shipmentToEdit);
              }}
            >
              <Edit3 size={15} aria-hidden="true" />
              <span>Sửa ghi chú</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            Đóng
          </button>
        </div>
      )}
    >
      <div className="master-plan-grid__note-modal-body">
        <div className="master-plan-grid__note-modal-content">
          {activeNote.note}
        </div>
      </div>
    </Modal>
  );
}
