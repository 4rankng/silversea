import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  localDateInBusinessZone,
  resolveEffectiveFactory,
  resolveEffectiveFulfillmentDate,
} from './shipment-effective';

describe('resolveEffectiveFactory', () => {
  it('prefers the container site over every later level', () => {
    const result = resolveEffectiveFactory({
      containerOperationalSiteId: 7,
      shipmentOperationalSiteId: 3,
      shipmentFactoryName: 'Nhà máy ABC',
    });
    assert.equal(result.operationalSiteId, 7);
    assert.equal(result.source, 'CONTAINER_SITE');
  });

  it('falls back to the shipment site when the container has none', () => {
    const result = resolveEffectiveFactory({
      containerOperationalSiteId: null,
      shipmentOperationalSiteId: 3,
      shipmentFactoryName: 'Nhà máy ABC',
    });
    assert.equal(result.operationalSiteId, 3);
    assert.equal(result.source, 'SHIPMENT_SITE');
  });

  it('falls back to the shipment factory text when no site exists', () => {
    const result = resolveEffectiveFactory({
      shipmentOperationalSiteId: null,
      shipmentFactoryName: '  Nhà máy ABC  ',
    });
    assert.equal(result.operationalSiteId, null);
    assert.equal(result.factoryName, 'Nhà máy ABC');
    assert.equal(result.source, 'SHIPMENT_FACTORY_TEXT');
  });

  it('treats blank factory text as absent', () => {
    const result = resolveEffectiveFactory({ shipmentFactoryName: '   ' });
    assert.equal(result.source, 'NONE');
    assert.equal(result.factoryName, null);
  });

  it('returns NONE when every level is empty', () => {
    const result = resolveEffectiveFactory({});
    assert.equal(result.source, 'NONE');
    assert.equal(result.operationalSiteId, null);
  });
});

describe('resolveEffectiveFulfillmentDate', () => {
  it('uses the FCL container appointment cast to the local date', () => {
    // 2026-08-19T20:00:00Z is already 2026-08-20 03:00 in +07.
    const result = resolveEffectiveFulfillmentDate({
      cargoMode: 'FCL',
      containerAppointmentAt: '2026-08-19T20:00:00.000Z',
      shipmentExpectedDeliveryDate: '2026-08-19',
    });
    assert.equal(result, '2026-08-20');
  });

  it('keeps the same local date when the instant is mid-day UTC', () => {
    const result = resolveEffectiveFulfillmentDate({
      cargoMode: 'FCL',
      containerAppointmentAt: '2026-08-19T12:00:00.000Z',
      shipmentExpectedDeliveryDate: '2026-08-19',
    });
    assert.equal(result, '2026-08-19');
  });

  it('casts legacy noon-UTC date-only encodings to their stored date', () => {
    // Legacy convention: date-only encoded as T12:00:00Z — +07 keeps the
    // same calendar date (19:00 local), so grouping never shifts a day.
    const result = resolveEffectiveFulfillmentDate({
      cargoMode: 'FCL',
      containerAppointmentAt: '2026-01-15T12:00:00.000Z',
    });
    assert.equal(result, '2026-01-15');
  });

  it('falls back to the shipment date when FCL has no appointment', () => {
    const result = resolveEffectiveFulfillmentDate({
      cargoMode: 'FCL',
      containerAppointmentAt: null,
      shipmentExpectedDeliveryDate: '2026-08-21',
    });
    assert.equal(result, '2026-08-21');
  });

  it('ignores the appointment for LCL and uses the shipment date', () => {
    const result = resolveEffectiveFulfillmentDate({
      cargoMode: 'LCL',
      containerAppointmentAt: '2026-08-19T20:00:00.000Z',
      shipmentExpectedDeliveryDate: '2026-08-22',
    });
    assert.equal(result, '2026-08-22');
  });

  it('accepts Date objects for the appointment instant', () => {
    const result = resolveEffectiveFulfillmentDate({
      cargoMode: 'FCL',
      containerAppointmentAt: new Date('2026-08-19T20:00:00.000Z'),
      shipmentExpectedDeliveryDate: '2026-08-19',
    });
    assert.equal(result, '2026-08-20');
  });

  it('returns null when nothing resolves', () => {
    assert.equal(resolveEffectiveFulfillmentDate({ cargoMode: 'FCL' }), null);
    assert.equal(resolveEffectiveFulfillmentDate({ cargoMode: 'LCL' }), null);
    assert.equal(resolveEffectiveFulfillmentDate({ cargoMode: null }), null);
  });
});

describe('localDateInBusinessZone', () => {
  it('maps the UTC-day boundary to the next local date', () => {
    assert.equal(localDateInBusinessZone('2026-08-19T17:00:00.000Z'), '2026-08-20');
    assert.equal(localDateInBusinessZone('2026-08-19T16:59:59.999Z'), '2026-08-19');
  });

  it('returns null for unparseable input', () => {
    assert.equal(localDateInBusinessZone('not-a-date'), null);
  });
});
