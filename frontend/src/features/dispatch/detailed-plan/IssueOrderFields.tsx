import { Clock } from 'lucide-react';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { DateInput, TextField } from '../../../design-system';
import type { IssueOrderDraft, OwnTruckDriver } from './useIssueOrder';

/** Common run hours offered as one-tap shortcuts when issuing an order. */
const SCHEDULE_TIME_PRESETS = ['08:00', '10:00', '13:30', '16:00'];

/** Quick-date shortcuts mirror the schedule editor's Hôm nay / Ngày mai / Ngày kia row. */
const SCHEDULE_QUICK_DAYS = [
  { label: 'Hôm nay', offsetDays: 0 },
  { label: 'Ngày mai', offsetDays: 1 },
  { label: 'Ngày kia', offsetDays: 2 },
] as const;

function getOffsetDateString(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateTimeParts(isoString: string | null | undefined): { date: string; time: string } {
  if (!isoString) return { date: '', time: '' };
  const [d = '', t = ''] = isoString.split('T');
  return { date: d, time: t.slice(0, 5) };
}

function addHoursToTime(timeStr: string, hours: number): string {
  if (!timeStr) return '';
  const [hStr = '0', mStr = '0'] = timeStr.split(':');
  const h = Number.parseInt(hStr, 10) || 0;
  const m = Number.parseInt(mStr, 10) || 0;
  const totalMinutes = h * 60 + m + hours * 60;
  const newH = Math.floor((totalMinutes / 60) % 24);
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

interface IssueOrderFieldsProps {
  row: DispatchDetailPlanRow;
  ownTruck: OwnTruckDriver | null;
  loadingOwnTruck: boolean;
  issueDraft: IssueOrderDraft;
  setIssueDraft: (updater: (current: IssueOrderDraft) => IssueOrderDraft) => void;
  onFieldTouched: () => void;
  /** Distinguishes DOM ids between the inline editor's issue section and the
   *  grid's standalone quick-issue dialog when both could exist in the DOM. */
  idPrefix?: string;
}

/**
 * Driver + planned-time inputs for issuing a dispatch order — adopts the
 * standardized schedule design language (quick-date pills, 24h paired
 * time/date grid, and common-hours presets). Shared by both the full plan
 * editor's inline "Phát lệnh" section and the grid's quick-issue dialog.
 */
export function IssueOrderFields({
  row,
  ownTruck,
  loadingOwnTruck,
  issueDraft,
  setIssueDraft,
  onFieldTouched,
  idPrefix = 'dispatch-issue',
}: IssueOrderFieldsProps) {
  const currentPlate = row.dispatch.assignedPlate;

  const { date: startDate, time: startTime } = parseDateTimeParts(issueDraft.plannedStartAt);
  const { date: endDate, time: endTime } = parseDateTimeParts(issueDraft.plannedEndAt);

  const handleQuickDayClick = (offsetDays: number) => {
    const quickDate = getOffsetDateString(offsetDays);
    const resolvedStartTime = startTime || '08:00';
    const resolvedEndTime = endTime || addHoursToTime(resolvedStartTime, 2);
    const resolvedEndDate = endDate && endDate >= quickDate ? endDate : quickDate;

    setIssueDraft((current) => ({
      ...current,
      plannedStartAt: `${quickDate}T${resolvedStartTime}`,
      plannedEndAt: `${resolvedEndDate}T${resolvedEndTime}`,
    }));
    onFieldTouched();
  };

  const handleStartDateChange = (newDate: string) => {
    if (!newDate) {
      setIssueDraft((current) => ({
        ...current,
        plannedStartAt: '',
      }));
      onFieldTouched();
      return;
    }
    const resolvedStartTime = startTime || '08:00';
    const resolvedEndTime = endTime || addHoursToTime(resolvedStartTime, 2);
    const resolvedEndDate = endDate && endDate >= newDate ? endDate : newDate;

    setIssueDraft((current) => ({
      ...current,
      plannedStartAt: `${newDate}T${resolvedStartTime}`,
      plannedEndAt: `${resolvedEndDate}T${resolvedEndTime}`,
    }));
    onFieldTouched();
  };

  const handleEndDateChange = (newDate: string) => {
    if (!newDate) {
      setIssueDraft((current) => ({
        ...current,
        plannedEndAt: '',
      }));
      onFieldTouched();
      return;
    }
    const resolvedEndTime = endTime || addHoursToTime(startTime || '08:00', 2);
    const resolvedStartDate = startDate && startDate <= newDate ? startDate : newDate;

    setIssueDraft((current) => ({
      ...current,
      plannedStartAt: `${resolvedStartDate}T${startTime || '08:00'}`,
      plannedEndAt: `${newDate}T${resolvedEndTime}`,
    }));
    onFieldTouched();
  };

  const handleStartTimeChange = (val: string) => {
    let resolvedDate = startDate;
    let resolvedStartTime = val;
    if (val.includes('T')) {
      const [d, t] = val.split('T');
      resolvedDate = d;
      resolvedStartTime = t.slice(0, 5);
    }
    if (!resolvedDate) resolvedDate = getOffsetDateString(0);

    setIssueDraft((current) => ({
      ...current,
      plannedStartAt: resolvedStartTime ? `${resolvedDate}T${resolvedStartTime}` : '',
    }));
    onFieldTouched();
  };

  const handleEndTimeChange = (val: string) => {
    let resolvedEndDate = endDate || startDate || getOffsetDateString(0);
    let resolvedEndTime = val;
    if (val.includes('T')) {
      const [d, t] = val.split('T');
      resolvedEndDate = d;
      resolvedEndTime = t.slice(0, 5);
    }

    setIssueDraft((current) => ({
      ...current,
      plannedEndAt: resolvedEndTime ? `${resolvedEndDate}T${resolvedEndTime}` : '',
    }));
    onFieldTouched();
  };

  const handlePresetTimeClick = (presetTime: string) => {
    const curDate = startDate || getOffsetDateString(0);
    const newEndTime = addHoursToTime(presetTime, 2);
    const resolvedEndDate = endDate && endDate >= curDate ? endDate : curDate;
    setIssueDraft((current) => ({
      ...current,
      plannedStartAt: `${curDate}T${presetTime}`,
      plannedEndAt: `${resolvedEndDate}T${newEndTime}`,
    }));
    onFieldTouched();
  };

  return (
    <>
      {row.dispatch.carrierType === 'OWN' ? (
        <p className="dispatch-assignment-dialog__issue-driver">
          Tài xế: {loadingOwnTruck
            ? 'Đang tải…'
            : ownTruck?.driverName ?? (
              <span className="dispatch-assignment-dialog__issue-warning">
                Xe {currentPlate} chưa gán tài xế — vào Danh mục Xe nội bộ để gán trước.
              </span>
            )}
        </p>
      ) : (
        <>
          <TextField
            id={`${idPrefix}-driver-name-${row.fulfillmentId}`}
            label="Tên tài xế (nhà xe ngoài) — không bắt buộc"
            autoComplete="off"
            value={issueDraft.externalDriverName}
            onChange={(event) => { setIssueDraft((current) => ({ ...current, externalDriverName: event.target.value })); onFieldTouched(); }}
          />
          <TextField
            id={`${idPrefix}-driver-phone-${row.fulfillmentId}`}
            label="SĐT tài xế (nhà xe ngoài)"
            autoComplete="off"
            value={issueDraft.externalDriverPhone}
            onChange={(event) => { setIssueDraft((current) => ({ ...current, externalDriverPhone: event.target.value })); onFieldTouched(); }}
          />
        </>
      )}

      <div className="dispatch-assignment-dialog__schedule-section">Chọn nhanh ngày</div>
      <div className="dispatch-assignment-dialog__schedule-pills" role="group" aria-label="Chọn nhanh ngày">
        {SCHEDULE_QUICK_DAYS.map(({ label, offsetDays }) => {
          const quickDate = getOffsetDateString(offsetDays);
          const active = startDate === quickDate;
          return (
            <button
              key={label}
              type="button"
              className={`dispatch-assignment-dialog__schedule-pill${active ? ' is-active' : ''}`}
              onClick={() => handleQuickDayClick(offsetDays)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="dispatch-assignment-dialog__issue-grid">
        <label htmlFor={`${idPrefix}-start-${row.fulfillmentId}`}>
          <span>Giờ chạy</span>
          <input
            id={`${idPrefix}-start-${row.fulfillmentId}`}
            type="time"
            lang="en-GB"
            className="input"
            value={startTime}
            onChange={(event) => handleStartTimeChange(event.target.value)}
          />
        </label>
        <label htmlFor={`${idPrefix}-end-${row.fulfillmentId}`}>
          <span>Giờ kết thúc</span>
          <input
            id={`${idPrefix}-end-${row.fulfillmentId}`}
            type="time"
            lang="en-GB"
            className="input"
            value={endTime}
            onChange={(event) => handleEndTimeChange(event.target.value)}
          />
        </label>
        <label htmlFor={`${idPrefix}-date-${row.fulfillmentId}`}>
          <span>Ngày chạy</span>
          <DateInput
            id={`${idPrefix}-date-${row.fulfillmentId}`}
            lang="en-GB"
            className="input"
            value={startDate}
            onChange={handleStartDateChange}
          />
        </label>
        <label htmlFor={`${idPrefix}-end-date-${row.fulfillmentId}`}>
          <span>Ngày kết thúc</span>
          <DateInput
            id={`${idPrefix}-end-date-${row.fulfillmentId}`}
            lang="en-GB"
            className="input"
            value={endDate}
            onChange={handleEndDateChange}
          />
        </label>
      </div>

      <div className="dispatch-assignment-dialog__schedule-section">
        <Clock size={11} aria-hidden="true" />
        Khung giờ phổ biến
      </div>
      <div className="dispatch-assignment-dialog__schedule-times" role="group" aria-label="Khung giờ phổ biến">
        {SCHEDULE_TIME_PRESETS.map((presetTime) => (
          <button
            key={presetTime}
            type="button"
            className={`dispatch-assignment-dialog__schedule-time-pill${startTime === presetTime ? ' is-active' : ''}`}
            onClick={() => handlePresetTimeClick(presetTime)}
          >
            {presetTime}
          </button>
        ))}
      </div>
    </>
  );
}

