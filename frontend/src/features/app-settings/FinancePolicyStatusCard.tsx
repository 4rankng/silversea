import { FinanceVersionList } from './FinanceVersionList';
import { formatViDate } from './formatters';

/** The selected finance policy's current state: status note, current-version
 *  facts, and version history. Extracted from FinancePolicySection to keep
 *  the section under its ceiling; purely presentational. */
export function FinancePolicyStatusCard({ data }: { data: Record<string, unknown> | null }) {
  return (
              <div className="cfg-finance-summary__section">
                <h3 className="cfg-section__heading">Trạng thái hiện tại</h3>
                {data?.status === 'UNCONFIGURED' ? (
                  <div className="cfg-finance-note cfg-finance-note--warning">
                    <strong>Chưa có chính sách</strong>
                    <p>Báo cáo hiện giữ nguyên số liệu đã ghi sổ và hiển thị trạng thái chưa cấu hình.</p>
                  </div>
                ) : (
                  <dl className="cfg-finance-summary__grid">
                    <div>
                      <dt>Hiệu lực từ</dt>
                      <dd>{data?.currentPolicy ? formatViDate(data.currentPolicy.effectiveFrom) : 'Chưa cấu hình'}</dd>
                    </div>
                    <div>
                      <dt>Phiên bản</dt>
                      <dd>{data?.currentPolicy?.version ?? 'Chưa cấu hình'}</dd>
                    </div>
                    <div>
                      <dt>Khấu hao</dt>
                      <dd>{data?.currentPolicy?.depreciationMethodLabel ?? 'Đường thẳng'}</dd>
                    </div>
                    <div>
                      <dt>Phân bổ</dt>
                      <dd>{data?.currentPolicy?.allocationBasisLabel ?? 'Tỷ trọng doanh thu chuyến hoàn thành'}</dd>
                    </div>
                    <div>
                      <dt>Ngưỡng cảnh báo biên lợi nhuận</dt>
                      <dd>
                        {data?.currentPolicy?.lowMarginThresholdPercent == null
                          ? 'Chưa cấu hình cảnh báo biên lợi nhuận'
                          : `${data.currentPolicy.lowMarginThresholdPercent}%`}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
)
}
