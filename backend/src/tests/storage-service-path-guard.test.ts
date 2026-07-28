import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { config } from '../config';
import { LocalStorageService } from '../services/storage.service';

describe('LocalStorageService path guard', () => {
  it('stores files under uploadDir and rejects traversal keys', async () => {
    const originalUploadDir = config.uploadDir;
    const tempDir = await mkdtemp(path.join(tmpdir(), 'silversea-storage-'));
    try {
      (config as { uploadDir: string }).uploadDir = tempDir;
      const service = new LocalStorageService();

      await service.upload(Buffer.from('ok'), 'nested/file.txt');
      assert.equal(await service.exists('nested/file.txt'), true);

      await assert.rejects(
        () => service.upload(Buffer.from('x'), '../escape.txt'),
        /Invalid storage key/,
      );
      await assert.rejects(
        () => service.exists('../escape.txt'),
        /Invalid storage key/,
      );
      await assert.rejects(
        () => service.delete('../escape.txt'),
        /Invalid storage key/,
      );
      assert.equal(await service.read('../escape.txt'), null);
    } finally {
      (config as { uploadDir: string }).uploadDir = originalUploadDir;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
