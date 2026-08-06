import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Plus, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Pagination } from '../design-system';
import { PageHeader, StatusPill } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { api } from '../lib/api';
import { ApiError } from '../lib/api';
import './VehicleAllocationPage.css';

const PAGE_SIZE = 20;

type VehicleTab = 'summary' | 'detail';

interface ShipmentForAllocation {
  id: number;
  shipmentCode: string | null;
  customerName: string | null;
  factoryName: string | null;
  bookingRef: string | null;
  blNumber: string | null;
  shippingLineName: string | null;
  containerSummary: string | null;
  cargoWeightKg: number | null;
  tradeDirection: 'IMPORT' | 'EXPORT' | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  closingAt: string | null;
  plannedReturnAt: string | null;
  status: string;
  allocationStatus: 'NOT_ALLOCATED' | 'PARTIALLY_ALLOCATED' | 'FULLY_ALLOCATED';
  carrierAllocations: CarrierAllocationSummary[];
}

interface CarrierAllocationSummary {
  carrierId: number;
  carrierName: string;
  containerType: string;
  count: number;
}

interface AllocationResponse {
  items: ShipmentForAllocation[];
  total: number;
  page: number;
  limit: number;
}

export default function VehicleAllocationPage({ initialTab = 'summary' as VehicleTab }: { initialTab?: VehicleTab } = {}) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<VehicleTab>(initialTab);
  const [data, setData] = useState<AllocationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<AllocationResponse>(`/vehicle-allocation?page=${page}&limit=${PAGE_SIZE}`);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể tải dữ liệu phân xe');
    } finally {
      setLoading(false);
    }
  }, [page]);

  // TODO: Replace with real API call when backend is ready
  // For now, use mock data
  useEffect(() => {
    // Mock data - remove when backend is ready
    setData({
      items: [],
      total: 0,
      page: 1,
      limit: PAGE_SIZE,
    });
    setLoading(false);
  }, [page]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleItems = data?.items ?? [];

  const handleAllocate = (shipmentId: number) => {
    // TODO: Open allocation modal
    console.log('Allocate shipment:', shipmentId);
  };

  return (
    <div className="vehicle-allocation-page page-anim">
      <Breadcrumbs
        className="vehicle-allocation-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Điều phối', to: '/dispatch' },
          { label: 'Phân xe' },
        ]}
      />

      <button
        type="button"
        onClick={() => navigate(-1)}
        className="vehicle-allocation-page__back"
      >
        <ArrowLeft size={18} /> Quay lại
      </button>

      <PageHeader
        title="Phân bổ phương tiện"
        iconName="truck"
        description="Kế hoạch phân bổ nhà xe cho các lô hàng"
      />

      <section className="vehicle-allocation-page__workspace">
        {/* Tab Navigation */}
        <div className="vehicle-allocation-page__tabs">
          <button
            type="button"
            className={`vehicle-allocation-page__tab${activeTab === 'summary' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            Kế hoạch Tổng quát
          </button>
          <button
            type="button"
            className={`vehicle-allocation-page__tab${activeTab === 'detail' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('detail')}
          >
            Kế hoạch Chi tiết
          </button>
        </div>

        {error && (
          <div className="vehicle-allocation-page__error" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="vehicle-allocation-page__loading">
            Đang tải dữ liệu…
          </div>
        ) : !error && visibleItems.length === 0 ? (
          <EmptyState
            illustration="/assets/illustrations/empty-clients.svg"
            icon={Truck}
            title="Không có lô hàng nào cần phân xe"
            description="Lô hàng có ngày giao sẽ xuất hiện ở đây."
          />
        ) : (
          <>
            {activeTab === 'summary' && (
              <div className="vehicle-allocation-page__table-wrapper">
                <table className="vehicle-allocation-page__table">
                  <thead>
                    <tr>
                      <th>Ngày giao</th>
                      <th>Khách hàng</th>
                      <th>Nhà máy</th>
                      <th>Số Bill/Book</th>
                      <th>Hãng tàu</th>
                      <th>Tổng số lượng</th>
                      <th>Trọng lượng tổng</th>
                      <th>Xuất/Nhập</th>
                      <th>Cutoff</th>
                      <th>Nâng</th>
                      <th>Hạ</th>
                      <th>Điểm trả</th>
                      <th>Giờ đóng/trả</th>
                      <th>Ghi chú</th>
                      <th>Phân bổ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDate(item.closingAt)}</td>
                        <td>{item.customerName ?? '—'}</td>
                        <td>{item.factoryName ?? '—'}</td>
                        <td>{item.blNumber || item.bookingRef || '—'}</td>
                        <td>{item.shippingLineName ?? '—'}</td>
                        <td>{item.containerSummary ?? '—'}</td>
                        <td>{item.cargoWeightKg ? `${item.cargoWeightKg} kg` : '—'}</td>
                        <td>{item.tradeDirection === 'IMPORT' ? 'Nhập' : 'Xuất'}</td>
                        <td>{formatDate(item.closingAt)}</td>
                        <td>{item.pickupLocation ?? '—'}</td>
                        <td>{item.deliveryLocation ?? '—'}</td>
                        <td>{item.deliveryLocation ?? '—'}</td>
                        <td>{formatTime(item.plannedReturnAt)}</td>
                        <td>—</td>
                        <td>
                          <button
                            type="button"
                            className="vehicle-allocation-page__allocate-btn"
                            onClick={() => handleAllocate(item.id)}
                          >
                            Phân xe
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'detail' && (
              <div className="vehicle-allocation-page__table-wrapper">
                <table className="vehicle-allocation-page__table">
                  <thead>
                    <tr>
                      <th>Ngày giao</th>
                      <th>Khách hàng</th>
                      <th>Nhà máy</th>
                      <th>Số Bill/Book</th>
                      <th>Hãng tàu</th>
                      <th>Trọng lượng tổng</th>
                      <th>Số Cont</th>
                      <th>Xuất/Nhập</th>
                      <th>Loại Cont</th>
                      <th>Điểm trả</th>
                      <th>Giờ đóng/trả</th>
                      <th>Nhà xe</th>
                      <th>Biển số xe</th>
                      <th>Ghi chú dành cho xe</th>
                      <th>Note PS cho khách hàng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={15} style={{ textAlign: 'center', padding: '40px' }}>
                          Chưa có dữ liệu chi tiết container
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && total > 0 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={PAGE_SIZE}
                onChange={setPage}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('vi-VN');
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
