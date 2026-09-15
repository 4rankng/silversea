import { useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useMonth } from './useMonth';

/** Keep payslip deep links and the shared driver topbar on the same period. */
export function useDriverEarningsPeriod() {
  const { month, year, setMonthYear } = useMonth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const lastSelection = useRef<{ locationKey: string | null; month: number; year: number }>({
    locationKey: null, month, year,
  });
  const requestedMonth = Number(params.get('month'));
  const requestedYear = Number(params.get('year'));
  const validRequest = Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
    && Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100;
  const topbarChanged = lastSelection.current.locationKey === location.key
    && (lastSelection.current.month !== month || lastSelection.current.year !== year);

  useEffect(() => {
    const previous = lastSelection.current;
    const incomingNavigation = previous.locationKey !== location.key;
    const contextChanged = previous.month !== month || previous.year !== year;
    lastSelection.current = { locationKey: location.key, month, year };

    if (incomingNavigation && validRequest) {
      if (month !== requestedMonth || year !== requestedYear) {
        setMonthYear(requestedMonth, requestedYear);
      }
      return;
    }

    // An unchanged route with a changed context means the driver used the
    // topbar. Replace its URL period so reload keeps that selection.
    if (!validRequest || (contextChanged && (month !== requestedMonth || year !== requestedYear))) {
      const next = new URLSearchParams(params);
      next.set('month', String(month));
      next.set('year', String(year));
      setParams(next, { replace: true });
    }
  }, [location.key, params, month, year, requestedMonth, requestedYear, validRequest, setMonthYear, setParams]);

  return validRequest && !topbarChanged
    ? { month: requestedMonth, year: requestedYear }
    : { month, year };
}
