/**
 * QA-125 regression: /uploads must NOT be publicly served.
 *
 * The Express app previously mounted `express.static(config.uploadDir)` at
 * `/uploads`, allowing anonymous access to protected evidence files (trip
 * photos, receipts, fuel evidence). All evidence must go through the
 * authenticated `/api/photos` route instead.
 *
 * This test reads the source file to confirm the static mount line was
 * removed. If the mount is re-introduced, this test fails.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('QA-125: /uploads public mount removed', () => {
  it('backend/src/index.ts does not mount express.static at /uploads', () => {
    const indexPath = path.resolve(__dirname, '..', 'index.ts');
    const source = readFileSync(indexPath, 'utf-8');

    // The dangerous line: app.use('/uploads', express.static(config.uploadDir));
    const hasPublicMount = source.split('\n').some(
      (line) => line.includes("'/uploads'") && line.includes('express.static'),
    );

    assert.equal(
      hasPublicMount,
      false,
      'index.ts still mounts express.static at /uploads — evidence files are publicly accessible!',
    );
  });
});
