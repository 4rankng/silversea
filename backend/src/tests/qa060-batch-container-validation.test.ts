/**
 * QA-060 rework: tripContainerBatchSchema ISO 6346 gate.
 *
 * The batch PUT /api/trips/:id/containers must reject malformed container
 * numbers at the schema boundary, matching the driver/forwarder add paths.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tripContainerBatchSchema } from '@tingting/shared';

const valid = (containerNumber: string | null) => ({
  containers: [{ containerNumber }],
});

describe('QA-060 — tripContainerBatchSchema ISO 6346 gate', () => {
  test('rejects malformed ABC (format)', () => {
    const r = tripContainerBatchSchema.safeParse(valid('ABC'));
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some(i =>
        i.message.includes('định dạng')));
    }
  });

  test('rejects CONT-001 (format)', () => {
    const r = tripContainerBatchSchema.safeParse(valid('CONT-001'));
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some(i =>
        i.message.includes('định dạng')));
    }
  });

  test('rejects valid format but bad check digit MSKU1234567', () => {
    const r = tripContainerBatchSchema.safeParse(valid('MSKU1234567'));
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some(i =>
        i.message.includes('chữ số kiểm tra')));
    }
  });

  test('accepts valid container MSKU1234565', () => {
    const r = tripContainerBatchSchema.safeParse(valid('MSKU1234565'));
    assert.equal(r.success, true);
  });

  test('accepts valid container TCLU1234568', () => {
    const r = tripContainerBatchSchema.safeParse(valid('TCLU1234568'));
    assert.equal(r.success, true);
  });

  test('allows null containerNumber (placeholder row)', () => {
    const r = tripContainerBatchSchema.safeParse(valid(null));
    assert.equal(r.success, true);
  });

  test('allows undefined containerNumber', () => {
    const r = tripContainerBatchSchema.safeParse({ containers: [{}] });
    assert.equal(r.success, true);
  });

  test('error path targets the correct container index', () => {
    const r = tripContainerBatchSchema.safeParse({
      containers: [
        { containerNumber: 'MSKU1234565' }, // valid
        { containerNumber: 'ABC' },          // invalid
      ],
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.deepEqual(r.error.issues[0].path, ['containers', 1, 'containerNumber']);
    }
  });
});
