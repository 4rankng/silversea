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
  const { toast } = useToast();

  useEffect(() => {
    // Cleanup invalidates this request when the input changes or unmounts.
    let active = true;
    const eligible = (value: string) => value.trim().length >= minChars ? value.trim() : undefined;
    const trimmedBl = eligible(blNumber);
    const trimmedBooking = eligible(bookingRef);
    const trimmedDeclaration = eligible(declarationNumber);
    if (!trimmedBl && !trimmedBooking && !trimmedDeclaration) {
      setConflicts([]);
      return;
    }
    const handle = setTimeout(() => {
      checkShipmentReferenceDuplicate({
        blNumber: trimmedBl || undefined,
        bookingRef: trimmedBooking || undefined,
        declarationNumber: trimmedDeclaration || undefined,
      })
        .then((next) => {
          if (!active) return;
          setConflicts(next);
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
    const target = value.trim().toLowerCase();
    if (!target) return undefined;
    return conflicts.find((conflict) => {
      return conflict.reference.trim().toLowerCase() === target && conflict.field === field;
    });
  }, [conflicts]);

  return { conflicts, getConflict, reportServerConflict };
}
