import { useState, useEffect } from 'react';
import { Save, Loader2, AlertCircle } from 'lucide-react';
import { Drawer, Btn, FormGroup } from '../../../components/UI';
import { Alert } from '../../../components/shared/Alert';
import { formatCurrency } from '../../../lib/format';
import type { Driver, PenaltyReason } from '@tingting/shared';
import type { CreatePenaltyRequest } from '@tingting/shared';
import { useQuery } from '@tanstack/react-query';
import { tripClient } from '../../../api/tripClient';
import { qk } from '../../../api/keys';
import { SearchableSelect } from '../../../design-system/forms/SearchableSelect';

interface PenaltyFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  drivers: Driver[];
  reasons: PenaltyReason[];
  onSubmit: (body: CreatePenaltyRequest) => Promise<unknown>;
  preselectedDriverId?: number;
}

export function PenaltyFormDrawer({
  isOpen,
  onClose,
  drivers,
  reasons,
  onSubmit,
  preselectedDriverId,
}: PenaltyFormDrawerProps) {
  const [formDriverId, setFormDriverId] = useState('');
  const [formTripId, setFormTripId] = useState('');
  const [formReasonId, setFormReasonId] = useState('');
  const [formCustomReason, setFormCustomReason] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tripSearch, setTripSearch] = useState('');
  const tripOptionsQuery = useQuery({
    queryKey: [...qk.trips.all, 'penalty-selector', formDriverId, tripSearch],
    queryFn: () => tripClient.listTrips({
      limit: 50,
      page: 1,
      driverId: formDriverId ? Number(formDriverId) : undefined,
      search: tripSearch || undefined,
    }),
    enabled: isOpen,
    staleTime: 60_000,
  });
  const tripOptions = (tripOptionsQuery.data?.items ?? [])
    .filter((trip) => !formDriverId || trip.driver?.id === Number(formDriverId))
    .map((trip) => ({
      value: String(trip.id),
      label: [
        trip.tripCode || 'Chuyến chưa có mã',
        trip.customer?.name || 'Khách hàng chưa xác định',
        trip.route?.name || 'Tuyến chưa xác định',
        trip.departureDate || 'Chưa có ngày khởi hành',
      ].join(' · '),
      searchText: `${trip.customer?.name ?? ''} ${trip.route?.name ?? ''} ${trip.departureDate ?? ''}`,
    }));

  useEffect(() => {
    if (isOpen) {
      if (preselectedDriverId) setFormDriverId(String(preselectedDriverId));
      setFormTripId('');
      setFormReasonId('');
      setFormCustomReason('');
      setFormAmount('');
      setFormDate(new Date().toISOString().slice(0, 10));
      setTripSearch('');
      setSubmitError(null);
    }
  }, [isOpen, preselectedDriverId]);

  const handleSubmit = async () => {
    if (!formDriverId || !formAmount || !formDate) return;
    setSubmitting(true);
    setSubmitError(null);
    const body: CreatePenaltyRequest = {
      driverId: Number(formDriverId),
      amount: parseFloat(formAmount),
      date: formDate,
    };
    if (formTripId) body.tripId = Number(formTripId);
    if (formReasonId) body.reasonId = Number(formReasonId);
    if (formCustomReason) body.customReason = formCustomReason;
    try {
      await onSubmit(body);
      onClose();
    } catch (e: unknown) {
      setSubmitError((e as Error).message || 'Lỗi khi tạo phạt');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReasonChange = (reasonId: string) => {
    setFormReasonId(reasonId);
    if (reasonId) {
      const reason = reasons.find(r => r.id === Number(reasonId));
      if (reason?.defaultAmount) setFormAmount(reason.defaultAmount);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Lập biên bản kỷ luật"
      subtitle="Tạo mới biên bản vi phạm nghiệp vụ"
      onConfirm={handleSubmit}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Hủy</Btn>
          <Btn
            variant="primary"
            icon={submitting ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
            disabled={submitting || !formDriverId || !formAmount || !formDate}
            onClick={handleSubmit}
          >
            Xác nhận
          </Btn>
        </>
      }
    >
      {submitError && (
        <Alert variant="error" style="soft" icon={<AlertCircle size={16} />} className="mb-4">
          {submitError}
        </Alert>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormGroup label="Lái xe vi phạm *">
          <select className="input" value={formDriverId} onChange={e => setFormDriverId(e.target.value)}>
            <option value="">-- Chọn lái xe --</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FormGroup>
        <FormGroup label="Chuyến liên quan (tùy chọn)">
          <SearchableSelect
            id="penalty-trip"
            value={formTripId}
            onChange={setFormTripId}
            options={tripOptions}
            onSearchChange={setTripSearch}
            placeholder={tripOptionsQuery.isLoading ? 'Đang tải chuyến…' : 'Chọn theo mã chuyến'}
            emptyMessage={tripOptionsQuery.isFetching ? 'Đang tìm chuyến phù hợp…' : 'Không có chuyến phù hợp với lái xe đã chọn.'}
            searchPlaceholder="Tìm theo mã chuyến, khách hàng hoặc tuyến…"
          />
        </FormGroup>
        <FormGroup label="Lý do danh mục">
          <select className="input" value={formReasonId} onChange={e => handleReasonChange(e.target.value)}>
            <option value="">-- Chọn danh mục --</option>
            {reasons.map(r => <option key={r.id} value={r.id}>{r.reasonText} ({formatCurrency(Number(r.defaultAmount))})</option>)}
          </select>
        </FormGroup>
        <FormGroup label="Lý do chi tiết khác">
          <input className="input" placeholder="Mô tả lỗi phát sinh..." value={formCustomReason} onChange={e => setFormCustomReason(e.target.value)} />
          {formCustomReason.length > 5 && (() => {
            const q = formCustomReason.toLowerCase();
            const match = reasons.find(r =>
              r.reasonText.toLowerCase().includes(q) || q.includes(r.reasonText.toLowerCase())
            );
            if (!match) return null;
            return (
              <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--brand)', marginTop: 4 }}>
                Đã có lý do tương tự:{' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', fontWeight: 600, padding: 0, fontSize: 12, lineHeight: 1.35, textDecoration: 'underline' }}
                  onClick={() => { setFormCustomReason(match.reasonText); if (match.defaultAmount) setFormAmount(match.defaultAmount); }}
                >
                  "{match.reasonText}"
                </button>
                {' '}— dùng lý do này?
              </div>
            );
          })()}
        </FormGroup>
        <FormGroup label="Số tiền khấu trừ (đ) *">
          <input className="input" type="number" placeholder="0" value={formAmount} onChange={e => setFormAmount(e.target.value)} />
        </FormGroup>
        <FormGroup label="Ngày vi phạm *">
          <input className="input" type="date" value={formDate} onChange={e => setFormDate(e.target.value)} />
        </FormGroup>
      </div>
    </Drawer>
  );
}
