import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Loader2,
  ShieldAlert,
  StickyNote,
  Zap,
} from 'lucide-react';
import { DriverProgressEventType } from '@tingting/shared';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import { DriverContainerCard } from '../components/trip/DriverContainerCard';
import { DriverTripHeader } from './driver/DriverTripHeader';
import { DriverTaskInfoSections } from './driver/DriverTaskInfoSections';
import { podRequiredFilesReady } from '../lib/podReadiness';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useDriverTaskDetail, useDriverTaskProgress } from '../hooks/useDriverQueries';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../api/keys';
import { driverClient, type DriverTaskDetail, type DriverTaskPodSubmission } from '../api/driverClient';
import { getAuthenticatedPhotoUrl } from '../lib/api';
import { compressImageFile } from '../lib/imageCompression';
import { formatCurrency } from '../lib/format';
import { useOnline } from '../hooks/useOnline';
import { useGeolocation } from '../hooks/useGeolocation';
import { buildIdempotencyKey } from '../lib/idempotency';
import { useToast } from '../components/shared/Toast';
import { AccountingLockBanner } from '../components/shipment/AccountingLockBanner';
import { ContainerScanner, dataUrlToFile } from '../components/shared/ContainerScanner';
import './DriverTripDetailPage.css';

import { MILESTONES, FUEL_EVIDENCE_OUTCOME_LABELS, FUEL_EVIDENCE_REVIEW_LABELS, completeCtaLabel, fuelEvidenceUploadErrorMessage, getLatestMilestoneEvent, milestoneActionState, type MilestoneType, formatDateTime } from '../features/driver/driver-trip-model';
import { parseDriverTaskNote } from '@tingting/shared';

export default function DriverTripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const online = useOnline();
  const geolocation = useGeolocation();
  const [uploadingFuelEvidence, setUploadingFuelEvidence] = useState(false);
  const [fuelScanning, setFuelScanning] = useState(false);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [blockingTripCode, setBlockingTripCode] = useState<string | null>(null);
  const [blockingFulfillmentId, setBlockingFulfillmentId] = useState<number | null>(null);

  const tripId = Number(id);
  const validTripId = Number.isInteger(tripId) && tripId > 0 ? tripId : undefined;

  // Card 20260915_1: the route id is a TRIP id. The trip payload carries
  // fulfillmentId (null on ad-hoc trips — those render without fulfillment
  // sections and never call fulfillment-scoped endpoints).
  const tripQuery = useQuery({
    queryKey: qk.driver.tripBasic(validTripId),
    queryFn: () => driverClient.getDriverTrip(validTripId as number),
    enabled: validTripId != null,
  });
  const validFulfillmentId = tripQuery.data?.fulfillmentId ?? undefined;

  const taskDetail = useDriverTaskDetail(validFulfillmentId);
  const progress = useDriverTaskProgress(validFulfillmentId);
  const { rootRef } = usePageAnimations({
    ready: !taskDetail.isLoading && !progress.isLoading,
  });

  const handleBack = useCallback(() => navigate('/my-trips'), [navigate]);
  useBackShortcut(handleBack);

  const refetchDetail = taskDetail.refetch;
  const refetchProgress = progress.refetch;
  const refreshAll = useCallback(async () => {
    await Promise.all([refetchDetail(), refetchProgress()]);
  }, [refetchDetail, refetchProgress]);

  const trip = taskDetail.data as DriverTaskDetail | undefined;
  const currentSubmission = (trip?.currentPod ?? null) as DriverTaskPodSubmission | null;

  const latestCompletedIndex = useMemo(() => {
    let index = -1;
    for (const [milestoneIndex, milestone] of MILESTONES.entries()) {
      if (getLatestMilestoneEvent(progress.data, milestone.eventType)) {
        index = milestoneIndex;
      }
    }
    return index;
  }, [progress.data]);

  const nextMilestoneIndex = latestCompletedIndex >= MILESTONES.length - 1 ? -1 : latestCompletedIndex + 1;

  const operationNote = useMemo(() => parseDriverTaskNote(
    trip?.fulfillment?.driverNotes ?? '',
    trip?.knownTagLabels ?? [],
  ), [trip?.fulfillment?.driverNotes, trip?.knownTagLabels]);
  const operationTags = operationNote.selectedLabels;

  async function handleMilestone(eventType: MilestoneType) {
    if (!trip || !validFulfillmentId || !online || ['COMPLETED', 'CANCELLED'].includes(trip.status)) return;
    const milestoneIndex = MILESTONES.findIndex((milestone) => milestone.eventType === eventType);
    if (milestoneIndex !== nextMilestoneIndex) return;
    const idempotencyKey = buildIdempotencyKey('driver', 'task', validFulfillmentId, 'milestone', eventType, 'version', trip.version);
    setAccepting(true);
    try {
      await driverClient.recordProgress(validFulfillmentId, {
        eventType,
        occurredAt: new Date().toISOString(),
        expectedVersion: trip.version,
        fulfillmentId: validFulfillmentId,
      }, idempotencyKey);
      await refreshAll();
      toast({ kind: 'success', message: 'Đã ghi nhận mốc tiến độ.' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Không thể gửi lệnh. Vui lòng thử lại.';
      // KP-087: detect blocking-trip rejection and surface the trip code
      const blockingMatch = msg.match(/Xe đang chạy chuyến\s+(.+?)\. Vui lòng/);
      setBlockingFulfillmentId(null);
      if (blockingMatch) {
        const code = blockingMatch[1];
        setBlockingTripCode(code);
        // Only the authenticated driver's board may supply a navigable ID.
        // A busy truck can belong to someone else's order; never guess a URL
        // from a trip code or expose an unrestricted trip lookup.
        try {
          const board = await driverClient.getJourneyBoard();
          const owned = board.items.find(item => item.tripCode === code && item.bucket !== 'HISTORY');
          if (owned) setBlockingFulfillmentId(owned.fulfillmentId);
        } catch {
          // Keep the specific reason and an honest dispatch handoff below.
        }
      } else {
        setBlockingTripCode(null);
      }
      toast({ kind: 'error', message: msg });
    } finally {
      setAccepting(false);
    }
  }

  async function handleUploadFuelEvidence(file: File) {
    if (!trip) return;
    if (!online) {
      toast({ kind: 'warning', message: 'Cần có mạng để gửi ảnh nhiên liệu cho kế toán.' });
      return;
    }
    setUploadingFuelEvidence(true);
    try {
      const location = await geolocation.awaitAccurateSample();
      const prepared = await compressImageFile(file, { timestamp: new Date() });
      await driverClient.uploadFuelEvidence({
        tripId: trip.id,
        file: prepared,
        location: {
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy,
          timestamp: location.timestamp,
          source: 'phone',
        },
      });
      await refreshAll();
      toast({ kind: 'success', message: 'Đã lưu ảnh nhiên liệu. Số liệu OCR chỉ dùng để tham khảo.' });
    } catch (error) {
      toast({ kind: 'error', message: fuelEvidenceUploadErrorMessage(error) });
    } finally {
      setUploadingFuelEvidence(false);
    }
  }

  // Spec A6: after a container save, refetch so the read-only bento view and
  // photo keys reflect the persisted row.
  function handleContainerSaved() {
    void refreshAll();
  }

  if (!validTripId) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback">
          <AlertTriangle size={28} />
          <p>Không thể xác định chuyến đi từ liên kết này.</p>
          <button type="button" className="driver-task-back" onClick={handleBack}>
            <ArrowLeft size={16} />
            <span>Quay lại danh sách</span>
          </button>
        </div>
      </div>
    );
  }

  if (tripQuery.isLoading) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback">
          <Loader2 size={24} className="spin" />
          <p>Đang tải chuyến…</p>
        </div>
      </div>
    );
  }

  // Gate on data, not error: a failed background refetch keeps the cached
  // trip usable (the driver sees the trip, refresh retries in the header).
  if (!tripQuery.data) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback">
          <AlertTriangle size={28} />
          <p>Không thể tải chuyến.</p>
          <div className="driver-task-feedback__actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void tripQuery.refetch()}>Thử lại</button>
            <button type="button" className="driver-task-back" onClick={handleBack}>
              <ArrowLeft size={16} />
              <span>Quay lại danh sách</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Ad-hoc trips carry fulfillmentId null — render a lean detail without the
  // fulfillment-scoped sections instead of a hard error.
  if (!validFulfillmentId) {
    const basic = tripQuery.data;
    return (
      <div className="driver-task-screen">
        <section className="driver-task-section">
          <div className="driver-task-section__head">
            <span>{basic.tripCode ?? `Chuyến #${basic.id}`}</span>
          </div>
          <p className="driver-task-empty">
            Lô hàng này chưa có đầu việc vận chuyển (ad-hoc) — không có cột mốc,
            ảnh POD hay chi phí để thực hiện. Vui lòng liên hệ điều vận khi cần.
          </p>
          <button type="button" className="driver-task-back" onClick={handleBack}>
            <ArrowLeft size={16} />
            <span>Quay lại danh sách</span>
          </button>
        </section>
      </div>
    );
  }

  if (taskDetail.isLoading) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback">
          <Loader2 size={24} className="spin" />
          <p>Đang tải tác vụ tài xế…</p>
        </div>
      </div>
    );
  }

  if (!trip || taskDetail.error) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback">
          <AlertTriangle size={28} />
          <p>Không thể tải lệnh vận chuyển này.</p>
          <div className="driver-task-feedback__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => void taskDetail.refetch()}
            >
              Thử lại
            </button>
            <button type="button" className="driver-task-back" onClick={handleBack}>
              <ArrowLeft size={16} />
              <span>Quay lại danh sách</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fulfillment = trip.fulfillment ?? null;
  const siteRules = fulfillment?.siteRules ?? [];
  // Khối 5 (spec): site rules plus the shipment-level note CUS wrote for the
  // driver ("note dành cho lái xe") — both belong on this section. When the
  // note is the tag-composed fulfillment note (format v2), the free-text part
  // renders here while the tag line lives in the chips section above; the
  // trip.memo fallback was never tag-composed, so it renders verbatim.
  const driverNotes = trip.fulfillment?.driverNotes != null
    ? (operationNote.manualText || null)
    : (trip.notes ?? null);
  // TC-DA-001: N ≥ 6 collapses to the first ~4 chips behind a Mở rộng/Thu gọn
  // toggle; N ≤ 5 renders fully expanded (no toggle needed).
  const shouldCollapseChips = operationTags.length >= 6;
  const visibleOperationTags = shouldCollapseChips && !chipsExpanded
    ? operationTags.slice(0, 4)
    : operationTags;
  const containerSealPhotos = fulfillment?.containerSealPhotos ?? [];
  const contPhotoKey = containerSealPhotos.find((p) => p.type === 'CONTAINER')?.storageKey ?? null;
  const sealPhotoKey = containerSealPhotos.find((p) => p.type === 'SEAL')?.storageKey ?? null;
  // 40f3ae15: biên bản giao hàng photo rides the same wire as type
  // DELIVERY_NOTE (latest row wins — the query orders by uploadedAt desc).
  const deliveryNotePhotoKey = containerSealPhotos.find((p) => p.type === 'DELIVERY_NOTE')?.storageKey ?? null;
  const accountingLock = trip.accountingLock ?? null;
  // Spec (Phần 4): the completion gate lives on the e-POD screen
  // (/my-trips/:id/pod) — this page only links there. The footer still
  // surfaces the two mandatory-photo gaps so the driver knows what is missing
  // before tapping through.
  const { hasYardReceipt, hasSignedNote, podReady } = podRequiredFilesReady(currentSubmission);
  const latestFuelEvidence = trip.fuelEvidenceReviews?.[0] ?? null;

  const acceptEvent = getLatestMilestoneEvent(progress.data, DriverProgressEventType.ORDER_RECEIVED);
  const acceptState = milestoneActionState(Boolean(acceptEvent), nextMilestoneIndex, 0);
  const showAcceptStickyBar = !['COMPLETED', 'CANCELLED'].includes(trip.status) && acceptState !== 'done';
  const acceptClickable = acceptState === 'available' && !accepting;
  const acceptButtonLabel = accepting ? 'Đang gửi…' : 'Nhận lệnh vận chuyển';

  return (
    <div ref={rootRef} className={`driver-task-screen${showAcceptStickyBar ? ' driver-task-screen--has-accept-bar' : ''}`}>
      <DriverTripHeader trip={trip} onBack={handleBack} />

      {!online && (
        <section className="driver-task-section driver-task-section--banner">
          <div className="driver-task-sync" role="status">
            <AlertTriangle size={16} />
            <div>
              <strong>Đang ngoại tuyến</strong>
              <p>Cần kết nối mạng để gửi lệnh. Vui lòng kiểm tra mạng và thử lại.</p>
            </div>
          </div>
        </section>
      )}

      {/* Spec Phần 3 / AC-DISPATCH-002: acceptance is direct while the Ops
          field-confirmation module is unfinished — guide the driver to check
          the order, then accept; keep the banner short and secondary to the
          accept action itself. */}
      {showAcceptStickyBar && acceptState === 'available' && (
        <section className="driver-task-section driver-task-section--banner" data-testid="bypass-ops-banner">
          <div className="driver-task-bypass">
            <Zap size={16} />
            <div>
              <strong>Kiểm tra thông tin chuyến rồi chọn Nhận lệnh</strong>
              <p>Sau khi nhận lệnh, chuyến bắt đầu.</p>
            </div>
          </div>
        </section>
      )}

      {accountingLock && <AccountingLockBanner lock={accountingLock} />}

      <fieldset disabled={Boolean(accountingLock)} className="driver-task-fieldset">

      <DriverTaskInfoSections trip={trip} />

      {/* Card _36 (paper-form spec): Tác vụ and Ghi chú are STRUCTURAL rows —
          they always render, filled from the saved dispatch note
          (driverTaskNote v2: tags segment → Tác vụ uppercase chips, manual
          text → Ghi chú) and show an empty state when the part is absent.
          N ≥ 6 chips collapse behind Mở rộng/Thu gọn. Same parseNote
          codepath as the /my-trips board cards. */}
      <section className="driver-task-section" data-testid="task-note-section">
        <div className="driver-task-section__head">
          <span>Tác vụ</span>
        </div>
        {operationTags.length > 0 ? (
          <div className="driver-task-ops" data-testid="operation-chips">
            {visibleOperationTags.map((tag) => (
              <span key={tag} className="driver-task-ops-chip" data-testid="operation-chip">{tag}</span>
            ))}
            {shouldCollapseChips && (
              <button type="button" className="driver-task-ops-toggle" onClick={() => setChipsExpanded((v) => !v)}>
                {chipsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                <span>{chipsExpanded ? 'Thu gọn' : 'Mở rộng'}</span>
              </button>
            )}
          </div>
        ) : (
          <p className="driver-task-empty">Không có tác vụ.</p>
        )}
        <div className="driver-task-section__head">
          <span>Ghi chú</span>
        </div>
        {driverNotes ? (
          <p className="driver-task-rules__note" data-testid="driver-task-driver-notes">
            <StickyNote size={16} />
            <span>{driverNotes}</span>
          </p>
        ) : (
          <p className="driver-task-empty">Không có ghi chú.</p>
        )}
      </section>

      <section className="driver-task-section">
        <DriverContainerCard
          tripId={trip.id}
          containers={trip.containers}
          contPhotoKey={contPhotoKey}
          sealPhotoKey={sealPhotoKey}
          deliveryNotePhotoKey={deliveryNotePhotoKey}
          tradeDirection={trip.tradeDirection ?? null}
          onSaved={handleContainerSaved}
        />
      </section>

      <section className="driver-task-section">
        <div className="driver-task-section__head">
          <span>Quy định tại điểm làm hàng</span>
        </div>
        {siteRules.length > 0 ? (
          <ul className="driver-task-rules">
            {siteRules.map((rule, index) => (
              <li key={`${index}-${rule}`} className="driver-task-rules__item">
                <ShieldAlert size={16} />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        ) : driverNotes ? null : (
          <p className="driver-task-empty">Chưa có ghi chú cho chuyến này.</p>
        )}
      </section>

      {/* Phần 4 ticket 2026-08-28: e-POD moved to its own screen
          (/my-trips/:id/pod) so the driver focuses on the two mandatory
          photos (Phiếu bãi/hạ + Biên bản giao nhận). The "Hoàn thành"
          CTA at the bottom navigates there. The cost-entry form is hidden
          here per the trial-readiness plan ("kế toán từ từ"). Backend
          schema + endpoints for both are retained for the post-trial phase. */}
      <section className="driver-task-section">
        <div className="driver-task-section__head">
          <span>Ảnh nhiên liệu</span>
        </div>
        <div className="driver-task-fuel-section">
          <div className="driver-task-fuel-card">
            <div className="driver-task-fuel-header">
              <div>
                <strong className="driver-task-fuel-title">Chụp màn hình bơm gần nhất</strong>
                <div className="driver-task-fuel-subtitle">
                  {latestFuelEvidence
                    ? `${FUEL_EVIDENCE_OUTCOME_LABELS[latestFuelEvidence.ocrOutcome]} · ${FUEL_EVIDENCE_REVIEW_LABELS[latestFuelEvidence.reviewStatus]}`
                    : 'Chưa có ảnh nhiên liệu nào cho chuyến này.'}
                </div>
              </div>
              <button
                type="button"
                className={`btn btn--secondary btn--sm driver-task-fuel-btn${uploadingFuelEvidence ? ' is-loading driver-task-fuel-loading' : ''}`}
                disabled={uploadingFuelEvidence}
                onClick={() => setFuelScanning(true)}
              >
                <Camera size={16} />
                <span>{latestFuelEvidence ? 'Chụp lại ảnh mới' : 'Chụp ảnh nhiên liệu'}</span>
              </button>
            </div>

            {!online && (
              <div className="driver-task-fuel-offline">
                Thiết bị đang ngoại tuyến. Ảnh nhiên liệu chỉ gửi được khi có mạng.
              </div>
            )}

            {latestFuelEvidence && (
              <div className="driver-task-fuel-details">
                <div className="driver-task-fuel-grid">
                  <img
                    src={getAuthenticatedPhotoUrl(latestFuelEvidence.photoUrl)}
                    alt={`Ảnh nhiên liệu ${trip.tripCode ?? trip.id}`}
                    className="driver-task-fuel-img"
                  />
                  <div className="driver-task-fuel-facts">
                    <div><strong>Thời điểm chụp:</strong> {formatDateTime(latestFuelEvidence.capturedAt)}</div>
                    <div><strong>Lít:</strong> {latestFuelEvidence.litres ?? '—'}</div>
                    <div><strong>Đơn giá:</strong> {latestFuelEvidence.unitPrice ? formatCurrency(latestFuelEvidence.unitPrice) : '—'}</div>
                    <div><strong>Thành tiền:</strong> {latestFuelEvidence.totalAmount ? formatCurrency(latestFuelEvidence.totalAmount) : '—'}</div>
                    <div><strong>Tính lại:</strong> {latestFuelEvidence.computedTotal ? formatCurrency(latestFuelEvidence.computedTotal) : '—'}</div>
                    <div>
                      <strong>GPS:</strong>
                      {latestFuelEvidence.latitude && latestFuelEvidence.longitude ? (
                        <span className="driver-task-fuel-gps-ok">
                          <CheckCircle2 size={13} /> Đã ghi nhận GPS
                        </span>
                      ) : 'Chưa có'}
                    </div>
                  </div>
                </div>
                {(latestFuelEvidence.anomalyReason || latestFuelEvidence.ocrError || latestFuelEvidence.reviewNote) && (
                  <div className="driver-task-fuel-notes">
                    {latestFuelEvidence.anomalyReason && <div><strong>Lưu ý OCR:</strong> {latestFuelEvidence.anomalyReason}</div>}
                    {latestFuelEvidence.ocrError && <div><strong>Lỗi OCR:</strong> {latestFuelEvidence.ocrError}</div>}
                    {latestFuelEvidence.reviewNote && <div><strong>Ghi chú kế toán:</strong> {latestFuelEvidence.reviewNote}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {trip.legs.length > 0 && (
        <section className="driver-task-section driver-task-section--legs">
          <div className="driver-task-section__head">
            <span>Lộ trình chi tiết</span>
          </div>
          <TripLegsPanel legs={trip.legs} />
        </section>
      )}

      {/* Phần 1 ticket: BOTH cost forms ("Nhập chi phí lô hàng" and "Báo cáo
          đổ dầu") are coded but temporarily hidden — kế toán tài chính is the
          post-trial phase. Backend schema + endpoints retained. 27.8's
          "GIỮ NGUYÊN" covers the fuel SCREENSHOT upload below, not this form. */}

      <footer className="driver-task-footer">
        <div className="driver-task-footer__body">
          <div className="driver-task-footer__summary">
            <strong>Hoàn tất lệnh vận chuyển</strong>
            <p>
              Tải đủ 2 ảnh e-POD bắt buộc trên màn e-POD, rồi bấm "HOÀN THÀNH CHUYẾN" ở đó — hệ thống
              gửi e-POD và chốt chuyến hoàn thành (CUS + Điều vận sẽ thấy trạng thái "Hoàn thành" ngay).
            </p>
            {(!hasYardReceipt || !hasSignedNote) && (
              <ul className="driver-task-footer__issues">
                {!hasYardReceipt && <li>Thiếu Phiếu bãi / phiếu hạ</li>}
                {!hasSignedNote && <li>Thiếu Biên bản giao nhận</li>}
              </ul>
            )}
          </div>
          {trip.status === 'IN_TRANSIT' ? (
            <button
              type="button"
              className="driver-task-complete"
              onClick={() => navigate(`/my-trips/${validFulfillmentId}/pod`)}
            >
              <FileCheck2 size={18} />
              <span>Hoàn tất lệnh vận chuyển</span>
            </button>
          ) : (
            <button type="button" className="driver-task-complete" disabled>
              <FileCheck2 size={18} />
              <span>{completeCtaLabel(trip.status)}</span>
            </button>
          )}
          {podReady && trip.status === 'IN_TRANSIT' && (
            <div className="driver-task-footer__ready">
              <CheckCircle2 size={16} />
              <span>Đủ điều kiện hoàn thành chuyến.</span>
            </div>
          )}
        </div>
      </footer>

      {showAcceptStickyBar && (
        <div className="driver-task-accept-sticky" data-testid="accept-sticky-bar">
          <div className="driver-task-accept-sticky__inner">
            <button
              type="button"
              className="driver-task-accept-sticky__btn"
              disabled={!acceptClickable}
              onClick={() => { setBlockingTripCode(null); void handleMilestone(DriverProgressEventType.ORDER_RECEIVED); }}
            >
              {accepting ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
              <span>{acceptButtonLabel}</span>
            </button>
          </div>
        </div>
      )}

      {/* KP-087: blocking-trip reference when acceptance is rejected */}
      {blockingTripCode && (
        <div className="driver-task-section driver-task-section--banner" role="alert" data-testid="blocking-trip-banner">
          <div className="driver-task-bypass" style={{ background: 'var(--err-bg, #fef2f2)', color: 'var(--err, #dc2626)' }}>
            <ShieldAlert size={16} />
            <div>
              <span>Xe đang chạy chuyến <strong>{blockingTripCode}</strong> — hoàn thành chuyến đó trước khi nhận lệnh mới.</span>
              <div>
                {blockingFulfillmentId != null
                  ? <Link className="driver-task-link" to={`/my-trips/${blockingFulfillmentId}`}>Mở chuyến đang chạy</Link>
                  : <span>Liên hệ điều vận để xử lý chuyến đang chạy. Chỉ thử nhận lại khi xe đã sẵn sàng.</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      </fieldset>

      {fuelScanning && (
        <ContainerScanner
          onCapture={(dataUrl) => {
            setFuelScanning(false);
            void handleUploadFuelEvidence(dataUrlToFile(dataUrl, 'fuel-pump.jpg'));
          }}
          onClose={() => setFuelScanning(false)}
        />
      )}
    </div>
  );
}
