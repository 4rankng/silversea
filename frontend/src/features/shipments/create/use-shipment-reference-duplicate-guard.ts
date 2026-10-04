// Customer feedback 2026-09-07 (BL `JJCTCHPDY260305`): surface a soft
// warning below Bill/Booking/declaration fields as soon as the clerk types
// a value that already belongs to another active shipment. Lives outside
// `ShipmentCreateWorkspace` so the workspace stays under its frozen
// structure-guard ceiling — the workspace calls this hook with the
// current BL/Booking/declaration values and renders the returned
// `conflicts` next to the matching field.
import { useCallback, useEffect, useState } from 'react';
import {
  checkShipmentReferenceDuplicate,
  type ShipmentReferenceConflict,
} from '../../../api/shipmentDuplicateClient';
import { useToast } from '../../../components/shared/Toast';

interface UseShipmentReferenceDuplicateGuardArgs {
  blNumber: string;
  bookingRef: string;
  /** Every entered declaration row (20261004_328): the check API is
   *  single-value, so each row's value must ride its own lookup — a warning
   *  under row 2 can never appear if only the first row is ever checked. */
  declarationNumbers: string[];
  tradeDirection: '' | 'IMPORT' | 'EXPORT';
  /** Debounce window in ms — short enough to feel live, long enough to
   *  avoid one request per keystroke. */
  debounceMs?: number;
  /** Skip the lookup when the inputs are too short to be meaningful. */
  minChars?: number;
}

export interface ShipmentReferenceDuplicateGuardResult {
  conflicts: ShipmentReferenceConflict[];
  /** Look up by `field` to render the right warning under each input. */
  getConflict: (field: 'blNumber' | 'bookingRef' | 'declaration', value: string) => ShipmentReferenceConflict | undefined;
  /** Hand a server-side 409 conflict back to the hook so the inline list
   *  is updated and a toast is shown. Used by the workspace's submit
   *  callback when the backend rejects a duplicate at write time. */
  reportServerConflict: (conflict: ShipmentReferenceConflict) => void;
}

export function useShipmentReferenceDuplicateGuard({
  blNumber,
  bookingRef,
  declarationNumbers,
  tradeDirection,
  debounceMs = 350,
  minChars = 3,
}: UseShipmentReferenceDuplicateGuardArgs): ShipmentReferenceDuplicateGuardResult {
  const [conflicts, setConflicts] = useState<ShipmentReferenceConflict[]>([]);
  const { toast } = useToast();
  // Keyed by content: a fresh array identity per render must not thrash the debounce timer.
  const declarationKey = declarationNumbers.join('\n');

  useEffect(() => {
    // Cleanup invalidates this request when the input changes or unmounts.
    let active = true;
    const eligible = (value: string) => value.trim().length >= minChars ? value.trim() : undefined;
    const trimmedBl = eligible(blNumber);
    const trimmedBooking = eligible(bookingRef);
    const trimmedDeclarations = Array.from(new Set(
      declarationKey.split('\n').map(eligible).filter((value): value is string => Boolean(value)),
    ));
    if (!trimmedBl && !trimmedBooking && trimmedDeclarations.length === 0) {
      setConflicts([]);
      return;
    }
    const handle = setTimeout(() => {
      // The first declaration rides the combined call; every extra row is a
      // single-value lookup of its own (20261004_328), merged below.
      const requests = [
        checkShipmentReferenceDuplicate({
          blNumber: trimmedBl || undefined,
          bookingRef: trimmedBooking || undefined,
          declarationNumber: trimmedDeclarations[0] || undefined,
        }),
        ...trimmedDeclarations.slice(1).map((declarationNumber) => (
          checkShipmentReferenceDuplicate({ declarationNumber })
        )),
      ];
      Promise.all(requests)
        .then((responses) => {
          if (!active) return;
          setConflicts(responses.flat());
        })
        .catch(() => {
          if (!active) return;
          // The server still validates at submit time, so a network blip
          // shouldn't scare the user with an error toast. Silently clear
          // the inline warning instead.
          setConflicts([]);
        });
    }, debounceMs);
    return () => {
      clearTimeout(handle);
      active = false;
    };
  }, [blNumber, bookingRef, declarationKey, tradeDirection, debounceMs, minChars]);

  const reportServerConflict = useCallback((conflict: ShipmentReferenceConflict) => {
    setConflicts((current) => (
      current.some((item) => item.shipmentId === conflict.shipmentId && item.reference === conflict.reference)
        ? current
        : [...current, conflict]
    ));
    const actor = conflict.createdBy?.username ?? 'tài khoản khác';
    toast({
      kind: 'error',
      message: `Không thể tạo lô — ${conflict.reference} đã được nhập bởi ${actor}. Mở chi tiết lô đã nhập qua cảnh báo phía dưới ô Số Bill / Số tờ khai.`,
    });
  }, [toast]);

  const getConflict = useCallback((field: 'blNumber' | 'bookingRef' | 'declaration', value: string) => {
    const target = value.trim().toLowerCase();
    if (!target) return undefined;
    return conflicts.find((conflict) => {
      return conflict.reference.trim().toLowerCase() === target && conflict.field === field;
    });
  }, [conflicts]);

  return { conflicts, getConflict, reportServerConflict };
}
