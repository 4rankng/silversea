import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retireOfflineStorage } from './retire-offline-storage';

describe('retired command storage migration', () => {
  beforeEach(() => { localStorage.clear(); vi.stubGlobal('indexedDB', undefined); vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());
  it('removes unscoped and account-scoped commands while preserving auth and preferences', async () => {
    localStorage.setItem('silversea.driver-offline-command-queue.v1', '[{"type":"complete"}]');
    localStorage.setItem('silversea.driver-offline-command-queue.v1:DRIVER:12', '[{"type":"accept"}]');
    localStorage.setItem('pending_logout_tokens', '["legacy-token"]');
    localStorage.setItem('token', 'current-token');
    localStorage.setItem('table-preferences', 'compact');
    expect(await retireOfflineStorage()).toEqual({ found: true, cleanupIncomplete: false });
    expect(localStorage.length).toBe(2);
    expect(localStorage.getItem('token')).toBe('current-token');
    expect(localStorage.getItem('table-preferences')).toBe('compact');
    expect(await retireOfflineStorage()).toEqual({ found: false, cleanupIncomplete: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed with inaccessible storage and never sends commands', async () => {
    vi.stubGlobal('localStorage', { get length() { throw new Error('blocked storage'); } });
    expect(await retireOfflineStorage()).toEqual({ found: false, cleanupIncomplete: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
