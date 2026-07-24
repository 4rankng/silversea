import { config } from '../../../config';
import { apiProvider } from './apiProvider';
import { portalProvider } from './portalProvider';
import type { GpsProvider, NormalizedGpsVehicle } from './types';

/**
 * `auto` source: prefer the clean public API; if it yields nothing (access not
 * granted / downtime / genuinely no vehicles) fall back to the portal. No manual
 * switch is ever needed — when the vendor enables API access it is used
 * automatically, and until then the portal keeps the map live.
 *
 * Negative cache: until the vendor enables API-gateway access, every poll would
 * make a guaranteed-failing API call. After an empty result we back off for a
 * few minutes; a successful API result clears the backoff.
 */
const API_NEGATIVE_BACKOFF_MS = 5 * 60 * 1000;
let apiNegativeUntil = 0;

/** Reset provider backoff after an admin changes credentials. */
export function invalidateGpsProvider(): void {
  apiNegativeUntil = 0;
}

const autoProvider: GpsProvider = {
  name: 'auto',
  isConfigured: async () => (await apiProvider.isConfigured()) || (await portalProvider.isConfigured()),
  async fetchVehicles(): Promise<NormalizedGpsVehicle[]> {
    if ((await apiProvider.isConfigured()) && Date.now() >= apiNegativeUntil) {
      const apiVehicles = await apiProvider.fetchVehicles();
      if (apiVehicles.length > 0) {
        apiNegativeUntil = 0;
        return apiVehicles;
      }
      // API yielded nothing — back off so we don't repeat the dead call each poll.
      apiNegativeUntil = Date.now() + API_NEGATIVE_BACKOFF_MS;
    }
    if (await portalProvider.isConfigured()) {
      return portalProvider.fetchVehicles();
    }
    return [];
  },
};

/** Resolve the active GPS provider from the BACH_KHOA_PROVIDER config. */
export function getGpsProvider(): GpsProvider {
  switch (config.bachKhoaProvider) {
    case 'api':
      return apiProvider;
    case 'portal':
      return portalProvider;
    case 'auto':
    default:
      return autoProvider;
  }
}

export type { GpsProvider, NormalizedGpsVehicle } from './types';
