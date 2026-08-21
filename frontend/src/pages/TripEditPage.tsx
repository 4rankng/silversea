import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { ApiError } from '../lib/api';
import { Role, TripStatus, TRIP_STATUS_LABELS } from '@tingting/shared';
import { useConfirm } from '../components/UI';
import { Spinner } from '../components/shared/Spinner';
import { useTripDetail } from '../hooks/useQueries';
import { useAuth } from '../hooks/useAuth';
import { useCatalogs } from '../hooks/useCatalogs';
import { useTripForm } from '../hooks/useTripForm';
import { isAnyUploading } from '../hooks/useTripFormPhotos';
import { TripFormProvider } from '../hooks/useTripFormContext';
import { FuelSection } from '../components/trip/FuelSection';
import { AllowanceSection } from '../components/trip/AllowanceSection';
import { TotalsPanel } from '../components/trip/TotalsPanel';
import { PhotoUploader } from '../components/trip/PhotoUploader';
import { JourneyLegsCard } from '../components/trip/JourneyLegsCard';
import { CardSection } from '../components/trip/CardSection';
import { InputWithPrefix } from '../components/trip/InputWithPrefix';
import { ContainerInstancesCard } from '../components/trip/ContainerInstancesCard';
import { AncillaryFeesCard } from '../components/trip/AncillaryFeesCard';
import { TripInstructionsCard } from '../components/trip/TripInstructionsCard';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import type { TripOptions } from '../hooks/useTripOptions';
import { SearchableSelect, DateInput, UuiSelectField } from '../design-system';
import './TripForm.css';
import './TripEditPage.css';

export default function TripEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { data: trip, isLoading: loading, refetch: refetchTrip } = useTripDetail(id);
  const { data: catalogData } = useCatalogs();
  const { rootRef } = usePageAnimations({ ready: !loading });
  const [governanceReason, setGovernanceReason] = useState('');

  const editOptions: TripOptions = useMemo(() => ({
    customers: catalogData?.customers.map((c) => ({ id: c.id, label: c.name })) ?? [],
    carrierCustomers: catalogData?.customers.filter(c => c.isCarrier).map(c => ({ id: c.id, label: c.name })) ?? [],
    routes: catalogData?.routes.map(r => ({
      id: r.id,
      label: `${r.name}${r.distanceKm ? ` (${r.distanceKm} km)` : ''}`,
      name: r.name,
      distanceKm: r.distanceKm ?? undefined,
      isMountain: r.isMountain,
      fixedFuelAllowance: r.fixedFuelAllowance,
    })) ?? [],
    trucks: catalogData?.trucks.map((t) => ({ id: t.id, label: t.licensePlate, currentTrailerId: t.currentTrailerId ?? null })) ?? [],
    trailerTypes: [{ value: '20FT', label: '20FT' }, { value: '40FT', label: '40FT' }],
    drivers: catalogData?.drivers.map((d) => ({
      id: d.id,
      label: d.name,
      baseSalary: Number(d.baseSalary) || 0,
    })) ?? [],
    trailers: catalogData?.trailers?.map((t) => ({ id: t.id, label: t.licensePlate, type: t.type })) ?? [],
    cargoTypes: catalogData?.cargoTypes.map((c) => ({ id: c.id, label: c.name })) ?? [],
    containerTypes: catalogData?.containerTypes.map((c) => ({ id: c.id, label: c.name || c.code || 'Loại container chưa đặt tên' })) ?? [],
    pricingTables: [],
    loading: !catalogData,
  }), [catalogData]);

  const form = useTripForm({
    options: editOptions,
    mode: 'edit',
    existingTrip: trip,
    governanceReason,
  });
  const searchableRoutes = useMemo(
    () => editOptions.routes.map((route) => ({
      value: String(route.id),
      label: route.label,
      searchText: route.name,
    })),
    [editOptions.routes],
  );
  const canChangeCustomer = user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  const { error, submitting, uploading, handleSubmit, routeId, setRouteId, notes, setNotes, departureDate, setDepartureDate, completedAt, setCompletedAt } = form;
  const filledContainerTypeIds = form.containerRows
    .map(row => row.containerTypeId)
    .filter(Boolean)
    .map(String);
  const commonContainerTypeId = filledContainerTypeIds.length > 0 &&
    filledContainerTypeIds.every(typeId => typeId === filledContainerTypeIds[0])
      ? filledContainerTypeIds[0]
      : '';
  const plannedContainerTypeId = form.plannedContainerTypeId || commonContainerTypeId;
  const setPlannedContainerTypeId = (value: string) => {
    form.setPlannedContainerTypeId(value);
    form.setContainerRows(prev => prev.map(row => ({
      ...row,
      containerTypeId: value ? Number(value) : '',
    })));
  };

  // The trip form hydrates from `existingTrip` via an effect inside the form
  // hook (one render after `trip` arrives), so gate the dirty baseline on a
  // `formHydrated` flag that flips the render *after* population — otherwise
  // the populate pass would read as a spurious "dirty" on every load.
  const [formHydrated, setFormHydrated] = useState(false);
  useEffect(() => { setFormHydrated(!!trip && !!catalogData); }, [trip, catalogData]);
  const guard = useDirtyGuard([form], formHydrated);
  const handleBack = () => { if (trip) navigate(`/trips/${trip.id}`); };
  useBackShortcut(handleBack, {
    isDirty: guard.isDirty,
    confirmDiscard: () => confirm('Thoát mà không lưu? Các thay đổi chưa lưu sẽ bị mất.', { variant: 'warning', confirmLabel: 'Thoát' }),
  });

  const onSubmit = async (e: React.FormEvent) => {
    try {
      const result = await handleSubmit(e);
      if (result !== undefined) {
        navigate(`/trips/${result}`);
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        if (await confirm("Có người khác đã cập nhật chuyến này. Tải lại?")) {
          await refetchTrip();
          form.resetForm?.();
        }
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Bounce the user off the edit page if the trip can't actually be edited
  // (CANCELED). Note: in the new model COMPLETED is the terminal posting state
  // but costs/figures stay editable via the actuals endpoint (with a dirty-flag
  // governance reason), so completed trips are intentionally allowed through.
  // Without this guard the form lets you fill in everything and only fails at
  // submit time — confusing because the page looked editable.
  useEffect(() => {
    if (trip && trip.status === TripStatus.CANCELED) {
      navigate(`/trips/${trip.id}`, { replace: true });
    }
  }, [trip, navigate]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 10, color: 'var(--fg-3)' }}>
        <Spinner size={20} />
        <span style={{ fontSize: 14 }}>Đang tải dữ liệu…</span>
      </div>
    );
  }

  if (!trip) return null;
  if (trip.status === TripStatus.CANCELED) {
    // useEffect above will redirect; render nothing in the meantime to avoid a flash.
    return null;
  }

  return (
    <TripFormProvider form={form}>
      <div ref={rootRef} className="trip-edit-page">
        <header className="tc-page-head">
          <button className="tc-back-btn" onClick={handleBack} aria-label="Quay lại">
            <ArrowLeft size={18} />
          </button>
          <div className="tc-title-wrap">
            <h1 className="tc-page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/assets/icons/03-trip-log-so-chuyen-chuyen-xe.png" alt="" style={{ width: 32, height: 32, flexShrink: 0 }} />
              {trip.tripCode || 'Cập nhật số liệu'}
              <span
                className={`tc-status-pill tc-status-pill--${trip.status === TripStatus.IN_TRANSIT ? 'in-transit' : trip.status === TripStatus.COMPLETED ? 'completed' : 'draft'}`}
                aria-label={`Trạng thái: ${trip.status}`}
              >
                {TRIP_STATUS_LABELS[trip.status]}
              </span>
            </h1>
            <p className="tc-page-sub">{trip.customer?.name ?? ''} · {trip.route?.name ?? ''}</p>
          </div>
        </header>

        <form id="trip-edit-form" onSubmit={onSubmit}>
          <div className="tc-content">
            <div className="tc-bento">
              {trip.status === TripStatus.COMPLETED && (
                <CardSection number={0} span={2} title="Lý do đề nghị thay đổi" subtitle="Yêu cầu sẽ được gửi để kiểm tra và phê duyệt">
                  <div className="tc-field">
                    <label className="tc-field-label" htmlFor="governanceReason">
                      Lý do <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>
                    </label>
                    <textarea
                      id="governanceReason"
                      className="input"
                      rows={3}
                      value={governanceReason}
                      onChange={(event) => setGovernanceReason(event.target.value)}
                      placeholder="Nêu căn cứ và nội dung cần thay đổi"
                      required
                    />
                  </div>
                </CardSection>
              )}
              <CardSection number={1} title="Tuyến đường & ngày" subtitle="Thời gian và tuyến vận chuyển">
                <div className="tc-field-row tc-field-row--2">
                  <div className="tc-field">
                    <UuiSelectField
                      id="customerId"
                      label="Khách hàng"
                      required
                      value={form.customerId}
                      onChange={(e) => form.setCustomerId(e.target.value)}
                      disabled={!catalogData || !canChangeCustomer}
                      options={[{ value: '', label: catalogData ? '-- Chọn khách hàng --' : 'Đang tải khách hàng…' }, ...editOptions.customers.map((customer) => ({ value: String(customer.id), label: customer.label }))]}
                      hint={canChangeCustomer ? 'Đổi khách hàng không tự cập nhật giá cước.' : 'Chỉ Quản lý hoặc Quản trị viên được đổi khách hàng.'}
                      wrapperClassName="tc-field"
                    />
                  </div>
                  <div className="tc-field">
                    <label className="tc-field-label">Ngày khởi hành <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span></label>
                    <DateInput
                      id="departureDate"
                      className="input"
                      value={departureDate}
                      onChange={setDepartureDate}
                      required
                    />
                  </div>
                  <div className="tc-field">
                    <label className="tc-field-label" htmlFor="routeId">Tuyến đường <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span></label>
                    <SearchableSelect
                      id="routeId"
                      value={routeId}
                      onChange={setRouteId}
                      options={searchableRoutes}
                      placeholder="Chọn tuyến đường"
                      searchPlaceholder="Tìm tuyến đường…"
                      emptyMessage="Không tìm thấy tuyến đường phù hợp."
                      disabled={!catalogData}
                      required
                    />
                  </div>
                  {(trip.status === TripStatus.IN_TRANSIT || trip.status === TripStatus.COMPLETED) && (
                    <div className="tc-field">
                      <label className="tc-field-label">Ngày hoàn thành</label>
                      <DateInput
                        id="completedAt"
                        className="input"
                        value={completedAt}
                        onChange={setCompletedAt}
                        max={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`}
                      />
                      <div className="tc-field-hint">Để trống nếu chưa hoàn thành</div>
                    </div>
                  )}
                  <div className="tc-field">
                    <label className="tc-field-label">Loại xe</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => form.setCarrierType('OWN')}
                        className={`btn btn--sm${form.carrierType === 'OWN' ? ' btn--primary' : ' btn--secondary'}`}
                      >
                        Xe nhà
                      </button>
                      <button
                        type="button"
                        onClick={() => form.setCarrierType('EXTERNAL')}
                        className={`btn btn--sm${form.carrierType === 'EXTERNAL' ? ' btn--primary' : ' btn--secondary'}`}
                      >
                        Xe ngoài
                      </button>
                    </div>
                  </div>
                  <div className="tc-field">
                    <UuiSelectField
                      id="plannedContainerTypeId"
                      label="Loại container"
                      required
                      value={plannedContainerTypeId}
                      onChange={(e) => setPlannedContainerTypeId(e.target.value)}
                      options={[{ value: '', label: '-- Chọn loại container --' }, ...editOptions.containerTypes.map((type) => ({ value: String(type.id), label: type.label }))]}
                      hint="Số container/seal cập nhật ở Chi tiết container."
                      wrapperClassName="tc-field"
                    />
                  </div>
                </div>

                {form.carrierType === 'OWN' && (
                  <div className="tc-field-row tc-field-row--3" style={{ marginTop: 14 }}>
                    <div className="tc-field">
                      <UuiSelectField
                        id="truckId"
                        label="Xe đầu kéo"
                        required
                        value={form.truckId}
                        onChange={(e) => form.setTruckId(e.target.value)}
                        options={[{ value: '', label: '-- Chọn xe đầu kéo --' }, ...editOptions.trucks.map((t) => ({ value: String(t.id), label: t.label }))]}
                        wrapperClassName="tc-field"
                      />
                    </div>
                    <div className="tc-field">
                      <UuiSelectField
                        id="trailerType"
                        label="Loại rơ moóc"
                        required
                        value={form.trailerType}
                        onChange={(e) => form.setTrailerType(e.target.value)}
                        options={[{ value: '', label: '-- Chọn loại rơ moóc --' }, ...editOptions.trailerTypes.map((o) => ({ value: o.value, label: o.label }))]}
                        wrapperClassName="tc-field"
                      />
                    </div>
                    <div className="tc-field">
                      <UuiSelectField
                        id="driverId"
                        label="Lái xe"
                        required
                        value={form.driverId}
                        onChange={(e) => form.setDriverId(e.target.value)}
                        options={[{ value: '', label: '-- Chọn lái xe --' }, ...editOptions.drivers.map((d) => ({ value: String(d.id), label: d.label }))]}
                        wrapperClassName="tc-field"
                      />
                    </div>
                  </div>
                )}
              </CardSection>

              <JourneyLegsCard number={2} />

              {form.carrierType === 'EXTERNAL' ? (
                <>
                  <CardSection number={3} title="Thông tin xe ngoài" subtitle="Đối tác vận tải, biển số và lái xe ngoài">
                    <div className="tc-field-row tc-field-row--2">
                      <div className="tc-field">
                        <UuiSelectField
                          id="externalCarrierId"
                          label="Đối tác vận chuyển"
                          value={form.externalCarrierId === null || form.externalCarrierId === undefined ? '' : String(form.externalCarrierId)}
                          onChange={(e) => form.setExternalCarrierId(e.target.value ? Number(e.target.value) : null)}
                          options={[{ value: '', label: '-- Chọn đối tác --' }, ...editOptions.carrierCustomers.map(c => ({ value: String(c.id), label: c.label }))]}
                          wrapperClassName="tc-field"
                        />
                      </div>
                      <div className="tc-field">
                        <label className="tc-field-label">Giá cước thuê ngoài (gồm VAT) <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span></label>
                        <InputWithPrefix
                          id="externalFreightCost"
                          value={form.externalFreightCost}
                          onChange={form.setExternalFreightCost}
                          placeholder="Ví dụ: 5.000.000"
                          prefix="đ"
                          type="money"
                          mono
                        />
                      </div>
                    </div>
                    <div className="tc-field-row tc-field-row--3">
                      <div className="tc-field">
                        <label className="tc-field-label">Biển số xe <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span></label>
                        <input
                          id="externalPlateNumber"
                          className="input mono"
                          type="text"
                          placeholder="Ví dụ: 29A-12345"
                          value={form.externalPlateNumber}
                          onChange={(e) => form.setExternalPlateNumber(e.target.value)}
                        />
                      </div>
                      <div className="tc-field">
                        <label className="tc-field-label">Tên lái xe <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span></label>
                        <input
                          id="externalDriverName"
                          className="input"
                          type="text"
                          placeholder="Tên lái xe"
                          value={form.externalDriverName}
                          onChange={(e) => form.setExternalDriverName(e.target.value)}
                        />
                      </div>
                      <div className="tc-field">
                        <label className="tc-field-label">SĐT lái xe <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span></label>
                        <input
                          id="externalDriverPhone"
                          className="input mono"
                          type="tel"
                          placeholder="Ví dụ: 0912345678"
                          value={form.externalDriverPhone}
                          onChange={(e) => form.setExternalDriverPhone(e.target.value)}
                        />
                      </div>
                    </div>
                  </CardSection>

                  <CardSection number={4} title="Doanh thu &amp; Hoa hồng" subtitle="Doanh thu đóng/trả cont, kết hợp và hoa hồng">
                    <div className="tc-field-row tc-field-row--2">
                      <div className="tc-field">
                        <label className="tc-field-label">Doanh thu đóng/ trả hàng (đ)</label>
                        <InputWithPrefix
                          placeholder="Ví dụ: 4.200.000"
                          value={form.revenueEmptyReturn}
                          onChange={form.setRevenueEmptyReturn}
                          prefix="đ"
                          type="money"
                          mono
                        />
                      </div>
                      <div className="tc-field">
                        <label className="tc-field-label">Doanh thu kết hợp (đ)</label>
                        <InputWithPrefix
                          placeholder="Ví dụ: 2.000.000"
                          value={form.revenueCombine}
                          onChange={form.setRevenueCombine}
                          prefix="đ"
                          type="money"
                          mono
                        />
                      </div>
                    </div>
                    <div className="tc-field-row">
                      <div className="tc-field">
                        <label className="tc-field-label">Hoa hồng khách hàng (đ)</label>
                        <InputWithPrefix
                          placeholder="0"
                          value={form.customerCommission}
                          onChange={form.setCustomerCommission}
                          prefix="đ"
                          type="money"
                          mono
                        />
                      </div>
                    </div>
                  </CardSection>
                </>
              ) : (
                <>
                  <CardSection number={3} title="Nhiên liệu" subtitle="Chế độ tính và bổ sung">
                    <FuelSection />
                  </CardSection>

                  <CardSection number={4} title="Chi phí &amp; Doanh thu" subtitle="VéBOT, phụ cấp, lương lái xe">
                    <AllowanceSection />
                  </CardSection>
                </>
              )}

              <CardSection number={5} span={2} title="Chi tiết container" subtitle="Số container, số seal, trọng lượng — nhập tay từng cont">
                <ContainerInstancesCard
                  tripId={trip.id}
                  expectedCount={trip.containerCount ?? 1}
                  requiresPhotos={!!trip.cargoType?.requiresPhotos}
                />
              </CardSection>

              <CardSection number={6} title="Ảnh & Ghi chú" subtitle="Ảnh đính kèm & ghi chú chuyến">
                <PhotoUploader tripId={trip.id} />
                <div className="tc-field">
                  <label className="tc-field-label">Ghi chú chuyến đi</label>
                  <textarea
                    className="input tc-textarea"
                    placeholder="Ghi chú chi tiết chuyến đi, các sự cố phát sinh…"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
              </CardSection>

              <CardSection number={7} span={2} title="Dịch vụ đi kèm" subtitle="Phí nâng/hạ, hải quan, cân hàng, kiểm hóa… để lên giấy báo nợ">
                <AncillaryFeesCard tripId={trip.id} />
              </CardSection>

              <CardSection number={8} span={2} title="Liên hệ & hướng dẫn" subtitle="Thông tin liên hệ và dặn dò cho lái xe (N2)">
                <TripInstructionsCard />
              </CardSection>
            </div>

            <aside className="tc-rail">
              <TotalsPanel />

              <div className="tc-rail-actions desktop-only">
                {error ? (
                  <div role="alert" className="tc-rail-error">
                    <div className="tc-rail-error-title">Không lưu được</div>
                    <div>{error}</div>
                  </div>
                ) : (
                  <div className="tc-rail-notice">
                    <div className="tc-rail-notice-title">Cập nhật số liệu</div>
                    <div>Lệnh vận chuyển {trip.tripCode || 'Lệnh vận chuyển'}</div>
                  </div>
                )}

                <button
                  type="submit"
                  form="trip-edit-form"
                  data-tour-id="trip-edit-financial-submit"
                  className="btn btn--primary tc-rail-btn tc-rail-btn--primary"
                  disabled={submitting || isAnyUploading(uploading)}
                >
                  {submitting ? (
                    <><Loader2 size={16} className="spin" /> Đang lưu…</>
                  ) : (
                    <><Save size={16} /> Lưu cập nhật</>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary tc-rail-btn tc-rail-btn--secondary"
                  onClick={handleBack}
                  disabled={submitting}
                >
                  Hủy bỏ
                </button>
              </div>
            </aside>
          </div>
        </form>

        {confirmDialog}

        <div className="tc-edit-mobile-bar">
          <button
            type="button"
            className="btn btn--secondary tc-mobile-btn"
            onClick={handleBack}
            disabled={submitting}
          >
            Hủy
          </button>
          <button
            type="submit"
            form="trip-edit-form"
            data-tour-id="trip-edit-financial-submit"
            className="btn btn--primary tc-mobile-btn tc-mobile-btn--primary"
            disabled={submitting || isAnyUploading(uploading)}
          >
            {submitting ? <><Loader2 size={16} className="spin" /> Đang lưu…</> : <><Save size={16} /> Lưu</>}
          </button>
        </div>
      </div>
    </TripFormProvider>
  );
}
