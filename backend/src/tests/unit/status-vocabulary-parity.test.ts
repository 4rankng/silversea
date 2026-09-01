import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DriverIncidentalCostType,
  DriverProgressEventType,
  FulfillmentCancellationDisposition,
  MasterImportRowClassification,
  MasterImportStatus,
  OperationalSiteType,
  ShipmentDocumentType,
  ShipmentFulfillmentType,
  ShipmentStatus,
  TripPodFileType,
  TripPodStatus,
  TripStatus,
} from '@tingting/shared';
import * as s from '../../db/schema';

/**
 * The status vocabulary is 3-layer: backend `_enums.ts`, shared TS enums (which
 * feed shared zod — unknown values are REJECTED on writes), and frontend label
 * maps. This test pins backend↔shared parity so adding a status on one layer
 * without the other fails immediately instead of breaking writes at runtime.
 *
 * When you add a vocabulary that exists in both layers, add the pair here —
 * this list is deliberate, not derived (deriving would let a new layer-2 enum
 * silently skip the check).
 */
const PARITY_PAIRS = {
  TripStatus: [s.tripStatusEnum, TripStatus],
  ShipmentStatus: [s.shipmentStatusEnum, ShipmentStatus],
  ShipmentFulfillmentType: [s.shipmentFulfillmentTypeEnum, ShipmentFulfillmentType],
  FulfillmentCancellationDisposition: [s.fulfillmentCancellationDispositionEnum, FulfillmentCancellationDisposition],
  TripPodStatus: [s.tripPodStatusEnum, TripPodStatus],
  TripPodFileType: [s.tripPodFileTypeEnum, TripPodFileType],
  DriverProgressEventType: [s.driverProgressEventTypeEnum, DriverProgressEventType],
  DriverIncidentalCostType: [s.driverIncidentalCostTypeEnum, DriverIncidentalCostType],
  ShipmentDocumentType: [s.shipmentDocumentTypeEnum, ShipmentDocumentType],
  OperationalSiteType: [s.operationalSiteTypeEnum, OperationalSiteType],
  MasterImportStatus: [s.masterImportStatusEnum, MasterImportStatus],
  MasterImportRowClassification: [s.masterImportRowClassificationEnum, MasterImportRowClassification],
} as const;

describe('status vocabulary parity (backend _enums vs shared constants)', () => {
  for (const [name, [backendEnum, sharedEnum]] of Object.entries(PARITY_PAIRS)) {
    test(`${name}: backend enumValues === shared enum values (same order)`, () => {
      const backendValues = [...backendEnum.enumValues];
      const sharedValues = Object.values(sharedEnum);
      assert.deepEqual(
        backendValues,
        sharedValues,
        `${name} diverges between backend/_enums.ts and shared/src/constants — shared-derived zod will reject the missing values on writes. Align BOTH layers (and the frontend label maps) in one commit.`,
      );
    });
  }
});
