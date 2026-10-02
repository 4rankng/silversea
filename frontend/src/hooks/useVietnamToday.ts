import { useEffect, useState } from 'react';
import { formatVietnamDateInput } from '../lib/shipment-operations';

// Vietnam runs at a fixed UTC+7 with no DST, so the business day rolls at a
// constant boundary — no timezone database lookup needed to arm a timer.
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// One second of slack: an early timer wake must never re-arm a 0 ms delay and
// spin the hook (the value would be unchanged, but the loop would still burn).
const MIDNIGHT_SLACK_MS = 1000;

/** Milliseconds from `now` to the next Vietnam (UTC+7) midnight. */
export function msUntilVietnamMidnight(now: Date): number {
  return DAY_MS - ((now.getTime() + VIETNAM_UTC_OFFSET_MS) % DAY_MS);
}

/**
 * The current Vietnam business day (`yyyy-mm-dd`), advancing at the day
 * boundary. A mount-time snapshot lies on a tab left open overnight: the
 * container workboard's default date filter and its "Hôm nay chờ phân xe"
 * rail both key off this value, so a stale day shows yesterday's work as
 * today's. The timer fires once per boundary and re-arms; the
 * visibilitychange resync covers a frozen/backgrounded tab whose timer was
 * deferred past midnight.
 */
export function useVietnamToday(): string {
  const [today, setToday] = useState(() => formatVietnamDateInput(new Date()));

  useEffect(() => {
    const sync = () => setToday(formatVietnamDateInput(new Date()));
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        sync();
        arm();
      }, msUntilVietnamMidnight(new Date()) + MIDNIGHT_SLACK_MS);
    };
    arm();
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return today;
}
