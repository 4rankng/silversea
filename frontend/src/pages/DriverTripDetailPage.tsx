import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  Loader2,
  ShieldAlert,
  StickyNote,
} from 'lucide-react';
import { DriverProgressEventType, TripStatus } from '@tingting/shared';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import { ShipmentCostEntryForm } from '../components/trip/ShipmentCostEntryForm';
import { DriverContainerCard } from '../components/trip/DriverContainerCard';
import { DriverTripHeader } from './driver/DriverTripHeader';
import { DriverTaskInfoSections, DriverCostBreakdownSection } from './driver/DriverTaskInfoSections';
import { podRequiredFilesReady, missingRequiredPodFileTypes } from '../lib/podReadiness';
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

import { MILESTONES, completeCtaLabel, getLatestMilestoneEvent, milestoneActionState, type MilestoneType, PAIR_LOCKED_MESSAGE, isTripPairLocked, tagLabelFor } from '../features/driver/driver-trip-model';
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
  // KP-087: the parsed TRP code from the busy-trip 409 — banner PRESENCE
  // signal and board lookup key only, NEVER rendered (FB-019, card
  // 211026005621 / internal-ids law CHIEF 26/09).
  const [blockingTripCode, setBlockingTripCode] = useState<string | null>(null);
  // FB-019: the display reference for the banner — Số Bill/Booking from the
  // driver's own journey board; null means the board cannot vouch for the
  // trip, so the banner states the gap honestly (no code, no invented ref).
  const [blockingTripLabel, setBlockingTripLabel] = useState<string | null>(null);
  const [blockingTripId, setBlockingTripId] = useState<number | null>(null);
  // Card 20260926_30 item 16: saved cost-entry count reported by the cost
  // form so the top progress strip can show it without scrolling.
  const [costEntryCount, setCostEntryCount] = useState(0);

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
  // SIL-652 (id 758): match the journey board's pair lock so list and detail
  // stay consistent. The L2 card stays locked until L1 completes.
  const journeyCard = useMemo(() => {
    return journeyBoard.data?.items?.find((item) =>
      (validTripId != null && item.tripId === validTripId) ||
      (validFulfillmentId != null && item.fulfillmentId === validFulfillmentId)
    );
  }, [journeyBoard.data?.items, validTripId, validFulfillmentId]);
  const pairLocked = isTripPairLocked(journeyCard);
  // SIL-636 — the [KẸP]/[KẾT HỢP] tag rides the container number. Resolution
  // mirrors the journey list exactly (shared tagLabelFor): the detail wire's
  // ACTIVE pairKind is primary, and when the wire carries no pair the board
  // card's classification/linked fallbacks decide — so a card tagged KẸP/
  // KẾT HỢP on the list keeps its tag here (QA round-3b: DOUBLE-classified
  // cards showed no tag on detail). Never a Trip_ID: the ruling keeps internal
  // ids off the driver UI; partnerTripId stays a wire-only key. Single trips
  // (ĐƠN) carry no tag on the detail screen.
  const pairTagLabel = useMemo(() => {
    if (trip?.pairKind === 'KEP') return '[KẸP]';
    if (trip?.pairKind === 'KET_HOP') return '[KẾT HỢP]';
    const label = tagLabelFor(journeyCard);
    return label === 'KẸP' || label === 'KẾT HỢP' ? `[${label}]` : null;
  }, [trip?.pairKind, journeyCard]);
  const completed = trip?.status === TripStatus.COMPLETED;
  const cancelled = trip?.status === TripStatus.CANCELED;
  const closed = completed || cancelled;
  const currentSubmission = (trip?.currentPod ?? null) as DriverTaskPodSubmission | null;
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
      await refreshAll();
      // A successful action means the truck is no longer blocked — the banner's
      // premise is gone (milestone buttons don't clear it on click the way the
      // accept button does).
      setBlockingTripCode(null);
      setBlockingTripLabel(null);
      setBlockingTripId(null);
      toast({ kind: 'success', message: 'Đã ghi nhận mốc tiến độ.' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Không thể gửi lệnh. Vui lòng thử lại.';
      // KP-087: detect the blocking-trip rejection. The code parsed here is a
      // LOOKUP KEY ONLY — FB-019 (card 211026005621): the internal TRP code
      // must never render (internal-ids law, CHIEF 26/09), so both surfaces
      // name the blocking trip by its Số Bill/Booking or stay generic.
      const blockingMatch = msg.match(/Xe đang chạy chuyến\s+(.+?)\. Vui lòng/);
      setBlockingTripId(null);
      if (blockingMatch) {
        const code = blockingMatch[1];
        setBlockingTripCode(code);
        setBlockingTripLabel(null);
        let busyLabel: string | null = null;
        // Only the authenticated driver's board may supply a navigable ID.
        // A busy truck can belong to someone else's order; never guess a URL
        // from a trip code or expose an unrestricted trip lookup.
        try {
          const board = await driverClient.getJourneyBoard();
          const owned = board.items.find(item => item.tripCode === code && item.bucket !== 'HISTORY');
          if (owned) {
            busyLabel = owned.blNumber || owned.bookingRef || null;
            setBlockingTripLabel(busyLabel);
            setBlockingTripId(owned.tripId);
          }
        } catch {
          // Generic copy stays; never fall back to the internal code.
        }
        // Card 20260916_8 keeps the reason on BOTH surfaces (toast + banner);
        // FB-019 strips the internal code from both.
        toast({ kind: 'error', message: busyLabel
          ? `Xe đang chạy chuyến ${busyLabel}. Vui lòng hoàn thành chuyến đó trước.`
          : 'Xe đang có chuyến chưa hoàn thành. Vui lòng hoàn thành chuyến đó trước.' });
      } else {
        setBlockingTripCode(null);
        setBlockingTripLabel(null);
        toastActionError(toast, 'ghi nhận mốc tiến độ', error, 'Không thể gửi lệnh. Vui lòng thử lại.');
      }
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
        && missingRequiredPodFileTypes(draftSubmission).length === 0;
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
  const siteRules = fulfillment?.siteRules ?? [];
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
  const { hasYardReceipt, hasSignedNote } = podRequiredFilesReady(currentSubmission);

  // Card 20260926_28 item 10: live completion state for the sticky bar (and
  // the top progress strip). SIL-733 r2: the strip NAMES the missing docs
  // (informational) — it never disables completion.
  const podHave = (hasYardReceipt ? 1 : 0) + (hasSignedNote ? 1 : 0);
  const photoTypes = new Set(containerSealPhotos.map((p) => p.type));
  const photoHave = ['CONTAINER', 'SEAL', 'DELIVERY_NOTE'].filter((type) => photoTypes.has(type as never)).length;
  // Card 061026043643: the counter reports UPLOADED PHOTOS, not filled zones —
  // two biên bản uploads read "Ảnh 2/3", not "1/3". Denominator stays 3 (the
  // three capture zones); done state keeps the zones-full meaning.
  const photoCount = containerSealPhotos.length;

  const acceptEvent = getLatestMilestoneEvent(progress.data, DriverProgressEventType.ORDER_RECEIVED);
  const acceptState = milestoneActionState(Boolean(acceptEvent), nextMilestoneIndex, 0);
  const showAcceptStickyBar = !closed && acceptState !== 'done';
  const acceptClickable = acceptState === 'available' && !accepting && !pairLocked;
  const acceptButtonLabel = accepting ? 'Đang gửi…' : 'Nhận lệnh vận chuyển';

  return (
    <div ref={rootRef} className={`driver-task-screen${showAcceptStickyBar ? ' driver-task-screen--has-accept-bar' : ''}${!closed && !showAcceptStickyBar ? ' driver-task-screen--has-complete-bar' : ''}`}>
      <DriverTripHeader trip={trip} onBack={handleBack} />

      {/* Card 20260926_30 item 16: compact progress strip at the top — the
          driver sees what is missing without scrolling. Counts: POD docs
          (phiếu bãi/hạ + biên bản giao nhận — the completion gate), photos
          (cont + seal + biên bản — the container card's capture zones), and
          saved cost entries. Incomplete groups warn, complete groups show
          ok. */}
      <div className="driver-task-progress" data-testid="driver-task-progress">
        <span className={`driver-task-progress__item${podHave >= 2 ? ' driver-task-progress__item--done' : ' driver-task-progress__item--open'}`} data-testid="progress-pod">Chứng từ {podHave}/2</span>
        <span className={`driver-task-progress__item${photoHave >= 3 ? ' driver-task-progress__item--done' : ' driver-task-progress__item--open'}`} data-testid="progress-photos">Ảnh {photoCount}/3</span>
        <span className="driver-task-progress__item" data-testid="progress-costs">Chi phí {costEntryCount}</span>
      </div>



      {accountingLock && <AccountingLockBanner lock={accountingLock} />}

      <fieldset disabled={Boolean(accountingLock)} className="driver-task-fieldset">

      {/* Card 20260926_30 item 15: the completion checklist LEADS the screen —
          it is the one thing the driver must act on, so it renders before
          Thông tin lệnh instead of at the bottom.
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

      <DriverTaskInfoSections trip={trip}>

      {/* Card _36 (paper-form spec), amended by SIL-767 (09/11, customer
          CR-006 — "khách hàng bảo thế nào thì làm thế"): the Tác vụ block
          (chips + its empty state) is REMOVED from the detail screen — the
          11 dispatch tags were UI noise drivers never used. Ghi chú stays a
          STRUCTURAL row filled from the saved dispatch note (driverTaskNote
          v2 manual text) and shows its empty state when absent. Same
          parseNote codepath as the /my-trips board cards. */}
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
      </DriverTaskInfoSections>

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

      {trip.legs.length > 0 && (
        <section className="driver-task-section driver-task-section--legs">
          <div className="driver-task-section__head">
            <span>Lộ trình chi tiết</span>
          </div>
          <TripLegsPanel legs={trip.legs} />
        </section>
      )}

      <ShipmentCostEntryForm key={tripId} tripId={tripId}
        totalRoadAllowance={trip.totalRoadAllowance}
        costSubmissionNote={trip.costSubmissionNote}
        readOnly={cancelled || Boolean(accountingLock)}
        onEntriesCountChange={setCostEntryCount} />

      {/* Wave 7 (SIL-638 TC3-T3): the completed trip's explicit economics —
          cước / VETC (1 lần trên chân mang phí) / lương / phụ phí Kẹp. */}
      <DriverCostBreakdownSection trip={trip} />

      {/* SIL-766: DriverInvoiceSection moved INTO DriverTaskInfoSections —
          it renders right below the Gọi kho bar, before every other block. */}

      {showAcceptStickyBar && (
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
                onClick={() => { setBlockingTripCode(null); setBlockingTripLabel(null); void handleMilestone(DriverProgressEventType.ORDER_RECEIVED); }}
              >
                {accepting ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
                <span>{acceptButtonLabel}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* KP-087: blocking-trip reference when acceptance is rejected */}
      {/* Card 20260926_28 item 10: the completion action lives in a sticky
          bar above the tab nav with LIVE state — "Còn thiếu N chứng từ" —
          instead of a gray disabled card at the end of the scroll. Hidden
          while the accept bar is up so the two never stack. */}
      {!closed && !showAcceptStickyBar && (
        <div ref={actionBarRef} className="driver-task-complete-sticky" data-testid="complete-sticky-bar">
          <div className="driver-task-complete-sticky__inner">
            <button
              type="button"
              className="driver-task-complete-sticky__btn"
              disabled={trip.status !== 'IN_TRANSIT' || completing}
              onClick={() => void handleCompleteTrip()}
            >
              {completing ? <Loader2 size={16} className="spin" /> : <FileCheck2 size={16} />}
              {/* SIL-733 / owner ruling 22/10: photos are optional, do not block completion */}
              <span>{completing ? 'Đang gửi…' : completeCtaLabel(trip.status)}</span>
            </button>
          </div>
        </div>
      )}

      {blockingTripCode != null && (
        <div className="driver-task-section driver-task-section--banner" role="alert" data-testid="blocking-trip-banner">
          <div className="driver-task-bypass" style={{ background: 'var(--err-bg, #fef2f2)', color: 'var(--err, #dc2626)' }}>
            <ShieldAlert size={16} />
            <div>
              {/* FB-019 (card 211026005621): the blocking trip is named by Số
                  Bill/Booking (CHIEF 26/09) — the internal TRP code never
                  renders here; when the board cannot vouch for the trip the
                  banner says the gap instead of leaking the code. */}
              <span>{blockingTripLabel
                ? <>Xe đang chạy chuyến <strong>{blockingTripLabel}</strong> — hoàn thành chuyến đó trước khi nhận lệnh mới.</>
                : 'Xe đang có chuyến chưa hoàn thành — hoàn thành chuyến đó trước khi nhận lệnh mới.'}</span>
              <div>
                {blockingTripId != null
                  ? <Link className="driver-task-link" to={`/my-trips/${blockingTripId}`}>Mở chuyến đang chạy</Link>
                  : <span>Liên hệ điều vận để xử lý chuyến đang chạy. Chỉ thử nhận lại khi xe đã sẵn sàng.</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      </fieldset>

      {confirmDialog}
    </div>
  );
}
