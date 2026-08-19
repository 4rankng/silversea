import { useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FileText, Download, History, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import { useToast } from '../shared/Toast';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { financialClient } from '../../api/financialClient';
import { qk } from '../../api/keys';
import BillingDocumentBuilder from './BillingDocumentBuilder';
import './BillingDocumentsPanel.css';
import type {
  BillingDocument, BillingDocumentType, BillingDocumentEntityType,
} from '@tingting/shared';

interface Props {
  type: BillingDocumentType;
  entityType: BillingDocumentEntityType;
  entityId: number;
  entityName: string;
  /** Create-button label, e.g. "Tạo giấy báo nợ". */
  buttonLabel: string;
  createBuilderOpen?: boolean;
  onOpenCreate?: () => void;
  onBuilderClose?: () => void;
}

function formatDueDate(value: string | null | undefined) {
  if (!value) return 'Chưa có dữ liệu lịch sử';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export default function BillingDocumentsPanel({
  type,
  entityType,
  entityId,
  entityName,
  buttonLabel,
  createBuilderOpen = false,
  onOpenCreate,
  onBuilderClose,
}: Props) {
  const { toast: showToast } = useToast();
  const queryClient = useQueryClient();
  const [localBuilderOpen, setLocalBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<BillingDocument | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const queryKey = qk.financial.billingDocuments(type, entityType, entityId);
  const { data: docs = [] } = useQuery<BillingDocument[]>({
    queryKey,
    queryFn: () => financialClient.listBillingDocuments(entityType, entityId, type),
    enabled: !!entityId,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    if (type === 'DEBIT_NOTE' && entityType === 'CUSTOMER') {
      // Use the broad prefix so the AR detail page's period-scoped statement
      // queries also refresh (the keyed variant only matches the default range).
      void queryClient.invalidateQueries({ queryKey: qk.financial.customerStatementAll });
      void queryClient.invalidateQueries({ queryKey: qk.financial.customerAgingAll });
      void queryClient.invalidateQueries({ queryKey: qk.financial.debt });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.receivablesSummary });
    }
  };

  const builderOpen = createBuilderOpen || localBuilderOpen;
  const openNew = () => {
    setEditing(null);
    if (onOpenCreate) {
      onOpenCreate();
    } else {
      setLocalBuilderOpen(true);
    }
  };
  const openEdit = (doc: BillingDocument) => { setEditing(doc); setLocalBuilderOpen(true); };
  const closeBuilder = () => {
    setLocalBuilderOpen(false);
    setEditing(null);
    if (createBuilderOpen) onBuilderClose?.();
  };

  const exportDoc = async (doc: BillingDocument) => {
    try {
      const blob = await api.getBlob(financialClient.getBillingDocumentExportUrl(doc.id));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type === 'DEBIT_NOTE' ? 'giay-bao-no' : 'bang-ke'}-${entityName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast({ kind: 'error', message: (err as Error).message || 'Lỗi xuất Excel' });
    }
  };

  const removeDoc = async (doc: BillingDocument) => {
    if (!window.confirm('Xóa tài liệu này?')) return;
    try {
      await financialClient.deleteBillingDocument(doc.id);
      showToast({ kind: 'success', message: 'Đã xóa.' });
      refresh();
    } catch (err) {
      showToast({ kind: 'error', message: (err as Error).message || 'Lỗi xóa' });
    }
  };

  return (
    <div className="billing-panel">
      <div className="billing-panel__head">
        <div className="billing-panel__title">
          <Receipt size={15} />
          <span>{type === 'DEBIT_NOTE' ? 'Giấy báo nợ' : 'Bảng kê'}</span>
          <small>{docs.length > 0 ? `${docs.length} đã lưu` : 'Chưa có lịch sử'}</small>
        </div>
        <div className="billing-panel__head-actions">
          {docs.length > 0 && (
            <button
              className="btn btn--ghost billing-panel__history-toggle"
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-expanded={historyOpen}
              aria-controls="billing-history-list"
            >
              <History size={14} />
              {historyOpen ? 'Ẩn lịch sử' : 'Xem lịch sử'}
              <ChevronDown size={14} className={historyOpen ? 'is-open' : undefined} />
            </button>
          )}
          <button className="btn btn--secondary billing-panel__create" type="button" onClick={openNew}>
            <Plus size={14} /> {buttonLabel}
          </button>
        </div>
      </div>

      {historyOpen && (
        docs.length === 0 ? (
          <div className="billing-panel__empty">
            Chưa có tài liệu nào.
          </div>
        ) : (
          <div className="billing-panel__list" id="billing-history-list">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="billing-panel__row"
              >
                <div className="billing-panel__doc">
                  <FileText size={15} />
                  <span>{doc.rangeFrom} → {doc.rangeTo}</span>
                  <strong className="mono">
                    {formatCurrency(doc.totalInclVat).replace(' ₫', '')}đ
                  </strong>
                  {doc.type === 'DEBIT_NOTE' && (
                    <span>
                      Hạn HĐ {formatDueDate(doc.originalDueDate)} · Xử lý {formatDueDate(doc.processingDueDate)}
                    </span>
                  )}
                </div>
                <div className="billing-panel__actions">
                  <button className="btn-icon" title="Sửa" aria-label="Sửa" onClick={() => openEdit(doc)} style={iconBtn}>
                    <Pencil size={13} />
                  </button>
                  <button className="btn-icon" title="Xuất Excel" aria-label="Xuất Excel" onClick={() => exportDoc(doc)} style={iconBtn}>
                    <Download size={13} />
                  </button>
                  <button className="btn-icon" title="Xóa" aria-label="Xóa" onClick={() => removeDoc(doc)} style={{ ...iconBtn, color: 'var(--danger)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {builderOpen && (
        <BillingDocumentBuilder
          isOpen={builderOpen}
          onClose={closeBuilder}
          type={type}
          entityType={entityType}
          entityId={entityId}
          entityName={entityName}
          initialDoc={editing}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

const iconBtn: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 4, color: 'var(--fg-2)',
};
