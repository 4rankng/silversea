import { db } from '../db';
import { ApSnapshotService } from './ap-snapshot.service';
import { ArSnapshotService } from './ar-snapshot.service';
import type { Tx } from './trip-shared';

type DbOrTx = typeof db | Tx;

export class SnapshotServices {
  static async markBothDirty(tripId: number, txOrDb: DbOrTx): Promise<void> {
    if (txOrDb === db) {
      await db.transaction(async (tx) => {
        await ArSnapshotService.markDirty(tripId, tx);
        await ApSnapshotService.markDirty(tripId, tx);
      });
      return;
    }

    await ArSnapshotService.markDirty(tripId, txOrDb);
    await ApSnapshotService.markDirty(tripId, txOrDb);
  }
}
