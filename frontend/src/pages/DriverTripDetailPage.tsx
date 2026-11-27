import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  FileCheck2,
  Loader2,
  Lock,
  ShieldAlert,
  StickyNote,
  Truck,
} from 'lucide-react';
import { DriverProgressEventType, TripStatus } from '@tingting/shared';
import { ShipmentCostEntryForm } from '../components/trip/ShipmentCostEntryForm';
import { DriverContainerCard } from '../components/trip/DriverContainerCard';
import { DriverTripHeader } from './driver/DriverTripHeader';
import { DriverTaskInfoSections, DriverTripRouteSection, DriverCostBreakdownSection } from './driver/DriverTaskInfoSections';
import { podRequiredFilesReady, missingRequiredPodFileTypes, missingPodFilesMessage } from '../lib/podReadiness';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useFixedActionClearance } from '../hooks/useFixedActionClearance';
import { useDriverScreenEntry } from '../features/driver/useDriverScreenEntry';
import { useDriverTaskDetail, useDriverTaskProgress, useDriverJourneyBoard } from '../hooks/useDriverQueries';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '../api/keys';
import { driverClient, type DriverTaskDetail, type DriverTaskPodSubmission } from '../api/driverClient';
import { formatDate } from '../lib/format';
import { buildIdempotencyKey } from '../lib/idempotency';
import { useToast } from '../components/shared/Toast';
import { toastActionError } from '../lib/api/action-error';
import { useConfirm } from '../components/UI';
import { AccountingLockBanner } from '../components/shipment/AccountingLockBanner';
import './DriverTripDetailPage.css';

import { MILESTONES, completeCtaLabel, completionMilestoneGate, formatDateTime, getLatestMilestoneEvent, milestoneActionState, type MilestoneType, PAIR_LOCKED_MESSAGE, isTripPairLocked, tagLabelFor } from '../features/driver/driver-trip-model';
import { parseDriverTaskNote } from '@tingting/shared';

export default function DriverTripDetailPage() {
  const { id } = useParams<{ id: string }>();
  // A different order owns a fresh editor, feedback and photo-viewer session.
  return <DriverTripDetailContent key={id} />;
}

function DriverTripDetailContent() {
  const { id } = useParams<{ id: string }>();
  useDriverScreenEntry(id);
  const actionBarRef = useFixedActionClearance<HTMLDivElement>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const journeyBoard = useDriverJourneyBoard();
  const [accepting, setAccepting] = useState(false);
  const [completing, setCompleting] = useState(false);
  // Card 20260926_30 item 16: saved cost-entry count reported by the cost
  // form so the top progress strip can show it without scrolling.
  const [costEntryCount, setCostEntryCount] = useState(0);
  // QA: while the inline [+ Thêm chi phí] form is expanded, the fixed
  // bottom action bars would paint over the form's own Hủy / Lưu tất cả
  // row — both bars hide for as long as the form is open.
  const [costFormOpen, setCostFormOpen] = useState(false);

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

  // The site-rules block clamps long text (dense-display law: the block never
  // owns half the screen). Overflow is measured from the rendered list, so
  // short rule sets never grow a reveal control.
  const siteRules = trip?.fulfillment?.siteRules ?? [];
  const [siteRulesExpanded, setSiteRulesExpanded] = useState(false);
  const [siteRulesExpandable, setSiteRulesExpandable] = useState(false);
  const siteRulesListRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    const el = siteRulesListRef.current;
    if (!el) return;
    setSiteRulesExpandable(el.scrollHeight > el.clientHeight + 1);
  }, [siteRules]);

  // K10.22 (SIL-947): the journey board's per-container "Sửa số cont i/n"
  // buttons land here with ?cont=N — scroll the Nth container row of the
  // Số cont & seal card into view and flash it, then consume the param so a
  // back/forward cycle never replays the scroll. Respects the house
  // reduced-motion law (auto scroll when the user opted out of animation).
  const [searchParams, setSearchParams] = useSearchParams();
  const contParam = searchParams.get('cont');
  const contConsumedRef = useRef(false);
  useEffect(() => {
    if (contParam == null || contConsumedRef.current) return;
    if (!trip || taskDetail.isLoading || taskDetail.error) return;
    if (trip.fulfillment?.modeLabel === 'LCL') return; // no container card on hàng lẻ
    const index = Number(contParam) - 1;
    if (!Number.isInteger(index) || index < 0) {
      setSearchParams({}, { replace: true });
      return;
    }
    contConsumedRef.current = true;
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-cont-index="${index}"]`);
      const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      if (target) {
        target.classList.add('dcc-bento__item--flash');
        window.setTimeout(() => target.classList.remove('dcc-bento__item--flash'), 1600);
      }
    });
    setSearchParams({}, { replace: true });
  }, [contParam, trip, taskDetail.isLoading, taskDetail.error, setSearchParams]);

  // SIL-652 (id 758): match the journey board's pair lock so list and detail
  // stay consistent. The L2 card stays locked until L1 completes.
  const journeyCard = useMemo(() => {
    return journeyBoard.data?.items?.find((item) =>
      (validTripId != null && item.tripId === validTripId) ||
      (validFulfillmentId != null && item.fulfillmentId === validFulfillmentId)
    );
  }, [journeyBoard.data?.items, validTripId, validFulfillmentId]);
  // CR-011 Task 5.1: Other active (RUNNING) trips for this driver — displayed as a
  // non-blocking Soft Notice when viewing a new order, while keeping Accept enabled.
  const otherRunningTrips = useMemo(() => {
    return (journeyBoard.data?.items ?? []).filter((item) =>
      item.bucket === 'RUNNING'
      && (validTripId == null || item.tripId !== validTripId)
      && (validFulfillmentId == null || item.fulfillmentId !== validFulfillmentId)
    );
  }, [journeyBoard.data?.items, validTripId, validFulfillmentId]);
  const pairLocked = isTripPairLocked(journeyCard);
  // SIL-636 — the [KẸP]/[KẾT HỢP] tag rides the container number. Resolution
  // mirrors the journey list exactly (shared tagLabelFor): the detail wire's
  // ACTIVE pairKind is primary, and when the wire carries no pair the board
  // card's classification/linked fallbacks decide — so a card tagged KẸP/
  // KẾT HỢP on the list keeps its tag here (QA round-3b: DOUBLE-classified
  // cards showed no tag on detail). Never a Trip_ID: the ruling keeps internal
  // ids off the driver UI; partnerTripId stays a wire-only key.
  // SIL-815 — the classification LABEL itself (ĐƠN/KẸP/KẾT HỢP/LẺ/LẤY LẺ)
  // now rides the detail header too: the AC says the label on the card and
  // its detail must match 100%, and the QA fail of 13/11 (R3P-677-R) showed
  // ĐƠN living only on the card. One resolution, two renderings: the plain
  // label in the header (classificationTag below), the bracketed variant
  // beside the container number (pair kinds only — SIL-636 ruling intact).
  const classificationTag = useMemo(() => {
    if (trip?.pairKind === 'KEP') return 'KẸP';
    if (trip?.pairKind === 'KET_HOP') return 'KẾT HỢP';
    return tagLabelFor(journeyCard);
  }, [trip?.pairKind, journeyCard]);
  const pairTagLabel = classificationTag === 'KẸP' || classificationTag === 'KẾT HỢP'
    ? `[${classificationTag}]`
    : null;
  const completed = trip?.status === TripStatus.COMPLETED;
  const cancelled = trip?.status === TripStatus.CANCELED;
  const closed = completed || cancelled;
  const currentSubmission = (trip?.currentPod ?? null) as DriverTaskPodSubmission | null;
  // SIL-918 (KB §3.5.2/§3.6.1, audit 24/11): hàng lẻ carries no container —
  // the driver screen drops the FCL "Số cont & seal" frame and the FCL
  // evidence slot ("Phiếu bãi / phiếu hạ") for LCL trips.
  const isLcl = trip?.fulfillment?.modeLabel === 'LCL';
  // SIL-768 (09/11, customer CR-006): the Ảnh nhiên liệu block is REMOVED from
  // the detail screen — the feature moves to a dedicated fleet fuel-norm
  // module later. Recorded fuel evidence rows are untouched (data stays);
  // the upload endpoint and the kế toán review surface keep working.

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
  // SIL-767 (09/11, customer CR-006): the Tác vụ chips block is gone from the
  // detail screen — operationNote survives for its manualText (Ghi chú) only.

  async function handleMilestone(eventType: MilestoneType) {
    if (!trip || !validFulfillmentId || closed) return;
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
      // SIL-1053 — the strip (and the accept/complete bars) read progress +
      // detail; refetch both so the just-recorded stage flips to its done
      // state with the server's timestamp instead of waiting for a refocus.
      await refreshAll();
      // A successful action stands on its own — no banner premise to clear
      // (CR-011 removed the 409-driven blocking banner entirely).
      toast({ kind: 'success', message: 'Đã ghi nhận mốc tiến độ.' });
    } catch (error) {
      // CR-011 §8.1.2 — the driver-owned path no longer emits
      // DRIVER_TRIP_BLOCKED (another running trip is the soft notice above),
      // so a failure here is an ordinary action error.
      toastActionError(toast, 'ghi nhận mốc tiến độ', error, 'Không thể gửi lệnh. Vui lòng thử lại.');
    } finally {
      setAccepting(false);
    }
  }

  // Spec A6: after a container save, refetch so the read-only bento view and
  // photo keys reflect the persisted row.
  function handleContainerSaved() {
    void refreshAll();
  }

  // SIL-638 TC9 (id 742): completing transport order directly from the detail
  // screen. Owner law (card 261022213755a 22/10, reaffirmed 07/11 — "ảnh tùy
  // chọn, 0 ảnh vẫn hoàn thành chuyến"): completion NEVER blocks on missing
  // e-POD photos. The two required evidence types stay enforced on the
  // explicit e-POD submit path only (SIL-697, DriverTripPodPage) — here an
  // incomplete DRAFT is simply NOT auto-submitted (nothing freezes, files can
  // still be added and nộp'd later); the trip completes regardless.
  async function handleCompleteTrip() {
    if (!trip || !validFulfillmentId || closed || completing) return;
    if (trip.status !== 'IN_TRANSIT') {
      toast({ kind: 'warning', message: 'Chuyến không ở trạng thái đang chạy để hoàn thành.' });
      return;
    }
    if (trip.accountingLock) {
      toast({ kind: 'warning', message: 'Lô hàng đã khóa kế toán. Không thể hoàn thành chuyến.' });
      return;
    }

    const confirmed = await confirm('Xác nhận hoàn tất?', {
      variant: 'primary',
      confirmLabel: 'Hoàn tất',
    });
    if (!confirmed) return;

    setCompleting(true);
    try {
      const draftSubmission = currentSubmission?.status === 'DRAFT' ? currentSubmission : null;
      const draftHasBothTypes = draftSubmission != null
        && missingRequiredPodFileTypes(draftSubmission, trip?.fulfillment?.modeLabel).length === 0;
      if (draftHasBothTypes) {
        const idempotencyKey = buildIdempotencyKey(
          'driver', 'task', validFulfillmentId,
          'pod-submit', draftSubmission.id, 'version', draftSubmission.version,
        );
        await driverClient.submitPod(
          validFulfillmentId,
          draftSubmission.id,
          { expectedVersion: draftSubmission.version },
          idempotencyKey,
        );
      }
      const completeKey = buildIdempotencyKey(
        'driver', 'task', validFulfillmentId, 'complete', 'version', trip.version,
      );
      await driverClient.completeTrip(validFulfillmentId, { expectedVersion: trip.version }, completeKey);
      await queryClient.invalidateQueries({ queryKey: qk.driver.journeyBoard });
      await queryClient.invalidateQueries({ queryKey: qk.driver.pairedOrders });
      toast({ kind: 'success', message: 'Hoàn tất chuyến hàng thành công!' });
      navigate('/my-trips', { replace: true });
    } catch (error) {
      toastActionError(toast, 'hoàn thành chuyến', error, 'Không thể hoàn thành chuyến. Vui lòng thử lại.');
    } finally {
      setCompleting(false);
    }
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
            {/* Business descriptor first on the ad-hoc screen: customer, route,
                or the ad-hoc journey label — the internal TRP code never
                renders as this title. */}
            <span>{[basic.customerName ?? basic.routeName ?? 'Hành trình ad-hoc', basic.truckPlate ?? '', basic.departureDate ? formatDate(basic.departureDate) : ''].filter(Boolean).join(' · ')}</span>
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
  // Khối 5 (spec): site rules plus the shipment-level note CUS wrote for the
  // driver ("note dành cho lái xe") — both belong on this section. When the
  // note is the tag-composed fulfillment note (format v2), the free-text part
  // renders here while the tag line lives in the chips section above; the
  // trip.memo fallback was never tag-composed, so it renders verbatim.
  const driverNotes = trip.fulfillment?.driverNotes != null
    ? (operationNote.manualText || null)
    : (trip.notes ?? null);
  const containerSealPhotos = fulfillment?.containerSealPhotos ?? [];
  const contPhotoKey = containerSealPhotos.find((p) => p.type === 'CONTAINER')?.storageKey ?? null;
  const sealPhotoKey = containerSealPhotos.find((p) => p.type === 'SEAL')?.storageKey ?? null;
  // EVERY biên bản giao hàng photo rides the same wire (the query orders by
  // uploadedAt desc). The old `.find()` kept only the latest row and silently
  // hid the driver's earlier uploads — each upload is its own trip_photos row,
  // so all of them render.
  const deliveryNotePhotoKeys = containerSealPhotos
    .filter((p) => p.type === 'DELIVERY_NOTE')
    .map((p) => p.storageKey);
  const accountingLock = trip.accountingLock ?? null;
  // Spec (Phần 4): the completion gate lives on the e-POD screen
  // (/my-trips/:id/pod) — this page also completes directly via the sticky
  // CTA. SIL-733 r2 (22/10 law, reaffirmed 07/11): photos are OPTIONAL on
  // this CTA — completion never blocks on missing e-POD files. These flags
  // only feed the Chứng từ card copy so the driver knows what is still
  // missing; upload them on the e-POD screen any time.
  const { hasYardReceipt, hasSignedNote } = podRequiredFilesReady(currentSubmission, trip?.fulfillment?.modeLabel);

  // Card 20260926_28 item 10: live completion state for the sticky bar (and
  // the top progress strip). SIL-733 r2: the strip NAMES the missing docs
  // (informational) — it never disables completion. SIL-918: the strip
  // counts the MODE'S OWN evidence set — "have" = required minus missing,
  // so the vacuous LCL yard flag can never fake a satisfied slot — and the
  // photo counter drops with the Số cont & seal card.
  const podRequired = isLcl ? 1 : 2;
  const podMissingCount = missingRequiredPodFileTypes(currentSubmission, trip?.fulfillment?.modeLabel).length;
  const podHave = Math.max(0, podRequired - podMissingCount);
  const photoTypes = new Set(containerSealPhotos.map((p) => p.type));
  const photoHave = ['CONTAINER', 'SEAL', 'DELIVERY_NOTE'].filter((type) => photoTypes.has(type as never)).length;
  // Card 061026043643: the counter reports UPLOADED PHOTOS, not filled zones —
  // two biên bản uploads read "Ảnh 2/3", not "1/3". Denominator stays 3 (the
  // three capture zones); done state keeps the zones-full meaning.
  const photoCount = containerSealPhotos.length;

  // SIL-1053 (K2.42) — per-stage evidence chips, built from data the page
  // already holds: container photos ride Lấy vỏ / Lấy hàng, the biên bản
  // photos ride Đóng / Trả hàng, the two required POD docs ride Hạ bãi /
  // Giao hàng. LCL carries no container card (SIL-918) — its delivery-note
  // evidence lives on the e-POD screen, so the container-side stages show no
  // chips and the delivery stage keeps only the one required doc.
  const milestoneEvidence: Record<MilestoneType, Array<{ label: string; ok: boolean }>> = {
    [DriverProgressEventType.ORDER_RECEIVED]: [],
    [DriverProgressEventType.PICKED_UP]: isLcl ? [] : [
      { label: 'Ảnh cont', ok: Boolean(contPhotoKey) },
      { label: 'Ảnh seal', ok: Boolean(sealPhotoKey) },
    ],
    [DriverProgressEventType.LOADING_OR_RETURNING]: isLcl ? [] : [
      { label: 'Ảnh biên bản', ok: deliveryNotePhotoKeys.length > 0 },
    ],
    [DriverProgressEventType.DELIVERED]: isLcl
      ? [{ label: 'Biên bản giao nhận', ok: hasSignedNote }]
      : [
        { label: 'Phiếu bãi / phiếu hạ', ok: hasYardReceipt },
        { label: 'Biên bản giao nhận', ok: hasSignedNote },
      ],
  };

  const acceptEvent = getLatestMilestoneEvent(progress.data, DriverProgressEventType.ORDER_RECEIVED);
  const acceptState = milestoneActionState(Boolean(acceptEvent), nextMilestoneIndex, 0);
  // SIL-1053 (K2.42, r28d) — completion is the LAST milestone: on the
  // driver's self-recorded flow (Nhận lệnh đã ghi) the Hoàn tất CTA waits for
  // the full strip and its tooltip names what is missing. The dispatch-started
  // escape hatch (no ORDER_RECEIVED — SIL-817 running-trip law) stays
  // untouched — the BE infers the missing milestones on completion.
  const milestoneGate = completionMilestoneGate((progress.data?.items ?? []).map((item) => item.eventType));
  const milestoneGatedComplete = milestoneGate.gated;
  // SIL-817 (id 946, PROD 13/11): the completion command renders by TRIP
  // STATUS, never by whether the dispatch handoff found a handler. An
  // IN_TRANSIT trip is physically running — its Hoàn tất CTA must be
  // reachable even when ORDER_RECEIVED was never recorded (ops started the
  // trip via "Điều phối", handoff UNSEEN/handler NULL; the backend infers
  // the acceptance on completion). The one exception keeps TC8 law: an
  // unaccepted Lệnh 2 of an ACTIVE KẾT HỢP pair stays locked behind its
  // DOC-message accept bar until Lệnh 1 finishes.
  const runningUnaccepted = !closed && trip.status === 'IN_TRANSIT' && acceptState !== 'done';
  const showCompleteStickyBar = !closed
    && (trip.status === 'IN_TRANSIT' || acceptState === 'done')
    && !(runningUnaccepted && pairLocked);
  const showAcceptStickyBar = !closed && acceptState !== 'done' && !showCompleteStickyBar;
  const acceptClickable = acceptState === 'available' && !accepting && !pairLocked;
  const acceptButtonLabel = accepting ? 'Đang gửi…' : 'Nhận lệnh vận chuyển';

  return (
    <div ref={rootRef} className={`driver-task-screen${showAcceptStickyBar ? ' driver-task-screen--has-accept-bar' : ''}${showCompleteStickyBar ? ' driver-task-screen--has-complete-bar' : ''}`}>
      <DriverTripHeader trip={trip} classificationTag={classificationTag} onBack={handleBack} />

      {/* Card 20260926_30 item 16: compact progress strip at the top — the
          driver sees what is missing without scrolling. Counts: POD docs
          (phiếu bãi/hạ + biên bản giao nhận — the completion gate), photos
          (cont + seal + biên bản — the container card's capture zones), and
          saved cost entries. Incomplete groups warn, complete groups show
          ok. */}
      <div className="driver-task-progress" data-testid="driver-task-progress">
        <span className={`driver-task-progress__item${podHave >= podRequired ? ' driver-task-progress__item--done' : ' driver-task-progress__item--open'}`} data-testid="progress-pod">Chứng từ {podHave}/{podRequired}</span>
        {!isLcl && (
          <span className={`driver-task-progress__item${photoHave >= 3 ? ' driver-task-progress__item--done' : ' driver-task-progress__item--open'}`} data-testid="progress-photos">Ảnh {photoCount}/3</span>
        )}
        <span className="driver-task-progress__item" data-testid="progress-costs">Chi phí {costEntryCount}</span>
      </div>

      {/* SIL-1053 (K2.42) — dải mốc tiến độ: nhận lệnh → lấy vỏ/hàng →
          đóng/trả hàng → hạ bãi/giao hàng. Each row: its record action (the
          BE sequence is the law — out-of-order writes 409 server-side, the
          strip only ever enables the next stage), its evidence chips, and
          the recorded timestamp once done. The help line renders on the
          actionable row only (dense-display law, card 20260927_1). */}
      {/* HOT-06 (CR-011.2): keep the yellow soft notice ABOVE Tiến độ chuyến
          so the sticky bottom 'Nhận lệnh vận chuyển' bar never overlaps it on 390×844. */}
      {showAcceptStickyBar && otherRunningTrips.length > 0 && (
        <div
          className="driver-task-section driver-task-section--banner"
          style={{ background: 'var(--warning-soft, #fefce8)', color: 'var(--warning-text, #854d0e)', borderColor: 'var(--warning, #eab308)' }}
          role="status"
          data-testid="active-trips-soft-notice"
        >
          <div className="driver-task-bypass" style={{ color: 'var(--warning-text, #854d0e)' }}>
            <AlertTriangle size={16} />
            <div>
              <span>
                Lưu ý: Bạn đang có {otherRunningTrips.length} chuyến khác chưa hoàn tất
                {(() => {
                  const labels = otherRunningTrips
                    .map((item) => item.blNumber?.trim() || item.bookingRef?.trim() || null)
                    .filter((label): label is string => Boolean(label));
                  return labels.length > 0 ? <> (<strong>{labels.join(', ')}</strong>)</> : null;
                })()}.
              </span>
              <div>
                <Link className="driver-task-link" to={`/my-trips/${otherRunningTrips[0].tripId}`}>
                  Mở chuyến đang chạy
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="driver-task-section" data-testid="driver-milestone-strip">
        <div className="driver-task-section__head"><span>Tiến độ chuyến</span></div>
        <ol className="driver-milestones">
          {MILESTONES.map((milestone, index) => {
            const event = getLatestMilestoneEvent(progress.data, milestone.eventType);
            const state = milestoneActionState(Boolean(event), nextMilestoneIndex, index);
            const chips = milestoneEvidence[milestone.eventType];
            return (
              <li key={milestone.eventType} className={`driver-milestones__row driver-milestones__row--${state}`} data-testid={`milestone-${milestone.eventType}`}>
                <div className="driver-milestones__main">
                  <span className="driver-milestones__icon" aria-hidden="true">
                    {state === 'done' ? <CheckCircle2 size={16} /> : state === 'available' ? <Circle size={16} /> : <Lock size={13} />}
                  </span>
                  <span className="driver-milestones__title">{milestone.title}</span>
                  <span className="driver-milestones__meta">
                    {state === 'done' && event && (
                      <span data-testid={`milestone-time-${milestone.eventType}`}>Đã ghi · {formatDateTime(event.occurredAt)}</span>
                    )}
                    {state === 'available' && (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        // SIL-1053 (r28d) — a closed or accounting-locked
                        // trip offers no live record button (the BE 409s the
                        // write; a control that can only error is a blocked
                        // affordance).
                        disabled={accepting || pairLocked || closed || Boolean(trip.accountingLock)}
                        aria-label={`Ghi nhận mốc ${milestone.title}`}
                        onClick={() => { void handleMilestone(milestone.eventType); }}
                      >
                        {accepting ? <Loader2 size={14} className="spin" /> : null}
                        Ghi nhận
                      </button>
                    )}
                    {state === 'locked' && <span className="driver-milestones__wait">Chờ mốc trước</span>}
                  </span>
                </div>
                {chips.length > 0 && (
                  <div className="driver-milestones__evidence" data-testid={`milestone-evidence-${milestone.eventType}`}>
                    {chips.map((chip) => (
                      <span key={chip.label} className={`driver-milestones__chip${chip.ok ? ' driver-milestones__chip--ok' : ''}`}>
                        {chip.ok ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                        {chip.label}
                      </span>
                    ))}
                  </div>
                )}
                {state === 'available' && <p className="driver-milestones__help">{milestone.help}</p>}
              </li>
            );
          })}
        </ol>
      </section>



      {accountingLock && <AccountingLockBanner lock={accountingLock} />}

      <fieldset disabled={Boolean(accountingLock)} className="driver-task-fieldset">

      <DriverTaskInfoSections trip={trip} />

      {/* K10.19 (SIL-946, KB §10.4.2): hàng hóa (Số cont & seal) is its own
          group right after xuất hóa đơn, BEFORE nhiệm vụ & ghi chú — the old
          screen rendered Ghi chú between the invoice and the container card.
          SIL-918 (KB §3.6.1): hàng lẻ has no container — the frame (and its
          capture zones) renders for FCL trips only; the LCL delivery-note
          evidence rides the e-POD screen instead. */}
      {!isLcl && (
        <section className="driver-task-section">
          <DriverContainerCard
            tripId={trip.id}
            readOnly={closed}
            containers={trip.containers}
            contPhotoKey={contPhotoKey}
            sealPhotoKey={sealPhotoKey}
            deliveryNotePhotoKeys={deliveryNotePhotoKeys}
            tradeDirection={trip.tradeDirection ?? null}
            pairTagLabel={pairTagLabel}
            onSaved={handleContainerSaved}
          />
        </section>
      )}

      {/* K10.19 (SIL-946, KB §10.4.2): lộ trình is its OWN group after hàng
          hóa — Cảng nâng/hạ + the trip legs. The legs panel used to sit
          after Quy định; it moved with the ports into this section. */}
      <DriverTripRouteSection trip={trip} />

      {/* Card _36 (paper-form spec), amended by SIL-767 (09/11, customer
          CR-006 — "khách hàng bảo thế nào thì làm thế"): the Tác vụ block
          (chips + its empty state) is REMOVED from the detail screen — the
          11 dispatch tags were UI noise drivers never used. Ghi chú stays a
          STRUCTURAL row filled from the saved dispatch note (driverTaskNote
          v2 manual text) and shows its empty state when absent. Same
          parseNote codepath as the /my-trips board cards. KB §10.4.2 places
          nhiệm vụ & ghi chú AFTER lộ trình, so this section follows the
          Lộ trình block. */}
      <section className="driver-task-section" data-testid="task-note-section">
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

      <section className="driver-task-section" data-testid="site-rules-section">
        <div className="driver-task-section__head">
          <span>Quy định tại điểm làm hàng</span>
        </div>
        {siteRules.length > 0 ? (
          <>
            <ul
              id="driver-task-site-rules"
              ref={siteRulesListRef}
              className={`driver-task-rules${siteRulesExpanded ? '' : ' driver-task-rules--clamped'}`}
            >
              {siteRules.map((rule, index) => (
                <li key={`${index}-${rule}`} className="driver-task-rules__item">
                  <ShieldAlert size={16} />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
            {siteRulesExpandable ? (
              <button
                type="button"
                className="driver-task-rules__toggle"
                aria-expanded={siteRulesExpanded}
                aria-controls="driver-task-site-rules"
                onClick={() => setSiteRulesExpanded((open) => !open)}
              >
                {siteRulesExpanded ? 'Thu gọn' : 'Xem thêm'}
              </button>
            ) : null}
          </>
        ) : (
          <p className="driver-task-empty">Chưa có quy định tại điểm làm hàng.</p>
        )}
      </section>

      {/* SIL-768 (09/11, customer CR-006 — "khách hàng bảo thế nào thì làm
          thế"): the Ảnh nhiên liệu block (fuel-pump screenshot upload, OCR
          facts, GPS) is REMOVED from the detail screen. The feature moves to
          a dedicated fleet fuel-norm module later (out of scope here);
          recorded fuel evidence rows, the upload endpoint and the kế toán
          review surface (FuelEvidenceReviewPage) are untouched. The e-POD
          comment that used to lead this section moved with the block — the
          e-POD screen itself is unchanged (/my-trips/:id/pod). */}

      <ShipmentCostEntryForm key={tripId} tripId={tripId}
        totalRoadAllowance={trip.totalRoadAllowance}
        costSubmissionNote={trip.costSubmissionNote}
        readOnly={cancelled || Boolean(accountingLock)}
        onEntriesCountChange={setCostEntryCount}
        onOpenChange={setCostFormOpen} />

      {/* Wave 7 (SIL-638 TC3-T3): the completed trip's explicit economics —
          cước / VETC (1 lần trên chân mang phí) / lương / phụ phí Kẹp. */}
      <DriverCostBreakdownSection trip={trip} />

      {/* K10.19 (SIL-946, KB Ch.10 §10.4.2): "bằng chứng & hành động" is the
          LAST group of the order detail — the completion checklist (the
          e-POD evidence state + the document action) closes the screen,
          right above the sticky action bars. Card 20260926_30 item 15 had it
          LEAD the screen; the KB group order (the QA finding of 24/11)
          supersedes that placement — the progress strip at the top still
          names what is missing, so nothing is hidden.
          Card 20260927_1: densified for the driver's small phone screen —
          title + the missing-documents line only. The old 2-line instruction
          and the two-row bullet list restated what the sticky bar already says
          (Còn thiếu N chứng từ) and cost ~60px of the first screenful. */}
      <footer className="driver-task-footer">
        {/* Card 071026103226 (FB-055 regression): the closed card is ONE row —
            title left, document button right, no hint line (the stacked hint
            re-inflated the card to ~115px against the ≤60px contract). */}
        <div className={`driver-task-footer__body${closed ? ' driver-task-footer__body--closed' : ''}`}>
          <div className="driver-task-footer__summary">
            <strong>{cancelled ? 'Chuyến đã hủy' : completed ? 'Chuyến đã hoàn thành' : 'Chứng từ giao hàng'}</strong>
            {!closed && (!hasYardReceipt || !hasSignedNote) ? (
              <p className="driver-task-footer__issues" role="list">
                {/* SIL-697 resolved 09/11 — the trip-detail notice keeps the
                    soft law wording (files optional, completion never blocks). */}
                <span role="listitem">{missingPodFilesMessage(currentSubmission, trip?.fulfillment?.modeLabel)}</span>
                {!hasYardReceipt && <span role="listitem">Thiếu Phiếu bãi / phiếu hạ</span>}
                {!hasSignedNote && <span role="listitem">Thiếu Biên bản giao nhận</span>}
              </p>
            ) : !closed && (
              <p className="driver-task-footer__ready">
                <CheckCircle2 size={14} />
                <span>Đủ chứng từ, chờ hoàn thành chuyến.</span>
              </p>
            )}
          </div>
          {closed ? (
            // Card 071026205800: the `:id` in `/my-trips/:id/pod` is the SAME
            // `:id` as `/my-trips/:id` above — a TRIP id (card 20260915_1).
            <Link className="driver-task-complete" to={`/my-trips/${validTripId}/pod`} style={{ textDecoration: 'none' }}>
              <FileCheck2 size={18} />
              <span>Xem chứng từ giao hàng</span>
            </Link>
          ) : (
            <Link className="driver-task-complete" to={`/my-trips/${validTripId}/pod`} style={{ textDecoration: 'none' }}>
              <FileCheck2 size={18} />
              <span>Tải chứng từ e-POD</span>
            </Link>
          )}
        </div>
      </footer>

      {/* SIL-766: DriverInvoiceSection moved INTO DriverTaskInfoSections —
          it renders right below the Gọi kho bar, before every other block. */}

      {showAcceptStickyBar && !costFormOpen && (
        <div ref={actionBarRef} className="driver-task-accept-sticky" data-testid="accept-sticky-bar">
          <div className="driver-task-accept-sticky__inner">
            {pairLocked ? (
              <p
                className="driver-journey-card__locked driver-task-accept-sticky__locked"
                data-testid="pair-locked-message"
              >
                {PAIR_LOCKED_MESSAGE}
              </p>
            ) : (
              <button
                type="button"
                className="driver-task-accept-sticky__btn"
                disabled={!acceptClickable}
                onClick={() => { void handleMilestone(DriverProgressEventType.ORDER_RECEIVED); }}
              >
                {/* SIL-798 — the idle face is an ACTION, not a verdict: the
                    green "✓" (success = completed per §2) rode every idle
                    frame, so a REJECTED accept (409) still showed a green
                    checkmark and read as "đã nhận". Neutral ink + Truck —
                    the button earns a success face only when the system
                    confirms the order, and that state leaves this bar
                    entirely (acceptState 'done' hides it). */}
                {accepting ? <Loader2 size={18} className="spin" /> : <Truck size={18} />}
                <span>{acceptButtonLabel}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Card 20260926_28 item 10: the completion action lives in a sticky
          bar above the tab nav with LIVE state — "Còn thiếu N chứng từ" —
          instead of a gray disabled card at the end of the scroll. Hidden
          while the accept bar is up so the two never stack, and while the
          inline cost-entry form is expanded so the fixed bar never paints
          over the form's own Hủy / Lưu tất cả row. */}
      {showCompleteStickyBar && !costFormOpen && (
        <div ref={actionBarRef} className="driver-task-complete-sticky" data-testid="complete-sticky-bar">
          <div className="driver-task-complete-sticky__inner">
            <button
              type="button"
              className="driver-task-complete-sticky__btn"
              // SIL-817: an accounting-locked lot must not offer a click that
              // can only answer with the "Đã khóa kế toán" warning (a control
              // that always errors is a blocked affordance).
              // SIL-1053 (K2.42): completion is the LAST milestone — a
              // mid-sequence trip (accepted, Hạ bãi/giao chưa ghi) waits for
              // the strip; the dispatch-started path keeps its escape hatch.
              disabled={trip.status !== 'IN_TRANSIT' || completing || Boolean(trip.accountingLock) || milestoneGatedComplete}
              title={milestoneGate.reason ?? undefined}
              onClick={() => void handleCompleteTrip()}
            >
              {completing ? <Loader2 size={16} className="spin" /> : <FileCheck2 size={16} />}
              {/* SIL-733 / owner ruling 22/10: photos are optional, do not block completion */}
              <span>{completing ? 'Đang gửi…' : completeCtaLabel(trip.status)}</span>
            </button>
          </div>
        </div>
      )}

      </fieldset>

      {confirmDialog}
    </div>
  );
}
