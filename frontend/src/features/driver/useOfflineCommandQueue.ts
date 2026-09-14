import { ApiError } from '../../lib/api';

/** A queued role command: a stable dedupe key plus the replay closure. */
export interface OfflineCommand {
  key: string;
  run: () => Promise<unknown>;
}

/**
 * Role-command offline queue (module-level singleton). While a device is
 * offline, `enqueue` parks a command under a stable key; `drain` replays
 * every pending command in order. Replay results follow the offline truth
 * rule: only a confirmed server success removes the entry — transport
 * failures and 5xx stay queued for the next drain; a 409 conflict or any
 * other 4xx rejection is terminal, so the user re-decides on fresh data
 * instead of the app retrying blindly.
 */

/** Replay classification for a failed replay attempt. */
function classify(error: unknown): 'network' | 'conflict' | 'rejected' {
  if (error instanceof TypeError) return 'network';
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'network';
    if (error.status === 409) return 'conflict';
    return 'rejected';
  }
  return 'rejected';
}

class DriverOfflineCommandQueue {
  private pending = new Map<string, OfflineCommand>();

  get size(): number {
    return this.pending.size;
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }

  enqueue(key: string, run: () => Promise<unknown>): void {
    this.pending.set(key, { key, run });
  }

  clear(): void {
    this.pending.clear();
  }

  async drain(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const [key, command] of [...this.pending]) {
      try {
        await command.run();
        this.pending.delete(key);
        sent += 1;
      } catch (error) {
        const outcome = classify(error);
        // Network-classified failures stay queued for the next drain;
        // conflicts and rejections are terminal — drop them.
        if (outcome === 'network') {
          failed += 1;
        } else {
          this.pending.delete(key);
        }
      }
    }
    return { sent, failed };
  }
}

export const driverOfflineCommandQueue = new DriverOfflineCommandQueue();
