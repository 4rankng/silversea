import { api } from '../lib/api';
import { GEOTAG_PATHS, type GeotagInput, type GeotagEntityType, type PhotoGeotag } from '@tingting/shared';

/**
 * Geotag API client. POST records a phone GPS fix for a photo submission
 * (idempotent upsert server-side); GET reads it back. Used by the future photo
 * flows (container/seal M8.5, port receipt M9.5, fuel pump M12.3) — not wired
 * into any component yet (foundation module).
 */
export const geotagClient = {
  submit: (payload: GeotagInput) =>
    api.post<PhotoGeotag>(GEOTAG_PATHS.SUBMIT, payload),
  get: (entityType: GeotagEntityType, entityId: number) =>
    api.get<PhotoGeotag>(GEOTAG_PATHS.GET(entityType, entityId)),
};
