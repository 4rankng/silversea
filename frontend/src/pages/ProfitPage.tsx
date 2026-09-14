import React, { useState, useRef, useEffect } from 'react';
import {
  TrendingUp,
  Users,
  CheckSquare,
  Eye,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api';
import { getActiveCapTable } from '../lib/cap-table';
import { PageHeader, Card, useConfirm } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { formatCurrency as formatVND } from '../lib/format';
import { getProfitPreviewEmptyMessage } from '../lib/profit-preview';
import { Money } from '../components/shared/Money';
import { useCapTable, useDashboardWidgets, useDistributionHistory, usePnlReport } from '../hooks/useQueries';
import { useToast } from '../components/shared/Toast';
import { useMonth } from '../hooks/useMonth';
import { usePageAnimations, useCounterAnimation } from '../hooks/animations';
import { TruckCapRole, TRUCK_CAP_ROLE_LABELS } from '@tingting/shared';
import './ProfitPage.css';
import './WorkflowFinance.css';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import { ProfitabilityReportPanel } from '../components/finance/ProfitabilityReportPanel';
import { useAuth } from '../hooks/useAuth';
import { UuiSelectField } from '../design-system';

/** B2 — render a partner-role tag. Driver-contributors get a distinct "Lái xe"
 * label so investors and drivers are visually distinguishable in the per-truck
 * breakdown and distribution tables. Returns null for the default investor
 * role so legacy investor-only views stay uncluttered. */
function RoleTag({ role }: { role?: TruckCapRole | string | null }) {
  if (!role || role === TruckCapRole.INVESTOR) return null;
  const label = TRUCK_CAP_ROLE_LABELS[TruckCapRole.DRIVER];
  return <span className="profit-role-tag">{label}</span>;
}

interface DistributionResult {
  quarter: number;
  year: number;
  netProfit: number;
  tripCount?: number;
  distributions: Array<{
    partnerName: string;
    percentage?: string;
    amount: string;
    truckId?: number | null;
    /** B2 — partner role label (INVESTOR | DRIVER). */
    role?: TruckCapRole | string | null;
  }>;
  /** F3 — entity-grouped view (partner → Σ across trucks). */
  entity?: Array<{ partnerName: string; amount: number }>;
  /** F3 — per-truck breakdown. */
  perTruck?: Array<{
    truckId: number;
    /** Business label — backend joins trucks.license_plate so we never show #id. */
    licensePlate?: string;
    profit: number;
    partners: Array<{ partnerName: string; percentage: number; amount: number; role?: TruckCapRole | string | null }>;
  }>;
  /** F3 — Σ profit of ownerless trucks (held aside, not distributed). */
  undistributedProfit?: number;
}

interface ProfitDistributionRequest {
  id: number;
  actionKind: 'PROFIT_DISTRIBUTION';
  status: 'PENDING_CHECK';
  version: number;
  afterSnapshot: {
    quarter: number;
    year: number;
  };
}

export default function ProfitPage() {
  const user = useAuth()?.user;
  const isAdmin = user?.role === 'ADMIN';
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { toast: showToast } = useToast();

  const now = new Date();
  const { month: selectedMonth, year: selectedYear } = useMonth();

  const [selectedQuarter, setSelectedQuarter] = useState<number>(Math.ceil((now.getMonth() + 1) / 3));
  const [distQuarterYear, setDistQuarterYear] = useState<number>(now.getFullYear());
  const [distributing, setDistributing] = useState(false);
  const [distributionRequest, setDistributionRequest] = useState<ProfitDistributionRequest | null>(null);
  const [preview, setPreview] = useState<DistributionResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const { data: report, isLoading: loading, error: reportError } = usePnlReport(selectedMonth, selectedYear);
  const { data: dashboardWidgets } = useDashboardWidgets(selectedMonth, selectedYear);

  const { data: capTable = [], error: capError } = useCapTable();
  const { data: history = [] } = useDistributionHistory();

  const error = reportError || capError ? 'Không thể tải báo cáo phân chia lợi nhuận.' : null;
  const { rootRef } = usePageAnimations({ ready: !loading });
  const netProfit = report?.netProfit || 0;
  const heroValueRef = useRef<HTMLSpanElement>(null);
  const { animateCounters } = useCounterAnimation({ delay: 200 });

  useEffect(() => {
    if (!report || !heroValueRef.current) return;
    animateCounters([
      { el: heroValueRef.current, value: netProfit },
    ]);
  }, [report, netProfit, animateCounters]);

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await api.post<DistributionResult>('/reports/distribute-profit/preview', {
        quarter: selectedQuarter,
        year: distQuarterYear,
      });
      setPreview(res);
    } catch (err) {
      showToast({ kind: 'error', message: err instanceof Error ? err.message : 'Lỗi khi xem trước phân phối.' });
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => {
    let active = true;

    async function loadQuarterPreview() {
      setPreviewing(true);
      setPreview(null);
      try {
        const res = await api.post<DistributionResult>('/reports/distribute-profit/preview', {
          quarter: selectedQuarter,
          year: distQuarterYear,
        });
        if (active) setPreview(res);
      } catch (err) {
        if (active) {
          showToast({ kind: 'error', message: err instanceof Error ? err.message : 'Lỗi khi xem trước phân phối.' });
        }
      } finally {
        if (active) setPreviewing(false);
      }
    }

    loadQuarterPreview();
    return () => {
      active = false;
    };
  }, [selectedQuarter, distQuarterYear, showToast]);

  const handleDistributeProfit = async () => {
    if (!await confirm(`Gửi yêu cầu phân chia lợi nhuận Quý ${selectedQuarter}/${distQuarterYear} để kiểm tra và phê duyệt?`)) {
      return;
    }

    setDistributing(true);
    setDistributionRequest(null);
    try {
      const res = await api.post<ProfitDistributionRequest>('/reports/distribute-profit', {
        quarter: selectedQuarter,
        year: distQuarterYear
      });
      setDistributionRequest(res);
      setPreview(null);
      showToast({ kind: 'success', message: 'Đã gửi yêu cầu phân chia lợi nhuận để kiểm tra và phê duyệt.' });
    } catch (err) {
      showToast({ kind: 'error', message: err instanceof Error ? err.message : 'Lỗi khi gửi yêu cầu phân chia lợi nhuận.' });
    } finally {
      setDistributing(false);
    }
  };

  const getDisplayCapTable = () => {
    if (capTable && capTable.length > 0) {
      const result = getActiveCapTable(capTable);
      if (result.length > 0) return result;
    }
    return [];
  };

  const activeCapTable = getDisplayCapTable();
  const previewEmptyMessage = preview ? getProfitPreviewEmptyMessage(preview) : null;
  const inspectionAlerts = (dashboardWidgets?.fleetAttention ?? [])
    .filter((item) => item.reason.includes('Đăng kiểm'))
    .sort((a, b) => a.licensePlate.localeCompare(b.licensePlate));
  const variableTripCosts = report?.trucks?.reduce((sum, truck) => sum + (truck.variableTripCosts ?? 0), 0) ?? 0;
  const maintenanceCosts = report?.maintenanceExpensesTotal ?? 0;
  const fleetDepreciationCosts = report?.fleetDepreciationTotal ?? 0;
  const fleetFixedCosts = report?.fleetMonthlyFixedCostTotal ?? 0;

  return (
    <div ref={rootRef} className="profit-page">
      <Breadcrumbs
        className="profit-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Phân chia lợi nhuận' },
        ]}
      />
      {/* Header */}
      <PageHeader
        title="Phân chia lợi nhuận"
        iconName="profit"
        description="Báo cáo phân bổ lợi nhuận ròng giữa các đối tác góp vốn."
      />

      {user?.capabilities?.includes('profitability.read') && (
        <ProfitabilityReportPanel month={selectedMonth} year={selectedYear} />
      )}

      {error && (
        <Alert variant="error" style="soft" icon={<AlertCircle size={16} />} className="mb-5">
          {error}
        </Alert>
      )}

      {inspectionAlerts.length > 0 && (
        <Alert variant="warning" style="soft" icon={<AlertTriangle size={16} />} className="mb-5">
          <div className="profit-page__alert-content">
            <strong>Cần xử lý đăng kiểm đội xe trong tháng {selectedMonth}/{selectedYear}</strong>
            <span>
              {inspectionAlerts.length} xe đang có nhắc việc đăng kiểm trên báo cáo quản trị dùng chung cho quản lý và kế toán.
            </span>
            <span>
              {inspectionAlerts.slice(0, 4).map((item) => `${item.licensePlate}: ${item.reason}`).join(' · ')}
              {inspectionAlerts.length > 4 ? ` · +${inspectionAlerts.length - 4} xe khác` : ''}
            </span>
          </div>
        </Alert>
      )}

      {loading ? (
        <div className="profit-loading">
          <div className="profit-loading__spinner" />
        </div>
      ) : (
        <div className="profit-layout">

          {/* Bento Item 1: Profit Hero */}
          <div className="profit-bento-hero">
            <div className="profit-hero profit-hero--fill">
              <div className="profit-hero__label">Lợi nhuận ròng để phân chia · T{selectedMonth} / {selectedYear}</div>
              <div className="profit-hero__value">
                <span ref={heroValueRef}>0</span>
                <span className="profit-hero__currency">₫</span>
              </div>
              <div className="profit-hero__sub">
                Dựa trên <strong>{report?.tripCount || 0}</strong> chuyến hoàn thành trong kỳ
              </div>
            </div>
          </div>

          {/* Bento Item 2: Accounting Breakdown */}
          <div className="profit-bento-breakdown">
            <Card
              title={
                <span className="profit-page__card-title">
                  <TrendingUp size={16} className="profit-page__card-title-icon" />
                  Diễn giải kế toán
                </span>
              }
              subtitle={`Thực tế ghi nhận trong tháng ${selectedMonth}/${selectedYear}`}
              className="profit-bento-breakdown__inner"
              noPadding
            >
              <div className="calc-breakdown profit-calc-breakdown">
                <div className="calc-row">
                  <div className="calc-row__label calc-row__label--bold">Doanh thu vận hành</div>
                  <div className="calc-row__value"><Money value={report?.totalRevenue || 0} /></div>
                </div>
                <div className="calc-row">
                  <div className="calc-row__label">
                    <span className="calc-row__op">-</span>
                    Chi phí biến đổi chuyến
                  </div>
                  <div className="calc-row__value calc-row__value--neg"><Money value={variableTripCosts} sign="-" /></div>
                </div>
                {maintenanceCosts > 0 && (
                  <div className="calc-row">
                    <div className="calc-row__label">
                      <span className="calc-row__op">-</span>
                      Bảo dưỡng và đăng kiểm
                    </div>
                    <div className="calc-row__value calc-row__value--neg"><Money value={maintenanceCosts} sign="-" /></div>
                  </div>
                )}
                {fleetDepreciationCosts > 0 && (
                  <div className="calc-row">
                    <div className="calc-row__label">
                      <span className="calc-row__op">-</span>
                      Khấu hao đội xe
                    </div>
                    <div className="calc-row__value calc-row__value--neg"><Money value={fleetDepreciationCosts} sign="-" /></div>
                  </div>
                )}
                {fleetFixedCosts > 0 && (
                  <div className="calc-row">
                    <div className="calc-row__label">
                      <span className="calc-row__op">-</span>
                      Chi phí cố định đội xe
                    </div>
                    <div className="calc-row__value calc-row__value--neg"><Money value={fleetFixedCosts} sign="-" /></div>
                  </div>
                )}
                <div className="calc-row calc-row--total">
                  <div className="calc-row__label calc-row__label--bold">Lợi nhuận gộp hoạt động</div>
                  <div className="calc-row__value"><Money value={report?.grossProfit || 0} /></div>
                </div>
                <div className="calc-row">
                  <div className="calc-row__label">
                    <span className="calc-row__op">-</span>
                    Chi phí chung công ty
                  </div>
                  <div className="calc-row__value calc-row__value--neg"><Money value={report?.companyExpenses || 0} sign="-" /></div>
                </div>
                <div className="calc-row">
                  <div className="calc-row__label">
                    <span className="calc-row__op">+</span>
                    Thu nhập phạt vi phạm
                  </div>
                  <div className="calc-row__value calc-row__value--positive"><Money value={report?.otherIncome || 0} sign="+" /></div>
                </div>
                <div className="calc-row calc-row--total calc-row--final">
                  <div className="calc-row__label calc-row__label--bold">Lợi nhuận ròng chia cổ đông</div>
                  <div className="calc-row__value"><Money value={netProfit} /></div>
                </div>
              </div>
            </Card>
          </div>

          {/* Bento Item 3: Shareholders */}
          <div className="profit-bento-shareholders">
            <Card
              title={
                <span className="profit-page__card-title">
                  <Users size={16} className="profit-page__card-title-icon" />
                  Phân chia theo tỷ lệ cổ phần
                </span>
              }
              subtitle="Phân chia lợi nhuận ròng theo tỷ lệ góp vốn cổ đông"
              className="profit-card--fill"
            >
              <div className="partner-grid">
                {activeCapTable.map((partner, i) => {
                  const isPrimary = i === 0;
                  const partnerShare = Math.round(netProfit * partner.percentage / 100);

                  return (
                    <div key={i} className={`partner-card ${isPrimary ? 'partner-card--primary' : ''}`}>
                      <div className="partner-card__head">
                        <div className={`partner-card__avatar ${isPrimary ? 'partner-card__avatar--primary' : 'partner-card__avatar--secondary'}`}>
                          <Users size={18} aria-hidden="true" />
                        </div>
                        <div className="partner-card__info">
                          <div className="partner-card__name">
                            {partner.partnerName}
                          </div>
                          <div className="partner-card__meta">
                            <span className="partner-card__role">{isPrimary ? 'Đối tác chính' : 'Đối tác góp vốn'}</span>
                            <div className="partner-card__pct partner-card__pct--auto">
                              {partner.percentage}%
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="partner-card__amount-label">Phần lợi nhuận tháng {selectedMonth}</div>
                      <div className={`partner-card__amount ${isPrimary ? 'partner-card__amount--primary' : 'partner-card__amount--secondary'}`}>
                        <Money value={partnerShare} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeCapTable.length === 0 && (
                <div className="profit-settlement__empty">
                  <p className="profit-settlement__empty-title">Chưa cấu hình tỷ lệ cổ phần</p>
                  <p className="profit-settlement__empty-body">
                    Vui lòng thêm bản ghi tại{' '}
                    <a href="/config/cap-table" className="profit-settlement__empty-link">
                      Cấu hình Cổ đông
                    </a>{' '}
                    để hiển thị phân chia lợi nhuận.
                  </p>
                </div>
              )}
            </Card>
          </div>

          {/* Bento Item 4: Quarterly Settlement */}
          <div className={history.length === 0 ? "profit-bento-settlement profit-bento-settlement--full" : "profit-bento-settlement"}>
            <Card
              className="profit-card--fill"
              title="Quyết toán & Chốt Quý"
              subtitle="Khóa sổ kế toán và tạo bản ghi phân phối lợi nhuận chính thức."
            >
              <div className="profit-settlement">
                <div className="profit-settlement__fields">
                  <UuiSelectField
                    label="Chọn Quý"
                    value={String(selectedQuarter)}
                    onChange={e => { setSelectedQuarter(Number(e.target.value)); setPreview(null); }}
                    options={[1, 2, 3, 4].map(q => ({ value: String(q), label: `Quý ${q}` }))}
                    inline
                  />
                  <UuiSelectField
                    label="Năm quyết toán"
                    value={String(distQuarterYear)}
                    onChange={e => { setDistQuarterYear(Number(e.target.value)); setPreview(null); }}
                    options={[2024, 2025, 2026, 2027].map(y => ({ value: String(y), label: `Năm ${y}` }))}
                    inline
                  />
                </div>
                <div className="profit-settlement__actions">
                  <button
                    className="btn btn--secondary btn--sm"
                    onClick={handlePreview}
                    disabled={previewing}
                  >
                    <Eye size={14} />
                    {previewing ? 'Đang tính...' : 'Xem trước'}
                  </button>
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={handleDistributeProfit}
                    disabled={distributing}
                  >
                    <CheckSquare size={14} />
                    {distributing ? 'Đang gửi...' : 'Gửi duyệt phân bổ'}
                  </button>
                </div>
              </div>

              {preview && !distributionRequest && (
                <div className="profit-settlement__preview">
                  <h4 className="profit-settlement__preview-title">
                    <span aria-hidden="true">📋</span>
                    <span>Dự kiến phân phối Quý <strong>{preview.quarter} / {preview.year}</strong></span>
                  </h4>
                  <p className="profit-settlement__preview-summary">
                    Lợi nhuận ròng từ <strong>{preview.tripCount ?? '?'} chuyến</strong>: <strong>{formatVND(preview.netProfit)}</strong>
                  </p>

                  {(preview.undistributedProfit ?? 0) > 0 && (
                    <div className="profit-settlement__preview-warning">
                      <strong>⚠️ {formatVND(preview.undistributedProfit ?? 0)}</strong> lợi nhuận từ xe chưa cấu hình đối tác sở hữu sẽ <strong>không được phân phối</strong>.
                      {' '}
                      {((): Array<{ truckId: number; licensePlate?: string; profit: number }> => (preview.perTruck ?? []).filter((t) => t.partners.length === 0 && t.profit > 0))().length > 0 && (
                        <>
                          Xe bị chặn:{' '}
                          {(preview.perTruck ?? [])
                            .filter((t) => t.partners.length === 0 && t.profit > 0)
                            .slice(0, 3)
                            .map((t, idx, arr) => (
                              <span key={t.truckId}>
                                {isAdmin ? (
                                  <a href={`/config/trucks/${t.truckId}/owners`}>{t.licensePlate ?? `xe #${t.truckId}`}</a>
                                ) : (
                                  <span>{t.licensePlate ?? `xe #${t.truckId}`}</span>
                                )}
                                {idx < arr.length - 1 ? ', ' : ''}
                              </span>
                            ))}
                          {(preview.perTruck ?? []).filter((t) => t.partners.length === 0 && t.profit > 0).length > 3
                            ? ` +${(preview.perTruck ?? []).filter((t) => t.partners.length === 0 && t.profit > 0).length - 3} xe khác`
                            : ''}
                          {' '}— {isAdmin ? 'bấm biển số để cấu hình đối tác sở hữu (tỷ lệ tổng 100%).' : 'yêu cầu Admin cấu hình đối tác sở hữu.'}
                        </>
                      )}
                    </div>
                  )}

                  {previewEmptyMessage ? (
                    <div className="profit-settlement__preview-empty">
                      {previewEmptyMessage}
                    </div>
                  ) : preview.entity && preview.entity.length > 0 ? (
                    <>
                      <div className="profit-settlement__group-label">TỔNG CÔNG TY (Σ các xe)</div>
                      {/* In-card summary table: shares the record-table skin
                          (typography, hairlines, hover) without the collapse
                          wrapper — a bento span-8 card sits permanently under
                          the shared 1100px container threshold. */}
                      <table className="record-table ops-table">
                        <thead>
                          <tr>
                            <th>Đối tác</th>
                            <th className="num">Số tiền nhận</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.entity.map((d, idx) => (
                            <tr key={idx}>
                              <td data-label="Đối tác" className="profit-table__name">{d.partnerName}</td>
                              <td data-label="Số tiền nhận" className="num profit-table__amount">{formatVND(d.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : (
                    <table className="record-table ops-table">
                      <thead>
                        <tr>
                          <th>Đối tác</th>
                          <th className="num">Tỷ lệ</th>
                          <th className="num">Số tiền nhận</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.distributions.map((d, idx) => (
                          <tr key={idx}>
                            <td data-label="Đối tác" className="profit-table__name">{d.partnerName}<RoleTag role={d.role} /></td>
                            <td data-label="Tỷ lệ" className="num profit-table__pct">{d.percentage ?? '—'}%</td>
                            <td data-label="Số tiền nhận" className="num profit-table__amount">{formatVND(Number(d.amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {preview.perTruck && preview.perTruck.filter(t => t.partners.length > 0).length > 0 && (
                    <div className="profit-settlement__trucks">
                      <div className="profit-settlement__group-label">CHI TIẾT THEO XE</div>
                      {preview.perTruck.filter(t => t.partners.length > 0).map(t => (
                        <div key={t.truckId} className="profit-settlement__truck">
                          <div className="profit-settlement__truck-head">
                            Xe {t.licensePlate ?? '(không rõ biển số)'} · Lợi nhuận: <strong>{formatVND(t.profit)}</strong>
                          </div>
                          {t.partners.map((p, i) => (
                            <div key={i} className="profit-settlement__truck-partner">
                              <span>{p.partnerName} ({p.percentage}%)<RoleTag role={p.role} /></span>
                              <strong>{formatVND(p.amount)}</strong>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {distributionRequest && (
                <div className="profit-settlement__request">
                  <h4 className="profit-settlement__request-title">
                    Đã gửi yêu cầu phân chia Quý {distributionRequest.afterSnapshot.quarter} / {distributionRequest.afterSnapshot.year}
                  </h4>
                  <p className="profit-settlement__request-body">
                    Yêu cầu phân chia lợi nhuận đang chờ kiểm tra. Chưa có khoản lợi nhuận nào được phân phối; một người kiểm tra và một người phê duyệt độc lập phải hoàn tất trước khi hệ thống ghi nhận.
                  </p>
                </div>
              )}
            </Card>
          </div>

          {/* Bento Item 5: Distribution History */}
          {history.length > 0 && (
            <div className="profit-bento-history">
              <Card title="Lịch sử phân phối" subtitle="Các lần phân chia lợi nhuận đã thực hiện" className="profit-card--fill">
                <div className="profit-history-scroll">
                  <div className="profit-history-list">
                    {history.map((d) => (
                      <div key={d.id} className="profit-history-item">
                        <div className="profit-history-item__top">
                          <span className="profit-history-item__period">Q{d.quarter}/{d.year}</span>
                          <span className="profit-history-item__partner">{d.partnerName}</span>
                        </div>
                        <div className="profit-history-item__bottom">
                          <span className="profit-history-item__amount"><Money value={Number(d.amount)} /></span>
                          <span className="profit-history-item__date">{new Date(d.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          )}

        </div>
      )}
      {confirmDialog}
    </div>
  );
}
