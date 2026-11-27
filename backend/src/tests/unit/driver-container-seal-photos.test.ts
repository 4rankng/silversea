import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// UI-13 (QA 27/11, trip 36): the driver fulfillment detail's container/seal
// photo list exposed RAW trip_photos rows, so storage keys purged from the
// object store rode the wire and the "Ảnh n/3" counter promised tiles that
// 404'd on the driver's phone. The assembly must gate every row through the
// same existingStorageKeys helper (storageService.exists) the trip-detail
// cont/seal path uses — dead keys drop off the wire and the client's labelled
// empty placeholder covers the gap. (Restoring trip-36's photos themselves is
// a staging re-upload, not code.)
describe('driver container/seal photos expose only live storage keys (UI-13)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/services/driver.service.ts'), 'utf8');

  it('the containerSealPhotos assembly filters its rows through existingStorageKeys', () => {
    // The gate runs on the rows' keys BEFORE the wire mapping; the assembly
    // then keeps only rows whose key survived it.
    assert.match(source, /await existingStorageKeys\(containerSealPhotoRows\.map\(\(row\) => row\.storageKey\)\)/);
    const assembly = source.match(/const containerSealPhotos = containerSealPhotoRows[\s\S]*?uploadedAt: row\.uploadedAt\.toISOString\(\),[\s\S]*?\}\)\);/)?.[0] ?? '';
    assert.notEqual(assembly, '', 'the containerSealPhotos assembly exists');
    assert.match(assembly, /\.filter\(\(row\) => liveContainerSealKeys\.has\(row\.storageKey\)\)/);
  });

  it('the gate tolerates storage errors — a failed exists check drops the key', () => {
    const gate = source.match(/async function existingStorageKeys\(keys: string\[\]\): Promise<string\[\]> \{[\s\S]*?\n\}/)?.[0] ?? '';
    assert.notEqual(gate, '', 'the existingStorageKeys helper exists');
    assert.match(gate, /storageService\.exists/);
    assert.match(gate, /catch/);
    assert.match(gate, /filter\(\(key\): key is string =>/);
  });
});
