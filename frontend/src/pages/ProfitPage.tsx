import React, { useState, useRef, useEffect } from 'react';
import {
  TrendingUp,
  Users,
  CheckSquare,
  Eye,
  AlertCircle
} from 'lucide-react';
import { api } from '../lib/api';
import { getActiveCapTable } from '../lib/cap-table';
import { PageHeader, Card, FormGroup, useConfirm } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { formatCurrency as formatVND } from '../lib/format';
import { getProfitPreviewEmptyMessage } from '../lib/profit-preview';
import { Money } from '../components/shared/Money';
import { useCapTable, useDistributionHistory, usePnlReport } from '../hooks/useQueries';
import { useToast } from '../components/shared/Toast';
import { useMonth } from '../hooks/useMonth';
import { usePageAnimations, useCounterAnimation } from '../hooks/animations';
import { TruckCapRole, TRUCK_CAP_ROLE_LABELS } from '@tingting/shared';
import './ProfitPage.css';
import './WorkflowFinance.css';
import { ProfitabilityReportPanel } from '../components/finance/ProfitabilityReportPanel';
import { useAuth } from '../hooks/useAuth';

/** B2 — render a partner-role tag. Driver-contributors get a distinct "Lái xe"
 * label so investors and drivers are visually distinguishable in the per-truck
 * breakdown and distribution tables. Returns null for the default investor
 * role so legacy investor-only views stay uncluttered. */
function RoleTag({ role }: { role?: TruckCapRole | string | null }) {
  if (!role || role === TruckCapRole.INVESTOR) return null;
  const label = TRUCK_CAP_ROLE_LABELS[TruckCapRole.DRIVER];
  return (
    <span style={{
      marginLeft: 6, fontSize: 12, fontWeight: 700, color: 'var(--warn)',
      background: 'var(--warn-soft)', padding: '1px 6px', borderRadius: 999,
      letterSpacing: '0.02em', verticalAlign: 'middle',
    }}>{label}</span>
  );
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

  return (
    <div ref={rootRef} style={{ paddingBottom: 40 }}>
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

      {user?.workflowRolloutMode === 'ACTIVE' && user.capabilities?.includes('profitability.read') && (
        <ProfitabilityReportPanel month={selectedMonth} year={selectedYear} />
      )}

      {error && (
        <Alert variant="error" style="soft" icon={<AlertCircle size={16} />} className="mb-5">
          {error}
        </Alert>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <div className="spin" style={{ width: 32, height: 32, border: '4px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%' }}></div>
        </div>
      ) : (
        <div className="profit-layout">

          {/* Bento Item 1: Profit Hero */}
          <div className="profit-bento-hero">
            <div className="profit-hero" style={{ height: '100%', marginBottom: 0 }}>
              <div className="profit-hero__label">Lợi nhuận ròng để phân chia · T{selectedMonth} / {selectedYear}</div>
              <div className="profit-hero__value">
                <span ref={heroValueRef}>0</span>
                <span className="profit-hero__currency">₫</span>
              </div>
              <div className="profit-hero__sub">
                Dựa trên <strong>{report?.tripCount || 0}</strong> chuyến đã khóa trong kỳ
              </div>
            </div>
          </div>

          {/* Bento Item 2: Accounting Breakdown */}
          <div className="profit-bento-breakdown">
            <Card
              title={
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TrendingUp size={16} style={{ color: 'var(--brand)' }} />
                  Diễn giải kế toán
                </span>
              }
              subtitle={`Thực tế ghi nhận trong tháng ${selectedMonth}/${selectedYear}`}
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              noPadding
            >
              <div className="calc-breakdown" style={{ border: 'none', borderRadius: 0, flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className="calc-row">
                  <div className="calc-row__label calc-row__label--bold">Doanh thu vận hành</div>
                  <div className="calc-row__value"><Money value={report?.totalRevenue || 0} /></div>
                </div>
                <div className="calc-row">
                  <div className="calc-row__label">
                    <span className="calc-row__op">-</span>
                    Chi phí vận hành đội xe
                  </div>
                  <div className="calc-row__value calc-row__value--neg"><Money value={report?.totalCosts || 0} sign="-" /></div>
                </div>
                <div className="calc-row calc-row--total">
                  <div className="calc-row__label calc-row__label--bold">Lợi nhuận gộp hoạt động</div>
                  <div className="calc-row__value"><Money value={report?.grossProfit || 0} /></div>
                </div>
                {((report?.maintenanceExpensesTotal ?? 0) > 0) && (
                  <div className="calc-row">
                    <div className="calc-row__label">
                      <span className="calc-row__op">-</span>
                      Chi phí bảo dưỡng, đăng kiểm xe
                    </div>
                    <div className="calc-row__value calc-row__value--neg"><Money value={report?.maintenanceExpensesTotal || 0} sign="-" /></div>
                  </div>
                )}
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
                <div className="calc-row calc-row--total calc-row--final" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
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
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Users size={16} style={{ color: 'var(--brand)' }} />
                  Phân chia theo tỷ lệ cổ phần
                </span>
              }
              subtitle="Phân chia lợi nhuận ròng theo tỷ lệ góp vốn cổ đông"
              style={{ height: '100%' }}
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'nowrap' }}>
                            <span className="partner-card__role">{isPrimary ? 'Đối tác chính' : 'Đối tác góp vốn'}</span>
                            <div className="partner-card__pct" style={{ marginLeft: 'auto' }}>
                              {partner.percentage}%
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="partner-card__amount-label">Phần lợi nhuận tháng {selectedMonth}</div>
                      <div className="partner-card__amount" style={{ color: isPrimary ? 'var(--brand)' : 'var(--info)' }}>
                        <Money value={partnerShare} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeCapTable.length === 0 && (
                <div style={{
                  padding: 24,
                  background: 'var(--bg-2)',
                  borderRadius: 8,
                  textAlign: 'center',
                  color: 'var(--fg-3)',
                  fontSize: 13,
                }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--fg-2)' }}>Chưa cấu hình tỷ lệ cổ phần</p>
                  <p style={{ margin: 0 }}>
                    Vui lòng thêm bản ghi tại{' '}
                    <a href="/config/cap-table" style={{ color: 'var(--brand)', fontWeight: 600 }}>
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
              style={{ height: '100%' }}
              title="Quyết toán & Chốt Quý"
              subtitle="Khóa sổ kế toán và tạo bản ghi phân phối lợi nhuận chính thức."
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <FormGroup label="Chọn Quý">
                    <select
                      className="input"
                      style={{ minWidth: 120, flex: '1 1 auto' }}
                      value={selectedQuarter}
                      onChange={e => { setSelectedQuarter(Number(e.target.value)); setPreview(null); }}
                    >
                      {[1, 2, 3, 4].map(q => <option key={q} value={q}>Quý {q}</option>)}
                    </select>
                  </FormGroup>
                  <FormGroup label="Năm quyết toán">
                    <select
                      className="input"
                      style={{ minWidth: 120, flex: '1 1 auto' }}
                      value={distQuarterYear}
                      onChange={e => { setDistQuarterYear(Number(e.target.value)); setPreview(null); }}
                    >
                      {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>Năm {y}</option>)}
                    </select>
                  </FormGroup>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                  <button
                    className="btn btn--secondary"
                    style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', justifyContent: 'center' }}
                    onClick={handlePreview}
                    disabled={previewing}
                  >
                    <Eye size={14} />
                    {previewing ? 'Đang tính...' : 'Xem trước'}
                  </button>
                  <button
                    className="btn btn--primary"
                    style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', justifyContent: 'center' }}
                    onClick={handleDistributeProfit}
                    disabled={distributing}
                  >
                    <CheckSquare size={14} />
                    {distributing ? 'Đang gửi...' : 'Gửi duyệt phân bổ'}
                  </button>
                </div>
              </div>

              {preview && !distributionRequest && (
                <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: 13.5, fontWeight: 700, color: 'var(--fg-1)' }}>📋 Dự kiến phân phối Quý {preview.quarter} / {preview.year}</h4>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--fg-2)' }}>
                    Lợi nhuận ròng từ <strong>{preview.tripCount ?? '?'} chuyến</strong>: <strong>{formatVND(preview.netProfit)}</strong>
                  </p>

                  {(preview.undistributedProfit ?? 0) > 0 && (
                    <div style={{ marginBottom: 10, padding: 10, background: 'var(--warn-soft)', color: 'var(--warn)', borderRadius: 6, fontSize: 12.5 }}>
                      ⚠️ <strong>{formatVND(preview.undistributedProfit ?? 0)}</strong> lợi nhuận từ xe chưa cấu hình đối tác sở hữu sẽ <strong>không được phân phối</strong>. Cài đặt tại <a href="/config/trucks" style={{ color: 'var(--warn)', fontWeight: 700 }}>Cấu hình → Xe → Sở hữu</a>.
                    </div>
                  )}

                  {previewEmptyMessage ? (
                    <div style={{ padding: 12, background: 'var(--bg-1)', borderRadius: 6, color: 'var(--fg-3)', fontSize: 12.5, fontWeight: 600 }}>
                      {previewEmptyMessage}
                    </div>
                  ) : preview.entity && preview.entity.length > 0 ? (
                    <>
                      <div style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 700, color: 'var(--fg-3)', letterSpacing: '0.04em', margin: '8px 0 4px' }}>TỔNG CÔNG TY (Σ các xe)</div>
                      <table style={{ width: '100%', fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-2)', color: 'var(--fg-3)' }}>
                            <th style={{ textAlign: 'left', paddingBottom: 6 }}>Đối tác</th>
                            <th style={{ textAlign: 'right', paddingBottom: 6 }}>Số tiền nhận</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.entity.map((d, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-3)' }}>
                              <td style={{ padding: '6px 0', fontWeight: 600 }}>{d.partnerName}</td>
                              <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--brand)', fontWeight: 700 }}>{formatVND(d.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : (
                    <table style={{ width: '100%', fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-2)', color: 'var(--fg-3)' }}>
                          <th style={{ textAlign: 'left', paddingBottom: 6 }}>Đối tác</th>
                          <th style={{ textAlign: 'right', paddingBottom: 6 }}>Tỷ lệ</th>
                          <th style={{ textAlign: 'right', paddingBottom: 6 }}>Số tiền nhận</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.distributions.map((d, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border-3)' }}>
                            <td style={{ padding: '6px 0', fontWeight: 600 }}>{d.partnerName}<RoleTag role={d.role} /></td>
                            <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--fg-3)' }}>{d.percentage ?? '—'}%</td>
                            <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--brand)', fontWeight: 700 }}>{formatVND(Number(d.amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {preview.perTruck && preview.perTruck.filter(t => t.partners.length > 0).length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 700, color: 'var(--fg-3)', letterSpacing: '0.04em', marginBottom: 6 }}>CHI TIẾT THEO XE</div>
                      {preview.perTruck.filter(t => t.partners.length > 0).map(t => (
                        <div key={t.truckId} style={{ marginBottom: 8, padding: '8px 10px', background: 'var(--bg-1)', borderRadius: 6 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 6 }}>
                            Xe {t.licensePlate ?? '(không rõ biển số)'} · Lợi nhuận: <span style={{ color: 'var(--brand)' }}>{formatVND(t.profit)}</span>
                          </div>
                          {t.partners.map((p, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--fg-3)', padding: '3px 0' }}>
                              <span>{p.partnerName} ({p.percentage}%)<RoleTag role={p.role} /></span>
                              <span style={{ fontWeight: 600, color: 'var(--fg-1)', whiteSpace: 'nowrap' }}>{formatVND(p.amount)}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {distributionRequest && (
                <div style={{ marginTop: 16, padding: 16, background: 'var(--brand-soft)', borderRadius: 8, border: '1px dashed var(--brand)' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: 13.5, fontWeight: 700, color: 'var(--brand)' }}>
                    Đã gửi yêu cầu phân chia Quý {distributionRequest.afterSnapshot.quarter} / {distributionRequest.afterSnapshot.year}
                  </h4>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-2)' }}>
                    Yêu cầu #{distributionRequest.id} đang chờ kiểm tra. Chưa có khoản lợi nhuận nào được phân phối; một người kiểm tra và một người phê duyệt độc lập phải hoàn tất trước khi hệ thống ghi nhận.
                  </p>
                </div>
              )}
            </Card>
          </div>

          {/* Bento Item 5: Distribution History */}
          {history.length > 0 && (
            <div className="profit-bento-history">
              <Card title="Lịch sử phân phối" subtitle="Các lần phân chia lợi nhuận đã thực hiện" style={{ height: '100%' }}>
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
