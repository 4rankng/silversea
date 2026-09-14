import { qk } from '../../api/keys';
import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePageAnimations } from '../../hooks/animations';
import { useNavigate } from 'react-router-dom';
import { Save, Loader2 } from 'lucide-react';
import { configClient } from '../../api/configClient';
import { useFuelConfig, useSaveFuelConfig } from '../../hooks/useCatalogQueries';
import { PageHeader, Panel } from '../../components/UI';
import { SortHeader } from '../../components/shared/SortHeader';
import { nextTableSort, sortClientSide, type TableSortState } from '../../lib/table-sort';
import type { FuelPriceHistory } from '@tingting/shared';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import './config-page.css';
import { resolveEmptyIllustration } from '../../lib/emptyIllustrations';

export default function FuelConfigPage() {
  const queryClient = useQueryClient();
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const { data: fuelConfig } = useFuelConfig();
  const saveFuel = useSaveFuelConfig();
  const [form, setForm] = useState({
    loadedNorm: '', emptyNorm: '', supplement: '', unitPrice: '', baseUnitPrice: '',
    warningThreshold: '37', criticalThreshold: '40',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<FuelPriceHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Client-side column sort for the price-history table — a small full-set
  // list fetched in one array; null keeps the backend's order. "Người thay
  // đổi" renders a constant placeholder (the API has no author field yet), so
  // it stays a plain decorative header.
  const [historySort, setHistorySort] = useState<TableSortState | null>(null);
  const handleHistorySort = (key: string) => setHistorySort(current => nextTableSort(current, key));
  const sortedHistory = useMemo(() => sortClientSide(history, historySort, {
    effectiveDate: row => row.effectiveDate,
    unitPrice: row => Number(row.unitPrice),
    note: row => row.note,
  }, (a, b) => b.id - a.id), [history, historySort]);

  useEffect(() => {
    if (fuelConfig) {
      // Accept both camelCase and legacy snake_case field names from the API.
      const f = fuelConfig as unknown as Record<string, string | null>;
      setForm({
        loadedNorm: f.loadedNorm ?? f.loaded_norm ?? '',
        emptyNorm: f.emptyNorm ?? f.empty_norm ?? '',
        supplement: f.supplement ?? '0',
        unitPrice: f.unitPrice ?? f.unit_price ?? '',
        baseUnitPrice: f.baseUnitPrice ?? f.base_unit_price ?? '',
        warningThreshold: f.warningThreshold ?? f.warning_threshold ?? '37',
        criticalThreshold: f.criticalThreshold ?? f.critical_threshold ?? '40',
      });
    }
  }, [fuelConfig]);

  useEffect(() => {
    configClient.getFuelPriceHistory().then(setHistory).catch(() => {}).finally(() => setHistoryLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveFuel.mutateAsync({
        // Optimistic-lock token: present once a config exists (the form seeds
        // from the same row); omitted on a genuine first configuration.
        expectedUpdatedAt: fuelConfig?.updatedAt ?? null,
        loadedNorm: Number(form.loadedNorm),
        emptyNorm: Number(form.emptyNorm),
        supplement: Number(form.supplement) || 0,
        unitPrice: Number(form.unitPrice),
        baseUnitPrice: form.baseUnitPrice ? Number(form.baseUnitPrice) : null,
        warningThreshold: form.warningThreshold ? Number(form.warningThreshold) : 37,
        criticalThreshold: form.criticalThreshold ? Number(form.criticalThreshold) : 40,
      });
      navigate('/config');
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 428 || status === 409) {
        // Version conflict: the config changed under us (or the page state
        // predates a config created elsewhere). Reload the authoritative row
        // and keep the draft for review — never a blind retry loop.
        setError('Cấu hình đã thay đổi — đã tải lại bản mới. Giữ nguyên các giá trị bạn nhập; kiểm tra rồi lưu lại.');
        void queryClient.invalidateQueries({ queryKey: qk.catalogs.fuelConfig });
      } else {
        setError(e instanceof Error ? e.message : 'Lỗi lưu');
      }
    } finally { setSaving(false); }
  };

  const currentUnitPrice = Number(form.unitPrice || 0);
  const baseUnitPrice = Number(form.baseUnitPrice || 0);
  const surchargeDelta = form.baseUnitPrice
    ? Math.max(0, currentUnitPrice - baseUnitPrice)
    : null;

  return (
    <div ref={pageRef} className="cfg-page cfg-page--fuel">
      <PageHeader title="Định mức nhiên liệu" description="Định mức tiêu hao theo xe và loại tải · đơn giá dầu hiện hành · ngưỡng cảnh báo TTBQ" onBack={() => navigate('/config')} iconName="fuel" />
      <Panel title="Cấu hình tính nhiên liệu" subtitle="Thông số dùng để tính chi phí nhiên liệu cho mỗi chuyến">
        <div className="cfg-form-grid">
          <div className="field" id="fuel-loaded-norm-field">
            <label htmlFor="fuel-loaded-norm">Định mức có tải (lít/100km)</label>
            <input id="fuel-loaded-norm" name="loadedNorm" className="input" type="number" step="0.1" value={form.loadedNorm} onChange={e => setForm(f => ({ ...f, loadedNorm: e.target.value }))} placeholder="Ví dụ: 35" />
          </div>
          <div className="field" id="fuel-empty-norm-field">
            <label htmlFor="fuel-empty-norm">Định mức xe không (lít/100km)</label>
            <input id="fuel-empty-norm" name="emptyNorm" className="input" type="number" step="0.1" value={form.emptyNorm} onChange={e => setForm(f => ({ ...f, emptyNorm: e.target.value }))} placeholder="Ví dụ: 22" />
          </div>
        </div>
        <div className="cfg-form-grid">
          <div className="field" id="fuel-supplement-field">
            <label htmlFor="fuel-supplement">Bổ sung mặc định (lít)</label>
            <input id="fuel-supplement" name="supplement" className="input" type="number" step="0.1" value={form.supplement} onChange={e => setForm(f => ({ ...f, supplement: e.target.value }))} placeholder="Ví dụ: 3" />
            <p className="cfg-field-hint">Số lít bổ sung thêm mặc định cho mỗi chuyến.</p>
          </div>
          <div className="field" id="fuel-unit-price-field">
            <label htmlFor="fuel-unit-price">Đơn giá nhiên liệu hiện hành (đ/lít)</label>
            <input id="fuel-unit-price" name="unitPrice" className="input" type="number" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} placeholder="Ví dụ: 23000" />
          </div>
        </div>
        <div className="cfg-form-grid">
          <div className="field" id="fuel-base-unit-price-field">
            <label htmlFor="fuel-base-unit-price">Giá dầu gốc tính phụ phí (đ/lít)</label>
            <input id="fuel-base-unit-price" name="baseUnitPrice" className="input" type="number" value={form.baseUnitPrice} onChange={e => setForm(f => ({ ...f, baseUnitPrice: e.target.value }))} placeholder="Để trống nếu chưa áp dụng" />
            <p className="cfg-field-hint">Chỉ phần giá hiện hành cao hơn giá gốc mới được dùng để tính phụ phí.</p>
          </div>
          <div className="field" id="fuel-base-unit-price-preview">
            <label>Chênh lệch tính phụ phí</label>
            <div className="input" aria-live="polite" style={{ display: 'flex', alignItems: 'center', minHeight: 44 }}>
              {surchargeDelta == null
                ? 'Không phát sinh chênh lệch'
                : `${surchargeDelta.toLocaleString('vi-VN')} đ/lít`}
            </div>
          </div>
        </div>

        <div className="cfg-section">
          <h3 className="cfg-section__heading">
            Ngưỡng cảnh báo tiêu hao
            <span className="cfg-section__heading-pill">TTBQ</span>
          </h3>
          <div className="cfg-form-grid">
            <div className="field" id="fuel-warning-threshold-field">
              <label htmlFor="fuel-warning-threshold">Ngưỡng cảnh báo (lít/100km)</label>
              <input id="fuel-warning-threshold" name="warningThreshold" className="input" type="number" step="0.1" value={form.warningThreshold} onChange={e => setForm(f => ({ ...f, warningThreshold: e.target.value }))} placeholder="Ví dụ: 37" />
              <p className="cfg-field-hint cfg-field-hint--warn">TTBQ vượt ngưỡng này → cảnh báo vàng.</p>
            </div>
            <div className="field" id="fuel-critical-threshold-field">
              <label htmlFor="fuel-critical-threshold">Ngưỡng nghiêm trọng (lít/100km)</label>
              <input id="fuel-critical-threshold" name="criticalThreshold" className="input" type="number" step="0.1" value={form.criticalThreshold} onChange={e => setForm(f => ({ ...f, criticalThreshold: e.target.value }))} placeholder="Ví dụ: 40" />
              <p className="cfg-field-hint cfg-field-hint--danger">TTBQ vượt ngưỡng này → cảnh báo đỏ.</p>
            </div>
          </div>
        </div>

        <div className="cfg-form-actions">
          <button id="fuel-save-config-button" className="btn btn--primary" disabled={saving || !(Number(form.loadedNorm) > 0) || !(Number(form.emptyNorm) > 0) || !(Number(form.unitPrice) > 0)} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            Lưu cấu hình
          </button>
          {message && <span style={{ color: 'var(--success)', fontSize: 13 }}>{message}</span>}
          {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>}
        </div>
      </Panel>
      <Panel title="Lịch sử giá nhiên liệu" subtitle="Theo dõi các lần thay đổi đơn giá nhiên liệu" style={{ marginTop: 20 }}>
        {historyLoading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink-3)' }}>Đang tải…</div>
        ) : history.length === 0 ? (
          <div className="cfg-empty" style={{ padding: '24px 16px' }}>
            <img src={resolveEmptyIllustration('empty-config')} alt="" aria-hidden="true" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div className="cfg-empty__title">Chưa có lịch sử</div>
            <div className="cfg-empty__hint">Lịch sử thay đổi giá sẽ hiển thị sau lần lưu đầu tiên.</div>
          </div>
        ) : (
          <div className="table-scroll">
            <div className="record-table-wrap">
            <table className="record-table ops-table">
              <thead>
                <tr>
                  <SortHeader label="Ngày hiệu lực" sortKey="effectiveDate" sort={historySort} onSortChange={handleHistorySort} />
                  <SortHeader className="num" label="Đơn giá (₫/lít)" sortKey="unitPrice" sort={historySort} onSortChange={handleHistorySort} />
                  <th>Người thay đổi</th>
                  <SortHeader label="Ghi chú" sortKey="note" sort={historySort} onSortChange={handleHistorySort} />
                </tr>
              </thead>
              <tbody>
                {sortedHistory.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Ngày hiệu lực" style={{ whiteSpace: 'nowrap' }}>{new Date(row.effectiveDate).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td>
                    <td data-label="Đơn giá (₫/lít)" className="num" style={{ fontWeight: 600 }}>{Number(row.unitPrice).toLocaleString('vi-VN')}</td>
                    <td data-label="Người thay đổi" style={{ color: 'var(--ink-3)' }}>—</td>
                    <td data-label="Ghi chú" style={{ color: 'var(--ink-3)' }}>{row.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
