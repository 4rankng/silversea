import { useSyncExternalStore } from 'react';
import { getConnectionState, subscribeConnection } from '../lib/connection';

export function useConnectionState() {
  return useSyncExternalStore(subscribeConnection, getConnectionState, getConnectionState);
}

export function useOnline(): boolean {
  return useConnectionState() === 'online';
}
