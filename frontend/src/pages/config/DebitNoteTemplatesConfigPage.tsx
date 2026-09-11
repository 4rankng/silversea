import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { AssetIcon } from '../../components/AssetIcon';
import { PageHeader, useConfirm } from '../../components/UI';
import { useToast } from '../../components/shared/Toast';
import { configClient } from '../../api/configClient';
import { qk } from '../../api/keys';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import type { DebitNoteTemplate } from '@tingting/shared';
import './config-page.css';

function groupLabel(mode: DebitNoteTemplate['groupingMode']) {
  if (mode === 'ROUTE') return 'theo tuyến';
  if (mode === 'LINE_TYPE') return 'theo loại dòng';
  return 'không nhóm';
}

export default function DebitNoteTemplatesConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const handleBack = () => navigate('/config');
  useBackShortcut(handleBack);

  const { data, isLoading, refetch } = useQuery<DebitNoteTemplate[]>({
    queryKey: qk.catalogs.debitNoteTemplates,
    queryFn: () => configClient.getDebitNoteTemplates(),
    staleTime: 30_000,
  });
  const templates = useMemo(() => data ?? [], [data]);

  const onDelete = async (template: DebitNoteTemplate) => {
    const ok = await confirm(`Xoá mẫu "${template.name}"? Các giấy báo nợ đã lưu vẫn giữ ảnh chụp mẫu cũ.`, { variant: 'danger' });
    if (!ok) return;
    try {
      await configClient.deleteDebitNoteTemplate(template.id);
      toast({
        kind: 'success',
        message: `Đã xoá mẫu "${template.name}".`,
      });
      await refetch();
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message || 'Không xoá được mẫu.' });
    }
  };

  return (
    <div ref={pageRef} className="cfg-page">
      <PageHeader
        title="Mẫu giấy báo nợ"
        description={<><strong>{templates.length}</strong> mẫu Excel</>}
        onBack={handleBack}
        iconName="debit-note-template"
        action={(
          <button type="button" className="btn btn--primary" onClick={() => navigate('/config/debit-note-templates/new')}>
            <Plus size={16} /> Thêm mẫu
          </button>
        )}
      />

      <div className="debit-template-list-shell">
        {isLoading ? (
          <div className="cfg-empty debit-template-list-empty debit-template-list-empty--loading">
            <Loader2 size={28} className="spin" />
            <strong>Đang tải mẫu</strong>
          </div>
        ) : templates.length === 0 ? (
          <div className="cfg-empty debit-template-list-empty">
            <img
              className="debit-template-list-empty__image"
              src="/assets/illustrations/empty-debit-note-template.png"
              alt=""
              loading="lazy"
            />
            <div className="debit-template-list-empty__copy">
              <strong>Chưa có mẫu nào</strong>
              <span>Tạo mẫu Excel để xuất giấy báo nợ theo khách hàng.</span>
            </div>
            <button type="button" className="btn btn--primary" onClick={() => navigate('/config/debit-note-templates/new')}>
              <Plus size={16} /> Thêm mẫu
            </button>
          </div>
        ) : (
          <div className="debit-template-list">
            {templates.map((template) => {
              const visibleColumns = (template.columns ?? []).filter(column => column.width > 0).length;
              const viewTemplate = () => navigate(`/config/debit-note-templates/${template.id}?mode=view`);
              return (
                <div
                  key={template.id}
                  className="cfg-row debit-template-card debit-template-card--clickable"
                  role="button"
                  tabIndex={0}
                  aria-label={`Xem mẫu ${template.name}`}
                  onClick={viewTemplate}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      viewTemplate();
                    }
                  }}
                >
                  <div className="debit-template-card__stripe" style={{ background: template.accentColor }} />
                  <div className="debit-template-card__icon" aria-hidden="true">
                    <AssetIcon name="debit-note-template" size={24} />
                  </div>
                  <div className="debit-template-card__main">
                    <div className="debit-template-card__title">
                      <strong>{template.name}</strong>
                      {template.isDefault && (
                        <span className="cfg-pill cfg-pill--success">
                          <Star size={11} /> Mặc định
                        </span>
                      )}
                    </div>
                    <div className="debit-template-card__meta">
                      <span>{template.titleText}</span>
                      <span>{visibleColumns} cột</span>
                      <span>{groupLabel(template.groupingMode)}</span>
                      <span>{template.orientation === 'landscape' ? 'Ngang' : 'Dọc'}</span>
                    </div>
                  </div>
                  <div className="debit-template-card__actions" onKeyDown={event => event.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/config/debit-note-templates/${template.id}`);
                      }}
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDelete(template);
                      }}
                      aria-label={`Xoá ${template.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmDialog}
    </div>
  );
}
