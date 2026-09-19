import { describe, expect, it } from 'vitest';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import {
  buildQuickEditDeclarationBody,
  buildQuickEditDraft,
  buildQuickEditPayload,
  factoryDetailPath,
  isQuickEditUnchanged,
  quickEditAccessKeys,
  quickEditDeclarationChanged,
  quickEditSaveIdentity,
} from './cusQuickEditModel';
import { scheduleTime, type ShipmentQuickEditDraft } from './cusUtils';

/** Narrow fixture: only the fields the quick-edit model reads (cast keeps it honest about what matters). */
function makeItem(overrides: Record<string, unknown> & { raw?: Record<string, unknown>; fieldAccess?: Record<string, { mode: string; reason: string }> } = {}): ShipmentCusWorkspaceListItem {
  const { raw, fieldAccess, ...top } = overrides;
  const access = (mode: string) => ({ mode, reason: `reason:${mode}` });
  return {
    id: 7,
    version: 3,
    direction: 'EXPORT',
    transportDate: '2026-09-01',
    customerNotes: 'note-khach',
    operationalNotes: 'note-noi-bo',
    closingAt: '2026-09-01T08:30:00.000Z',
    plannedReturnAt: null,
    raw: {
      factoryName: 'Factory A',
      blNumber: 'BL123',
      bookingRef: 'BK456',
      declarationNumber: 'TK789',
      declarationId: 11,
      declarationIssuedAt: '2026-08-31T02:00:00.000Z' as string | null,
      declarationScope: 'IMPORT' as string | null,
      declarationNote: 'ghi-chu-to-khai' as string | null,
      tradeDirection: 'EXPORT',
      shippingLineName: 'Hãng Tàu X',
      packageCount: 12,
      packageType: 'Pallet',
      cargoWeightKg: '1200',
      cargoVolumeCbm: '3.5',
      ...raw,
    },
    fieldAccess: {
      factoryName: access('EDITABLE'),
      blNumber: access('EDITABLE'),
      bookingRef: access('EDITABLE'),
      declarationNumber: access('EDITABLE'),
      tradeDirection: access('EDITABLE'),
      shippingLineName: access('EDITABLE'),
      packageCount: access('EDITABLE'),
      packageType: access('EDITABLE'),
      cargoWeightKg: access('EDITABLE'),
      cargoVolumeCbm: access('EDITABLE'),
      closingAt: access('EDITABLE'),
      plannedReturnAt: access('EDITABLE'),
      customerNotes: access('EDITABLE'),
      operationalNotes: access('EDITABLE'),
      ...fieldAccess,
    },
    ...top,
  } as unknown as ShipmentCusWorkspaceListItem;
}

function draftFrom(item: ShipmentCusWorkspaceListItem, field: ShipmentQuickEditDraft['field'], overrides: Partial<ShipmentQuickEditDraft> = {}): ShipmentQuickEditDraft {
  return { ...buildQuickEditDraft(item, field), ...overrides };
}

describe('quickEditAccessKeys', () => {
  it('maps each cell group to the fields it may write', () => {
    expect(quickEditAccessKeys('identity')).toEqual(['factoryName']);
    expect(quickEditAccessKeys('documents')).toEqual(['blNumber', 'bookingRef', 'declarationNumber']);
    expect(quickEditAccessKeys('classification')).toEqual(['tradeDirection', 'shippingLineName']);
    expect(quickEditAccessKeys('cargo')).toEqual(['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm']);
    expect(quickEditAccessKeys('notes')).toEqual(['customerNotes', 'operationalNotes']);
  });
});

describe('buildQuickEditDraft', () => {
  it('seeds every mode field from the row (numbers stringified, nulls blanked)', () => {
    const item = makeItem();
    const draft = buildQuickEditDraft(item, 'cargo');
    expect(draft.shipmentId).toBe(7);
    expect(draft.field).toBe('cargo');
    expect(draft.packageCount).toBe('12');
    expect(draft.cargoWeightKg).toBe('1200');
    expect(draft.time).toBe(scheduleTime(item));
    expect(draft.declarationId).toBe(11);
  });

  it('blanks numeric seed when the row carries null', () => {
    const item = makeItem({ raw: { packageCount: null } });
    expect(buildQuickEditDraft(item, 'cargo').packageCount).toBe('');
  });
});

describe('isQuickEditUnchanged', () => {
  it('identity: unchanged until factoryName diverges', () => {
    const item = makeItem();
    expect(isQuickEditUnchanged(draftFrom(item, 'identity'), item)).toBe(true);
    expect(isQuickEditUnchanged(draftFrom(item, 'identity', { factoryName: ' Factory A ' }), item)).toBe(true);
    expect(isQuickEditUnchanged(draftFrom(item, 'identity', { factoryName: 'Factory B' }), item)).toBe(false);
  });

  it('documents: declaration ignored for diff when READ_ONLY', () => {
    const item = makeItem();
    expect(isQuickEditUnchanged(draftFrom(item, 'documents', { declarationNumber: 'CHANGED' }), item)).toBe(false);
    const locked = makeItem({ fieldAccess: { declarationNumber: { mode: 'READ_ONLY', reason: 'locked' } } });
    expect(isQuickEditUnchanged(draftFrom(locked, 'documents', { declarationNumber: 'CHANGED' }), locked)).toBe(true);
  });

  it('cargo: numeric-string equality includes blanked nulls', () => {
    const item = makeItem();
    expect(isQuickEditUnchanged(draftFrom(item, 'cargo'), item)).toBe(true);
    expect(isQuickEditUnchanged(draftFrom(item, 'cargo', { packageCount: '13' }), item)).toBe(false);
  });

  it('schedule: compares against the row-derived time', () => {
    const item = makeItem();
    expect(isQuickEditUnchanged(draftFrom(item, 'schedule'), item)).toBe(true);
    expect(isQuickEditUnchanged(draftFrom(item, 'schedule', { time: '23:59' }), item)).toBe(false);
  });

  it('notes: trims both sides before comparing', () => {
    const item = makeItem();
    expect(isQuickEditUnchanged(draftFrom(item, 'notes', { customerNote: '  note-khach  ' }), item)).toBe(true);
    expect(isQuickEditUnchanged(draftFrom(item, 'notes', { operationalNote: 'khac' }), item)).toBe(false);
  });
});

describe('quickEditSaveIdentity', () => {
  it('binds field + shipment + current row version', () => {
    expect(quickEditSaveIdentity(buildQuickEditDraft(makeItem(), 'cargo'), makeItem())).toBe('cargo:7:3');
  });
});

describe('buildQuickEditPayload', () => {
  it('UI-CD-12 never sends a parent factory label for an FCL container factory', () => {
    const item = makeItem({ cargoMode: 'FCL' });
    expect(buildQuickEditPayload(draftFrom(item, 'identity', { factoryName: 'Wrong parent' }), item)).toEqual({ expectedVersion: 3 });
  });

  it('UI-CD-12 links to container factories without hiding undated rows', () => {
    const item = makeItem({ raw: { customerId: 7 }, billOrBookNumber: 'BL/12345', declarationNumber: null });
    const url = new URL(factoryDetailPath(item), 'http://local');
    expect(url.pathname).toBe('/shipments-detail');
    expect(url.searchParams.get('dateScope')).toBe('all');
    expect(url.searchParams.get('customerId')).toBe('7');
    expect(url.searchParams.get('searchSuffix')).toBe('BL/12345');
    expect(new URL(factoryDetailPath(makeItem({ raw: { customerId: 7 }, billOrBookNumber: null, declarationNumber: 'TK1234' })), 'http://local').searchParams.get('searchSuffix')).toBe('TK1234');
  });
  it('notes field ships multiline text verbatim — no newline stripping on the save path', () => {
    const item = makeItem();
    const note = '- 123\n- ABC';
    const draft = draftFrom(item, 'notes', { customerNote: note, operationalNote: 'L deterioro\ndòng hai' });
    const payload = buildQuickEditPayload(draft, item);
    expect(payload.customerNotes).toBe(note);
    expect((payload.driverNotes as string).includes('\n')).toBe(true);
  });

  it('identity: trims and nulls empty factory names', () => {
    const item = makeItem();
    expect(buildQuickEditPayload(draftFrom(item, 'identity'), item)).toEqual({ expectedVersion: 3, factoryName: 'Factory A' });
    expect(buildQuickEditPayload(draftFrom(item, 'identity', { factoryName: '   ' }), item)).toEqual({ expectedVersion: 3, factoryName: null });
  });

  it('documents IMPORT: ships blNumber and force-clears bookingRef', () => {
    const item = makeItem({ direction: 'IMPORT', raw: { tradeDirection: 'IMPORT' } });
    const draft = draftFrom(item, 'documents', { blNumber: 'BL999' });
    expect(buildQuickEditPayload(draft, item)).toEqual({ expectedVersion: 3, blNumber: 'BL999', bookingRef: null });
  });

  it('documents EXPORT: ships bookingRef and force-clears blNumber', () => {
    const item = makeItem();
    const draft = draftFrom(item, 'documents', { bookingRef: 'BK999' });
    expect(buildQuickEditPayload(draft, item)).toEqual({ expectedVersion: 3, bookingRef: 'BK999', blNumber: null });
  });

  it('documents with both doc fields READ_ONLY: payload carries only the version guard', () => {
    const item = makeItem({ fieldAccess: { blNumber: { mode: 'READ_ONLY', reason: 'x' }, bookingRef: { mode: 'READ_ONLY', reason: 'x' } } });
    expect(buildQuickEditPayload(draftFrom(item, 'documents'), item)).toEqual({ expectedVersion: 3 });
  });

  it('cargo: numeric conversion + read-only metrics omitted', () => {
    const item = makeItem();
    expect(buildQuickEditPayload(draftFrom(item, 'cargo'), item)).toEqual({
      expectedVersion: 3,
      packageCount: 12,
      packageType: 'Pallet',
      cargoWeightKg: '1200',
      cargoVolumeCbm: '3.5',
    });
    const locked = makeItem({ fieldAccess: { cargoWeightKg: { mode: 'READ_ONLY', reason: 'x' }, cargoVolumeCbm: { mode: 'READ_ONLY', reason: 'x' } } });
    expect(buildQuickEditPayload(draftFrom(locked, 'cargo'), locked)).not.toHaveProperty('cargoWeightKg');
  });

  it('seeds the LCL schedule from Vietnam time and writes the same hour back', () => {
    const item = makeItem({ closingAt: '2026-09-01T17:15:00.000Z', transportDate: '2026-09-02' });
    const draft = draftFrom(item, 'schedule');
    expect(draft.time).toBe('00:15');
    expect(buildQuickEditPayload(draft, item)).toMatchObject({ closingAt: '2026-09-02T00:15:00+07:00' });
  });

  it('schedule: EXPORT writes closingAt, IMPORT writes plannedReturnAt, both as explicit Vietnam wall-clock ISO', () => {
    const item = makeItem();
    const draft = draftFrom(item, 'schedule', { date: '2026-09-02', time: '14:30' });
    expect(buildQuickEditPayload(draft, item)).toEqual({
      expectedVersion: 3,
      expectedDeliveryDate: '2026-09-02',
      closingAt: '2026-09-02T14:30:00+07:00',
    });
    const imported = makeItem({ direction: 'IMPORT' });
    expect(buildQuickEditPayload(draftFrom(imported, 'schedule', { date: '2026-09-02', time: '14:30' }), imported)).toEqual({
      expectedVersion: 3,
      expectedDeliveryDate: '2026-09-02',
      plannedReturnAt: '2026-09-02T14:30:00+07:00',
    });
  });

  it('schedule without a time clears the timestamp', () => {
    const item = makeItem();
    expect(buildQuickEditPayload(draftFrom(item, 'schedule', { time: '' }), item)).toMatchObject({ closingAt: null });
  });

  it('notes: trims and nulls both note channels', () => {
    const item = makeItem();
    expect(buildQuickEditPayload(draftFrom(item, 'notes'), item)).toEqual({
      expectedVersion: 3,
      driverNotes: 'note-noi-bo',
      customerNotes: 'note-khach',
    });
  });
});

describe('declaration upsert rules', () => {
  it('flags a change only for documents mode with write access and a diverging number', () => {
    const item = makeItem();
    expect(quickEditDeclarationChanged(draftFrom(item, 'documents', { declarationNumber: 'TK000' }), item)).toBe(true);
    expect(quickEditDeclarationChanged(draftFrom(item, 'documents'), item)).toBe(false);
    expect(quickEditDeclarationChanged(draftFrom(item, 'cargo', { declarationNumber: 'TK000' }), item)).toBe(false);
    const locked = makeItem({ fieldAccess: { declarationNumber: { mode: 'READ_ONLY', reason: 'x' } } });
    expect(quickEditDeclarationChanged(draftFrom(locked, 'documents', { declarationNumber: 'TK000' }), locked)).toBe(false);
  });

  it('resends issuedAt/scope/note verbatim and nulls an emptied number', () => {
    const draft = draftFrom(makeItem(), 'documents', { declarationNumber: '   ' });
    expect(buildQuickEditDeclarationBody(draft)).toEqual({
      declarationNumber: null,
      // Card _5: the body always states the channel — null = cleared, never
      // an accidental keep.
      channel: null,
      issuedAt: '2026-08-31T02:00:00.000Z',
      scope: 'IMPORT',
      note: 'ghi-chu-to-khai',
    });
  });
});

describe('declaration channel (card _5)', () => {
  it('seeds the draft with the row channel', () => {
    const channeled = makeItem({ raw: { declarationChannel: 'YELLOW' } });
    expect(draftFrom(channeled, 'documents').declarationChannel).toBe('YELLOW');
    expect(draftFrom(makeItem(), 'documents').declarationChannel).toBe('');
  });

  it('fires the declaration save for a channel-only change', () => {
    const base = makeItem();
    expect(quickEditDeclarationChanged(draftFrom(base, 'documents', { declarationChannel: 'RED' }), base)).toBe(true);
    expect(isQuickEditUnchanged(draftFrom(base, 'documents', { declarationChannel: 'RED' }), base)).toBe(false);
    // Same channel (both unset) stays unchanged — the PUT never fires.
    expect(isQuickEditUnchanged(draftFrom(base, 'documents'), base)).toBe(true);
  });

  it('carries the channel in the upsert body, unset as null', () => {
    const base = makeItem();
    expect(buildQuickEditDeclarationBody(draftFrom(base, 'documents', { declarationChannel: 'GREEN' })).channel).toBe('GREEN');
    expect(buildQuickEditDeclarationBody(draftFrom(base, 'documents')).channel).toBeNull();
  });

  it('keeps a READ_ONLY declaration number gating the channel too', () => {
    const locked = makeItem({ fieldAccess: { declarationNumber: { mode: 'READ_ONLY', reason: 'locked' } } });
    expect(quickEditDeclarationChanged(draftFrom(locked, 'documents', { declarationChannel: 'RED' }), locked)).toBe(false);
  });
});
