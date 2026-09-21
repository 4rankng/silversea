import { describe, expect, it } from 'vitest';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import {
  buildQuickEditDraft,
  buildQuickEditPayload,
  diffQuickEditDeclarations,
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
      declarationScope: 'SINGLE' as string | null,
      declarationNote: 'ghi-chu-to-khai' as string | null,
      declarations: [
        {
          id: 11,
          declarationNumber: 'TK789',
          channel: null,
          issuedAt: '2026-08-31T02:00:00.000Z',
          scope: 'SINGLE',
          note: 'ghi-chu-to-khai',
        },
      ] as unknown as Array<{ id: number; declarationNumber: string | null; channel: 'RED' | 'YELLOW' | 'GREEN' | null; issuedAt: string | null; scope: 'SINGLE' | 'SHARED' | null; note: string | null }>,
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
    expect(draft.declarations.map((row) => row.id)).toEqual([11]);
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

  it('documents: declaration list diff ignored when READ_ONLY', () => {
    const item = makeItem();
    const withNewRow = draftFrom(item, 'documents');
    withNewRow.declarations = [...withNewRow.declarations, { id: null, declarationNumber: 'TK-NEW', declarationChannel: '', declarationIssuedAt: null, declarationScope: null, declarationNote: null }];
    expect(isQuickEditUnchanged(withNewRow, item)).toBe(false);
    const locked = makeItem({ fieldAccess: { declarationNumber: { mode: 'READ_ONLY', reason: 'locked' } } });
    expect(isQuickEditUnchanged(draftFrom(locked, 'documents', {}), locked)).toBe(true);
    expect(isQuickEditUnchanged(withNewRow, locked)).toBe(true);
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
  it('flags a change only for documents mode with write access and a diverging list', () => {
    const item = makeItem();
    const changed = draftFrom(item, 'documents');
    changed.declarations[0].declarationNumber = 'TK000';
    expect(quickEditDeclarationChanged(changed, item)).toBe(true);
    expect(quickEditDeclarationChanged(draftFrom(item, 'documents'), item)).toBe(false);
    expect(quickEditDeclarationChanged(draftFrom(item, 'cargo'), item)).toBe(false);
    const locked = makeItem({ fieldAccess: { declarationNumber: { mode: 'READ_ONLY', reason: 'x' } } });
    expect(quickEditDeclarationChanged(draftFrom(locked, 'documents'), locked)).toBe(false);
  });

  it('resends issuedAt/scope/note verbatim and nulls an emptied number', () => {
    const draft = draftFrom(makeItem(), 'documents');
    draft.declarations[0].declarationNumber = '   ';
    const diff = diffQuickEditDeclarations(draft, makeItem());
    expect(diff.updates).toEqual([{
      id: 11,
      body: {
        declarationNumber: null,
        // Card _5: the body always states the channel — null = cleared, never
        // an accidental keep.
        channel: null,
        issuedAt: '2026-08-31T02:00:00.000Z',
        scope: 'SINGLE',
        note: 'ghi-chu-to-khai',
      },
    }]);
    expect(diff.deletes).toEqual([]);
    expect(diff.creates).toEqual([]);
  });
});

describe('declaration channel (card _5, row-level)', () => {
  it('seeds each draft row with its stored channel', () => {
    const channeled = makeItem({ raw: { declarations: [{ id: 11, declarationNumber: 'TK789', channel: 'YELLOW', issuedAt: null, scope: 'SINGLE', note: null }] } });
    expect(draftFrom(channeled, 'documents').declarations[0].declarationChannel).toBe('YELLOW');
    expect(draftFrom(makeItem(), 'documents').declarations[0].declarationChannel).toBe('');
  });

  it('fires the declaration save for a channel-only change on an existing row', () => {
    const base = makeItem();
    const red = draftFrom(base, 'documents');
    red.declarations[0].declarationChannel = 'RED';
    expect(quickEditDeclarationChanged(red, base)).toBe(true);
    expect(isQuickEditUnchanged(red, base)).toBe(false);
    // Untouched rows stay unchanged — the PUT never fires.
    expect(isQuickEditUnchanged(draftFrom(base, 'documents'), base)).toBe(true);
  });

  it('carries the channel in the update body, unset as null', () => {
    const base = makeItem();
    const green = draftFrom(base, 'documents');
    green.declarations[0].declarationChannel = 'GREEN';
    const diff = diffQuickEditDeclarations(green, base);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].body.channel).toBe('GREEN');
    expect(diffQuickEditDeclarations(draftFrom(base, 'documents'), base).updates[0]?.body.channel ?? null).toBeNull();
  });

  it('keeps a READ_ONLY declaration number gating the channel too', () => {
    const locked = makeItem({ fieldAccess: { declarationNumber: { mode: 'READ_ONLY', reason: 'locked' } } });
    const red = draftFrom(locked, 'documents');
    red.declarations[0].declarationChannel = 'RED';
    expect(quickEditDeclarationChanged(red, locked)).toBe(false);
  });
});

describe('multi-row diff (card 20260921_3)', () => {
  it('creates a POST only for a new row carrying a number or channel', () => {
    const item = makeItem();
    const draft = draftFrom(item, 'documents');
    draft.declarations.push({ id: null, declarationNumber: 'TK-2', declarationChannel: 'YELLOW', declarationIssuedAt: null, declarationScope: null, declarationNote: null });
    draft.declarations.push({ id: null, declarationNumber: '', declarationChannel: '', declarationIssuedAt: null, declarationScope: null, declarationNote: null });
    const diff = diffQuickEditDeclarations(draft, item);
    expect(diff.creates).toEqual([{
      declarationNumber: 'TK-2',
      channel: 'YELLOW',
      issuedAt: null,
      scope: undefined,
      note: null,
    }]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it('deletes stored rows removed in the draft, after updates and before creates semantically', () => {
    const item = makeItem();
    const draft = draftFrom(item, 'documents');
    draft.declarations = [];
    const diff = diffQuickEditDeclarations(draft, item);
    expect(diff.deletes).toEqual([11]);
    expect(diff.updates).toEqual([]);
    expect(diff.creates).toEqual([]);
  });

  it('ignores stale ids for writes but still deletes seed rows absent from the draft', () => {
    const item = makeItem();
    const draft = draftFrom(item, 'documents');
    draft.declarations = [{ id: 999, declarationNumber: 'GHOST', declarationChannel: '', declarationIssuedAt: null, declarationScope: null, declarationNote: null }];
    const diff = diffQuickEditDeclarations(draft, item);
    // Ghost 999 produces no write; seed row 11 was removed in the modal, so
    // it deletes. A row ADDED concurrently (never seeded) can never delete.
    expect(diff.updates).toEqual([]);
    expect(diff.creates).toEqual([]);
    expect(diff.deletes).toEqual([11]);
  });

  it('never deletes a declaration added concurrently after the modal opened', () => {
    const item = makeItem();
    const draft = draftFrom(item, 'documents');
    item.raw = { ...item.raw, declarations: [...(item.raw.declarations ?? []), { id: 12, declarationNumber: 'TK-CONCURRENT', channel: null, issuedAt: null, scope: 'SINGLE', note: null }] };
    const diff = diffQuickEditDeclarations(draft, item);
    expect(diff.deletes).toEqual([]);
    expect(diff.updates).toEqual([]);
    expect(diff.creates).toEqual([]);
  });
});
