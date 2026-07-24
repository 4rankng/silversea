import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { qk } from '../api/keys';
import {
  resolveCommonContainerTypeId,
  type PlannedContainer,
} from './tripFormDispatchUtils';

interface PersistedContainersResponse {
  items: PlannedContainer[];
}

type LoadPersistedContainers = (tripId: number) => Promise<PersistedContainersResponse>;

const loadPersistedContainers: LoadPersistedContainers = (tripId) =>
  api.get(`/trips/${tripId}/containers`);

interface UsePersistedContainerTypeParams {
  tripId: number | undefined;
  enabled: boolean;
  plannedContainerTypeId: string;
  setPlannedContainerTypeId: (value: string) => void;
  refreshNonce?: number;
  load?: LoadPersistedContainers;
}

export function usePersistedContainerType({
  tripId,
  enabled,
  plannedContainerTypeId,
  setPlannedContainerTypeId,
  refreshNonce = 0,
  load = loadPersistedContainers,
}: UsePersistedContainerTypeParams): void {
  const { data, isFetching, refetch } = useQuery<PersistedContainersResponse>({
    queryKey: qk.tripForm.tripContainers(tripId ?? 0),
    queryFn: () => load(tripId!),
    enabled: enabled && !!tripId,
  });
  const previousRefreshNonce = useRef(refreshNonce);

  useEffect(() => {
    if (!enabled) return;
    // Never show the previous trip's planning choice while the next trip's
    // persisted containers are still loading.
    setPlannedContainerTypeId('');
  }, [enabled, tripId, setPlannedContainerTypeId]);

  useEffect(() => {
    if (previousRefreshNonce.current === refreshNonce) return;
    previousRefreshNonce.current = refreshNonce;
    if (!enabled || !tripId) return;

    // A 409 reload refreshes trip detail separately. Refresh this sibling
    // query too so a concurrent container-type change cannot remain stale.
    setPlannedContainerTypeId('');
    void refetch();
  }, [
    enabled,
    refreshNonce,
    refetch,
    setPlannedContainerTypeId,
    tripId,
  ]);

  useEffect(() => {
    if (!enabled || !data || isFetching || plannedContainerTypeId) return;
    const persistedTypeId = resolveCommonContainerTypeId(data.items);
    if (persistedTypeId) setPlannedContainerTypeId(persistedTypeId);
  }, [
    data,
    enabled,
    isFetching,
    plannedContainerTypeId,
    setPlannedContainerTypeId,
  ]);
}
