// Cards _18/_19/_20: the ONE trip-scope contract for the debit surfaces —
// a lot's document layers resolve trips through the active-trip scope only.
// Canceled or deleted trips' expense/freight rows are dead data: they must
// not render in Lớp 2, must not count in Lớp 1, and their rows must not be
// editable through the debit edit surface.
import { isNull, ne } from 'drizzle-orm';
import * as s from '../db/schema';

export function activeTripConditions() {
  return [isNull(s.trips.deletedAt), ne(s.trips.status, 'CANCELED')] as const;
}
