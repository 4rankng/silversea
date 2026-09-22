import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, AlertCircle } from 'lucide-react';
import { EmptyState } from '../../design-system';
import { useQuery } from '@tanstack/react-query';
import { fetchAllPaginated } from '../../lib/http/paginate';
import { PageHeader, Panel, Modal, useConfirm } from '../UI';
import { Alert } from '../shared/Alert';
import { useCRUD } from '../../hooks/useCRUD';
import { qk } from '../../api/keys';
import { configurationText, normalizeConfigurationText } from './config-search';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import '../../pages/config/config-page.css';

interface CrudColumn<T> {
  header: string;
  width?: number;
  className?: string;
  render: (item: T, index: number, isActive: boolean, allItems: T[]) => React.ReactNode;
}

function isInteractiveChild(target: EventTarget | null, row: HTMLTableRowElement) {
  if (!(target instanceof Element)) return false;
  const control = target.closest('a, button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]');
  return control !== null && control !== row;
}

interface CrudTableProps<T extends { id: number; updatedAt?: string }> {
  title: string;
  description: string;
  endpoint: string;
  /** Optional query string used only by the list request; mutations keep the base endpoint. */
  listQuery?: string;
  columns: CrudColumn<T>[];
  renderForm: (props: {
    item?: T;
    items: T[];
    saving: boolean;
    onSave: (data: Record<string, unknown>) => void;
    onCancel: () => void;
    onDelete?: () => Promise<void>;
    deleting?: boolean;
  }) => React.ReactNode;
  colSpan: number;
  showDelete?: boolean;
  onDelete?: (id: number, expectedUpdatedAt?: string) => void;
  /** Optional status chip (or any node) shown at the right of the edit-modal header. */
  modalChip?: (item: T) => React.ReactNode;
  sortFn?: (a: T, b: T) => number;
  computeActiveIds?: (items: T[]) => Set<number>;
  rowStyle?: (item: T, isActive: boolean) => React.CSSProperties | undefined;
  toolbarLeft?: (ctx: { totalItems: number; activeCount: number }) => React.ReactNode;
  backTo?: string;
  emptyContext?: import('../../lib/emptyIllustrations').EmptyContext;
  emptyTitle?: string;
  emptyHint?: string;
  pageSlug?: string;
  iconName?: import('../../components/AssetIcon').AssetIconName;
}

export function CrudTable<T extends { id: number; updatedAt?: string }>({
  title, description, endpoint, listQuery = '', columns, renderForm, colSpan,
  showDelete = true, onDelete, modalChip, sortFn, computeActiveIds, rowStyle,
  toolbarLeft, backTo = '/config',
  emptyContext = 'config',
  emptyTitle = 'Chưa có dữ liệu',
  emptyHint,
  pageSlug,
  iconName,
}: CrudTableProps<T>) {
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [search, setSearch] = useState('');

  const { data, refetch, isLoading, isError, isFetching } = useQuery({
    queryKey: qk.crud.entityList(endpoint, listQuery),
    queryFn: () => fetchAllPaginated<T>(endpoint, Object.fromEntries(new URLSearchParams(listQuery)), 5, { requireComplete: true }),
  });

  const refresh = useCallback(async () => { await refetch(); }, [refetch]);
  const crud = useCRUD(endpoint, refresh);

  const rawItems = data ?? [];
  const activeIds = computeActiveIds ? computeActiveIds(rawItems) : new Set<number>();

  const items = (() => {
    if (!rawItems.length) return rawItems;
    const arr = [...rawItems];
    if (computeActiveIds) {
      arr.sort((a, b) => {
        const aA = activeIds.has(a.id) ? 1 : 0;
        const bA = activeIds.has(b.id) ? 1 : 0;
        if (aA !== bA) return bA - aA;
        return sortFn ? sortFn(a, b) : 0;
      });
    } else if (sortFn) {
      arr.sort(sortFn);
    }
    return arr;
  })();

  const normalizedSearch = normalizeConfigurationText(search);
  const visibleItems = normalizedSearch ? items.filter((item, index) =>
    columns.some(column => normalizeConfigurationText(configurationText(column.render(item, index, activeIds.has(item.id), items))).includes(normalizedSearch)),
  ) : items;

  const handleDelete = onDelete ?? ((id: number, expectedUpdatedAt?: string) => crud.doDelete(id, expectedUpdatedAt));

  const wrapperClass = ['fade-up', 'cfg-page', pageSlug ? `cfg-page--${pageSlug}` : ''].filter(Boolean).join(' ');

  return (
    <div className={wrapperClass}>
      <PageHeader title={title} description={description} onBack={() => navigate(backTo)} iconName={iconName} showTitle />
      <Panel flush>
        <div className="toolbar">
          <div className="cfg-catalogue-search">
            <input className="input" type="search" aria-label={`Tìm trong ${title.toLowerCase()}`} placeholder="Tìm trong danh mục…" value={search} onChange={event => setSearch(event.target.value)} />
          </div>
          <div className="cfg-catalogue-summary" aria-live="polite">
            {toolbarLeft
              ? toolbarLeft({ totalItems: items.length, activeCount: activeIds.size })
              : items.length > 0 && (
                  <span className="cfg-page__summary">
                    <strong>{visibleItems.length}{normalizedSearch ? ` / ${items.length}` : ''}</strong> mục
                  </span>
                )}
          </div>
          <button className="btn btn--primary btn--sm" onClick={() => crud.setShowAddForm(true)}>
            <Plus size={14} /> Thêm mới
          </button>
        </div>
        {isError && <div role="alert" className="cfg-catalogue-feedback">
          <span>Không tải được danh mục.{items.length > 0 ? ' Dữ liệu đang hiển thị có thể chưa cập nhật.' : ' Hãy thử lại để kiểm tra dữ liệu hiện có.'}</span>
          <button type="button" className="btn btn--secondary btn--sm" disabled={isFetching} onClick={() => { void refetch(); }}>{isFetching ? 'Đang thử lại…' : 'Thử lại'}</button>
        </div>}
        <div className="table-scroll">
          <div className="record-table-wrap">
          <table className="record-table ops-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th style={{ width: 54 }}>STT</th>
                {columns.map(col => (
                  <th key={col.header} style={col.width ? { width: col.width } : undefined} className={col.className}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr className="cfg-empty-row"><td colSpan={columns.length + 1} data-label=""><div className="cfg-catalogue-feedback" role="status">Đang tải danh mục…</div></td></tr>}
              {!isLoading && !isError && items.length === 0 && !crud.showAddForm && (
                <tr className="cfg-empty-row">
                  <td colSpan={colSpan + 1} data-label="" style={{ textAlign: 'center' }}>
                    <EmptyState
                      context={emptyContext}
                      title={emptyTitle}
                      description={emptyHint}
                      action={
                        <button className="btn btn--primary btn--sm" onClick={() => crud.setShowAddForm(true)}>
                          <Plus size={14} /> Thêm mới
                        </button>
                      }
                    />
                  </td>
                </tr>
              )}
              {!isLoading && items.length > 0 && visibleItems.length === 0 && <tr className="cfg-empty-row"><td colSpan={columns.length + 1} data-label=""><div className="cfg-catalogue-feedback" role="status"><span>Không có mục phù hợp.</span><button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>Xóa tìm kiếm</button></div></td></tr>}
              {visibleItems.map((item, i) => {
                const isActive = activeIds.has(item.id);
                return (
                  <tr
                    key={item.id}
                    style={{ cursor: 'pointer', ...rowStyle?.(item, isActive) }}
                    onClick={(event) => {
                      if (!isInteractiveChild(event.target, event.currentTarget)) crud.setEditingId(item.id);
                    }}
                    onKeyDown={(event) => {
                      if (isInteractiveChild(event.target, event.currentTarget)) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        crud.setEditingId(item.id);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Chỉnh sửa ${title.toLowerCase()} thứ ${i + 1}`}
                    title="Nhấp để chỉnh sửa hoặc xóa"
                  >
                    <td className="num" data-label="STT">{i + 1}</td>
                    {columns.map(col => (
                      <td key={col.header} className={col.className} data-label={col.header}>
                        {col.render(item, i, isActive, items)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      </Panel>
      {/* Validation errors render INSIDE the open dialog — a page-level
          alert here sits behind the modal backdrop and is unreadable on
          desktop overlap and blurred phone backdrops alike. */}
      {crud.error && !crud.showAddForm && crud.editingId == null && (
        <Alert variant="error" style="soft" icon={<AlertCircle size={16} />} className="mt-3">
          {crud.error}
        </Alert>
      )}

      {/* Modal for adding a new item */}
      <Modal
        isOpen={crud.showAddForm && !crud.editingId}
        title={`Thêm ${title.toLowerCase()}`}
        onClose={crud.cancelForm}
        maxWidth={600}
        polished
        ariaLabel={`Thêm ${title.toLowerCase()}`}
      >
        <div style={{ padding: '8px 4px' }}>
          {crud.error && (
            <div role="alert" className="mb-3"><Alert variant="error" style="soft" icon={<AlertCircle size={16} />}>
              {crud.error}
            </Alert></div>
          )}
          {renderForm({
            saving: crud.saving,
            onSave: crud.doCreate,
            onCancel: crud.cancelForm,
            items,
          })}
        </div>
      </Modal>

      {/* Modal for editing/deleting an existing item — delete anchors bottom-left
          of the form via FormActions; confirm flow lives in the onDelete prop. */}
      {(() => {
        const item = items.find(x => x.id === crud.editingId);
        if (!item) return null;
        return (
          <Modal
            isOpen={true}
            title={`Chỉnh sửa ${title.toLowerCase()}`}
            onClose={crud.cancelForm}
            maxWidth={600}
            polished
            ariaLabel={`Chỉnh sửa ${title.toLowerCase()}`}
            headerRight={modalChip?.(item)}
          >
            <div style={{ padding: '8px 4px' }}>
              {crud.error && (
                <div role="alert" className="mb-3"><Alert variant="error" style="soft" icon={<AlertCircle size={16} />}>
                  {crud.error}
                </Alert></div>
              )}
              {renderForm({
                item,
                saving: crud.saving,
                // KP-135: pass the caller-bound version from the loaded snapshot
                onSave: (d) => crud.doUpdate(item.id, d, item.updatedAt),
                onCancel: crud.cancelForm,
                items,
                onDelete: showDelete ? async () => {
                  const ok = await confirm(`Bạn có chắc chắn muốn xóa ${title.toLowerCase()} này?`, {
                    variant: 'danger',
                    confirmLabel: 'Xóa'
                  });
                  if (ok) {
                    await handleDelete(item.id, item.updatedAt);
                    crud.cancelForm();
                  }
                } : undefined,
                deleting: crud.deleting === item.id,
              })}
            </div>
          </Modal>
        );
      })()}
      {dialog}
    </div>
  );
}
