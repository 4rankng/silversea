// Customer feedback 2026-09-07 (BL `JJCTCHPDY260305`): surface a soft
// warning below Bill/Booking/declaration fields as soon as the clerk types
// a value that already belongs to another active shipment. Lives outside
// `ShipmentCreateWorkspace` so the workspace stays under its frozen
// structure-guard ceiling — the workspace calls this hook with the
// current BL/Booking/declaration values and renders the returned
// `conflicts` next to the matching field.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkShipmentReferenceDuplicate,
  type ShipmentReferenceConflict,
} from '../../../api/shipmentDuplicateClient';
import { useToast } from '../../../components/shared/Toast';

interface UseShipmentReferenceDuplicateGuardArgs {
  blNumber: string;
  bookingRef: string;
  declarationNumber: string;
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
  declarationNumber,
  tradeDirection,
  debounceMs = 350,
  minChars = 3,
}: UseShipmentReferenceDuplicateGuardArgs): ShipmentReferenceDuplicateGuardResult {
  const [conflicts, setConflicts] = useState<ShipmentReferenceConflict[]>([]);
  // Latest-request token — when a fresh effect cycle runs, the previous
  // pending request's resolution is dropped so it can't overwrite the
  // newer state.
  const tokenRef = useRef(0);
  const { toast } = useToast();

  useEffect(() => {
    const trimmedBl = blNumber.trim();
    const trimmedBooking = bookingRef.trim();
    const trimmedDeclaration = declarationNumber.trim();
    if (!trimmedBl && !trimmedBooking && !trimmedDeclaration) {
      setConflicts([]);
      return;
    }
    const lengths = [
      trimmedBl.length || Number.POSITIVE_INFINITY,
      trimmedBooking.length || Number.POSITIVE_INFINITY,
      trimmedDeclaration.length || Number.POSITIVE_INFINITY,
    ];
    if (Math.min(...lengths) < minChars) {
      setConflicts([]);
      return;
    }
    const token = ++tokenRef.current;
    const handle = setTimeout(() => {
      // Re-read the latest values from the closure, not the ones captured
      // at effect-creation time, so the request always reflects the
      // current input. We still rely on the token to drop stale results.
      checkShipmentReferenceDuplicate({
        blNumber: trimmedBl || undefined,
        bookingRef: trimmedBooking || undefined,
        declarationNumber: trimmedDeclaration || undefined,
      })
        .then((next) => {
          if (token !== tokenRef.current) return;
          setConflicts(next);
        })
        .catch(() => {
          if (token !== tokenRef.current) return;
          // The server still validates at submit time, so a network blip
          // shouldn't scare the user with an error toast. Silently clear
          // the inline warning instead.
          setConflicts([]);
        });
    }, debounceMs);
    return () => {
      clearTimeout(handle);
    };
  }, [blNumber, bookingRef, declarationNumber, tradeDirection, debounceMs, minChars]);

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
    const target = value.trim();
    if (!target) return undefined;
    return conflicts.find((conflict) => {
      if (conflict.reference !== target) return false;
      if (field === 'declaration') return true;
      return conflict.field === field;
    });
  }, [conflicts]);

  return { conflicts, getConflict, reportServerConflict };
}
