import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tripEventNotificationMessage } from '../../lib/business-keys';

// SIL-1296 (id 1596) — a trip-lifecycle notification must name the work it
// talks about. Reference chain per display law §8: số Bill/Booking first,
// biển số second (business references only — the internal TRP-* code never
// rides a body because the display layer strips it and the sentence rendered
// context-free, the QA repro). No reference at all → the bare sentence, never
// a fabricated placeholder.

describe('tripEventNotificationMessage — reference chain (SIL-1296)', () => {
  it('names the trip by Bill/Booking when it carries one', () => {
    assert.equal(tripEventNotificationMessage('đã bị hủy', 'P2-R85-B'), 'Chuyến P2-R85-B đã bị hủy');
    assert.equal(tripEventNotificationMessage('đã được tạo', ' BL-26-01 '), 'Chuyến BL-26-01 đã được tạo');
  });

  it('falls back to the biển số when there is no Bill/Booking', () => {
    assert.equal(tripEventNotificationMessage('đã bị hủy', null, '51H-123.45'), 'Chuyến của xe 51H-123.45 đã bị hủy');
    assert.equal(tripEventNotificationMessage('đã được điều phối', '', '29H-456.78'), 'Chuyến của xe 29H-456.78 đã được điều phối');
  });

  it('prefers the Bill/Booking over the plate', () => {
    assert.equal(
      tripEventNotificationMessage('đã hoàn thành', 'QA-BOOK-1', '51H-123.45'),
      'Chuyến QA-BOOK-1 đã hoàn thành',
    );
  });

  it('keeps the bare sentence when the trip carries neither reference', () => {
    assert.equal(tripEventNotificationMessage('đã bị hủy', null, null), 'Chuyến đã bị hủy');
    assert.equal(tripEventNotificationMessage('đã bị hủy', '   ', '  '), 'Chuyến đã bị hủy');
  });
});
