import assert from 'node:assert/strict';
import test from 'node:test';
import { portSeedCode } from '../../seed/seed-ports';

test('keeps the approved Lạch Huyện terminal codes independent of display labels', () => {
  assert.equal(portSeedCode('TC - HICT'), 'HICT');
  assert.equal(portSeedCode('TIL - HTIT'), 'HTIT');
  assert.equal(portSeedCode('Hateco - HHIT'), 'HHIT');
});
