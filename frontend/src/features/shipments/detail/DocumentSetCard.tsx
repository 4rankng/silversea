// SIL-1073 (KB Ch3 §3.5.4, Lớp 2) — the lot's ORIGINAL document set card.
//
// Layer 2 of the KB's three independent document-status layers: Còn thiếu ·
// Đang bổ sung · Đã đủ, with Người nhận + Ngày nhận thực tế gating 'Đã đủ'
// (the server refuses the transition without both — the client mirrors the
// same VN reason inline but the 400 stays the authority).
//
// Mounted read-only in the CUS drawer facts (status chip only); the full
// editor lives on the review page (/shipments/:id view mode) where the lot
// version is already loaded for the optimistic write.
import { useMemo, useState } from 'react';
import {
  SHIPMENT_DOCUMENT_SET_STATUS_LABELS,
  ShipmentDocumentSetStatus,
} from '@tingting/shared';
import type { ShipmentDocumentSet, ShipmentDocumentSetStatus as SetStatus } from '@tingting/shared';
import { updateShipmentDocumentSet } from '../../../api/shipmentClient';
import './DocumentSetCard.css';

export interface DocumentSetCardProps {
  shipmentId: number;
  /** The lot's optimistic-lock version at read time (expectedShipmentVersion). */
  version: number;
  documentSet: ShipmentDocumentSet;
  /** Host refresh after a successful save (the workspace's reloadLot). */
  onSaved: () => void;
}

const STATUS_ORDER: readonly SetStatus[] = [
  ShipmentDocumentSetStatus.MISSING,
  ShipmentDocumentSetStatus.SUPPLEMENTING,
  ShipmentDocumentSetStatus.COMPLETE,
];

const TONE_CLASS: Record<SetStatus, string> = {
  [ShipmentDocumentSetStatus.MISSING]: 'doc-set-card__tone-debt',
  [ShipmentDocumentSetStatus.SUPPLEMENTING]: 'doc-set-card__tone-progress',
  [ShipmentDocumentSetStatus.COMPLETE]: 'doc-set-card__tone-complete',
};

function formatReceivedOn(value: string | null): string {
  if (value == null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? '—';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function DocumentSetCard({ shipmentId, version, documentSet, onSaved }: DocumentSetCardProps) {
  const [status, setStatus] = useState<SetStatus>(documentSet.status);
  const [missingText, setMissingText] = useState(documentSet.missingDocuments.join('\n'));
  const [receiverName, setReceiverName] = useState(documentSet.receiverName ?? '');
  const [receivedOn, setReceivedOn] = useState(documentSet.receivedOn ?? '');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const missingNames = useMemo(
    () => missingText.split(/[\n,;]/).map((name) => name.trim()).filter((name) => name.length > 0),
    [missingText],
  );

  async function save() {
    if (saving) return;
    // The KB gate, mirrored client-side: 'Đã đủ' needs Người nhận + Ngày nhận
    // thực tế. The server's 400 stays the authority.
    if (status === ShipmentDocumentSetStatus.COMPLETE
      && (receiverName.trim().length === 0 || receivedOn.length === 0)) {
      setInlineError('Chuyển "Đã đủ" cần ghi đủ Người nhận và Ngày nhận thực tế.');
      return;
    }
    setInlineError(null);
    setSaving(true);
    try {
      await updateShipmentDocumentSet(shipmentId, {
        expectedShipmentVersion: version,
        status,
        missingDocuments: missingNames,
        receiverName: receiverName.trim().length > 0 ? receiverName.trim() : null,
        receivedOn: receivedOn.length > 0 ? receivedOn : null,
      });
      onSaved();
    } catch (error) {
      setInlineError(error instanceof Error && error.message.length > 0
        ? error.message
        : 'Không lưu được bộ hồ sơ chứng từ gốc. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="doc-set-card" aria-labelledby="doc-set-card-title">
      <header className="doc-set-card__band">
        <h3 id="doc-set-card-title">Bộ hồ sơ chứng từ gốc</h3>
        <span className={`doc-set-card__status ${TONE_CLASS[documentSet.status]}`} data-status={documentSet.status}>
          {documentSet.status in SHIPMENT_DOCUMENT_SET_STATUS_LABELS
            ? SHIPMENT_DOCUMENT_SET_STATUS_LABELS[documentSet.status as SetStatus]
            : documentSet.label}
        </span>
      </header>
      <div className="doc-set-card__body">
        <div className="doc-set-card__facts">
          <div className="doc-set-card__fact">
            <span className="doc-set-card__fact-label">Người nhận</span>
            <span>{documentSet.receiverName ?? '—'}</span>
          </div>
          <div className="doc-set-card__fact">
            <span className="doc-set-card__fact-label">Ngày nhận thực tế</span>
            <span>{formatReceivedOn(documentSet.receivedOn)}</span>
          </div>
          {documentSet.changedByName != null && (
            <div className="doc-set-card__fact">
              <span className="doc-set-card__fact-label">Cập nhật</span>
              <span>{documentSet.changedByName}</span>
            </div>
          )}
        </div>
        {documentSet.missingDocuments.length > 0 && (
          <div className="doc-set-card__missing">
            <span className="doc-set-card__fact-label">Tài liệu còn thiếu</span>
            <ul className="doc-set-card__missing-list">
              {documentSet.missingDocuments.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}

        {documentSet.editable && (
          <div className="doc-set-card__editor">
            <div className="doc-set-card__status-picker" role="radiogroup" aria-label="Trạng thái bộ hồ sơ">
              {STATUS_ORDER.map((value) => (
                <label key={value} className="doc-set-card__status-option">
                  <input
                    type="radio"
                    name="doc-set-status"
                    value={value}
                    checked={status === value}
                    onChange={() => { setStatus(value); setInlineError(null); }}
                  />
                  <span>{SHIPMENT_DOCUMENT_SET_STATUS_LABELS[value]}</span>
                </label>
              ))}
            </div>
            <div className="doc-set-card__inputs">
              <label className="doc-set-card__input">
                <span>Người nhận</span>
                <input
                  type="text"
                  value={receiverName}
                  maxLength={160}
                  placeholder="Người nhận bộ hồ sơ gốc"
                  onChange={(event) => { setReceiverName(event.target.value); setInlineError(null); }}
                />
              </label>
              <label className="doc-set-card__input">
                <span>Ngày nhận thực tế</span>
                <input
                  type="date"
                  value={receivedOn}
                  onChange={(event) => { setReceivedOn(event.target.value); setInlineError(null); }}
                />
              </label>
            </div>
            <label className="doc-set-card__input doc-set-card__input--area">
              <span>Tài liệu còn thiếu (mỗi tài liệu một dòng)</span>
              <textarea
                value={missingText}
                rows={2}
                maxLength={4000}
                placeholder="Ví dụ: Biên bản giao nhận (bản gốc)"
                onChange={(event) => { setMissingText(event.target.value); setInlineError(null); }}
              />
            </label>
            {inlineError != null && <p className="doc-set-card__error" role="alert">{inlineError}</p>}
            <button
              type="button"
              className="doc-set-card__save"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Đang lưu…' : 'Lưu bộ hồ sơ'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
