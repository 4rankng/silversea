import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import {
  createDispatchTaskTag,
  deactivateDispatchTaskTag,
  listDispatchTaskTags,
  normalizeDispatchTaskTagLabel,
  updateDispatchTaskTag,
} from '../services/dispatch-task-tags.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTagIds: number[] = [];

// created_by carries no FK — a fake actor is enough for service-level tests
// (no real user row needed; JWT/casbin aren't exercised here).
const actor: AuthUser = {
  userId: 0,
  username: null,
  email: null,
  fullName: null,
  role: Role.DISPATCHER,
};

// Labels must be unique per test: normalized_label is UNIQUE across the
// table (active or not) and rows survive until the after() cleanup, so two
// tests reusing the same label would 409 each other.
let labelSeq = 0;
function uniq(prefix: string): string {
  return `${prefix} ${suffix} #${++labelSeq}`;
}

async function mkTag(label: string) {
  const created = await createDispatchTaskTag({ label, actor });
  createdTagIds.push(created.id);
  return created;
}

async function tagRow(id: number) {
  const [row] = await db.select().from(s.dispatchTaskTags)
    .where(eq(s.dispatchTaskTags.id, id));
  return row;
}

function assertApiError(err: unknown, status: number, message: string) {
  assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
  assert.equal(err.statusCode, status);
  assert.equal(err.message, message);
}

after(async () => {
  if (createdTagIds.length > 0) {
    await db.delete(s.dispatchTaskTags)
      .where(inArray(s.dispatchTaskTags.id, createdTagIds));
  }
  await client.end();
});

describe('dispatch-task-tags service', () => {
  describe('legacy GẮP normalized keys', () => {
    async function legacyTag(isActive = true) {
      const label = uniq('GẮP VỎ ICD QUẾ VÕ');
      const [row] = await db.insert(s.dispatchTaskTags).values({
        label,
        normalizedLabel: normalizeDispatchTaskTagLabel(label).replace('gắp', 'gặp'),
        isActive,
        createdBy: actor.userId,
      }).returning();
      createdTagIds.push(row.id);
      return row;
    }

    it('VID-TAG-01: rejects visible duplicates despite a legacy incorrect normalized key', async () => {
      const legacy = await legacyTag();
      for (const label of [legacy.label, legacy.label.toLowerCase(), legacy.label.normalize('NFD')]) {
        await assert.rejects(
          () => createDispatchTaskTag({ label, actor }),
          (err) => (assertApiError(err, 409, 'Tag đã tồn tại.'), true),
        );
      }
      const { items } = await listDispatchTaskTags();
      assert.equal(items.filter(item => normalizeDispatchTaskTagLabel(item.label) === normalizeDispatchTaskTagLabel(legacy.label)).length, 1);
    });

    it('VID-TAG-02: revives the legacy row and repairs its normalized key', async () => {
      const legacy = await legacyTag(false);
      const revived = await createDispatchTaskTag({ label: legacy.label.toLowerCase(), actor });
      createdTagIds.push(revived.id);
      assert.equal(revived.id, legacy.id);
      const row = await tagRow(legacy.id);
      assert.equal(row.normalizedLabel, normalizeDispatchTaskTagLabel(legacy.label));
      assert.equal(row.isActive, true);
    });

    it('VID-TAG-03: prevents rename onto active or inactive legacy visible labels', async () => {
      const custom = await mkTag(uniq('TÁC VỤ RIÊNG'));
      for (const active of [true, false]) {
        const legacy = await legacyTag(active);
        await assert.rejects(
          () => updateDispatchTaskTag({ id: custom.id, label: legacy.label, actor }),
          (err) => (assertApiError(err, 409, 'Tag đã tồn tại.'), true),
        );
        assert.equal((await tagRow(custom.id)).label, custom.label);
      }
    });

    it('VID-TAG-04: retains the legacy row when repairing its own label', async () => {
      const legacy = await legacyTag();
      const updated = await updateDispatchTaskTag({ id: legacy.id, label: legacy.label, actor });
      assert.equal(updated.id, legacy.id);
      assert.equal((await tagRow(legacy.id)).normalizedLabel, normalizeDispatchTaskTagLabel(legacy.label));
    });
  });

  describe('listDispatchTaskTags (canonical operation-tag set, ticket a6cb2543)', () => {
    it('lists the 14 canonical tags verbatim, in display order, first', async () => {
      const { items } = await listDispatchTaskTags();
      // Migration 0066 seeds the canonical set (display_order 1–14); any
      // dispatcher-added labels list after it. A test-created tag could push
      // extra tail items, so the pin is prefix-equality on the canonical 14.
      const canonical = items.filter((item) => item.displayOrder != null).slice(0, 14);
      assert.deepEqual(
        canonical.map((item) => item.label),
        [
          'HẾT HẠN',
          'ĐẢO VỎ',
          'ĐẶT ĐUÔI',
          'ĐẶT ĐẦU',
          'KIỂM HÓA',
          'QUAY ĐẦU',
          'GỬI VỎ BÃI ĐĂNG KHOA',
          'QUÁ TẢI',
          'ĐẢO HÀNG',
          'HẠ VỎ ICD QUẾ VÕ',
          'GẮP VỎ ICD QUẾ VÕ',
          'GẮP VỎ BÃI ĐĂNG KHOA',
          'HẠ VỎ BÃI TRI PHƯƠNG',
          'GẮP VỎ BÃI TRI PHƯƠNG',
        ],
      );
      assert.deepEqual(
        canonical.map((item) => item.displayOrder),
        Array.from({ length: 14 }, (_, i) => i + 1),
      );
    });

    it('lists dispatcher-added labels after the canonical set, alphabetically', async () => {
      const extra = await mkTag(uniq('zz canonical tail'));
      const { items } = await listDispatchTaskTags();
      const canonicalCount = items.filter((item) => item.displayOrder != null).length;
      const tail = items.slice(canonicalCount);
      assert.ok(tail.some((item) => item.id === extra.id));
      assert.equal(items.find((item) => item.id === extra.id)?.displayOrder ?? null, null);
    });
  });

  describe('createDispatchTaskTag', () => {
    it('creates a tag with trimmed label, normalized key, and author', async () => {
      const label = uniq('Giao bãi');
      const created = await mkTag(`  ${label}  `);
      assert.equal(created.label, label);
      const row = await tagRow(created.id);
      assert.ok(row);
      assert.equal(row.label, label);
      assert.equal(row.normalizedLabel, normalizeDispatchTaskTagLabel(label));
      assert.equal(row.isActive, true);
      assert.equal(row.createdBy, actor.userId);
    });

    it('409 on an active duplicate, exact or casing-only', async () => {
      const label = uniq('Keo');
      await mkTag(label);
      await assert.rejects(
        () => createDispatchTaskTag({ label, actor }),
        (err) => (assertApiError(err, 409, 'Tag đã tồn tại.'), true),
      );
      await assert.rejects(
        () => createDispatchTaskTag({ label: label.toUpperCase(), actor }),
        (err) => (assertApiError(err, 409, 'Tag đã tồn tại.'), true),
      );
    });

    it('resurrects a soft-deleted label instead of 409', async () => {
      const label = uniq('Xếp container');
      const first = await mkTag(label);
      await deactivateDispatchTaskTag({ id: first.id });

      // Re-creating with different casing reactivates the SAME row — the
      // unique normalized_label key was never released by the soft delete.
      const again = await createDispatchTaskTag({ label: label.toUpperCase(), actor });
      createdTagIds.push(again.id);
      assert.equal(again.id, first.id);
      const row = await tagRow(first.id);
      assert.equal(row.isActive, true);
      assert.equal(row.label, label.toUpperCase());
      assert.equal(row.createdBy, actor.userId);
    });

    it('rejects empty, over-80, semicolon, and NFC-expanding labels', async () => {
      await assert.rejects(
        () => createDispatchTaskTag({ label: '   ', actor }),
        (err) => (assertApiError(err, 400, 'Tên tag phải từ 1 đến 80 ký tự.'), true),
      );
      await assert.rejects(
        () => createDispatchTaskTag({ label: 'a'.repeat(81), actor }),
        (err) => (assertApiError(err, 400, 'Tên tag phải từ 1 đến 80 ký tự.'), true),
      );
      await assert.rejects(
        () => createDispatchTaskTag({ label: `Keo; ${uniq('x')}`, actor }),
        (err) => (assertApiError(err, 400, 'Tên tag không được chứa dấu ;'), true),
      );
      // NFC lowering expands 'İ' to 'i̇' (2 code points) → normalized > 80.
      await assert.rejects(
        () => createDispatchTaskTag({ label: 'İ'.repeat(80), actor }),
        (err) => (assertApiError(err, 400, 'Tên tag quá dài sau khi chuẩn hóa.'), true),
      );
    });
  });
  describe('updateDispatchTaskTag', () => {
    it('renames a tag and refreshes the normalized key', async () => {
      const tag = await mkTag(uniq('Keo'));
      const next = uniq('Cẩu');
      const updated = await updateDispatchTaskTag({ id: tag.id, label: `  ${next}  `, actor });
      assert.deepEqual(updated, { id: tag.id, label: next });
      const row = await tagRow(tag.id);
      assert.equal(row.label, next);
      assert.equal(row.normalizedLabel, normalizeDispatchTaskTagLabel(next));
    });

    it('allows a casing-only rename on the same row', async () => {
      const label = uniq('Keo');
      const tag = await mkTag(label);
      const updated = await updateDispatchTaskTag({ id: tag.id, label: label.toUpperCase(), actor });
      assert.deepEqual(updated, { id: tag.id, label: label.toUpperCase() });
      const row = await tagRow(tag.id);
      assert.equal(row.label, label.toUpperCase());
      assert.equal(row.normalizedLabel, normalizeDispatchTaskTagLabel(label));
    });

    it('409 when another active row holds the label', async () => {
      const a = await mkTag(uniq('Keo'));
      const b = await mkTag(uniq('Cẩu'));
      await assert.rejects(
        () => updateDispatchTaskTag({ id: b.id, label: a.label, actor }),
        (err) => (assertApiError(err, 409, 'Tag đã tồn tại.'), true),
      );
      const row = await tagRow(b.id);
      assert.equal(row.label, b.label); // unchanged
      assert.equal(row.normalizedLabel, normalizeDispatchTaskTagLabel(b.label));
    });

    it('409 even when the conflicting key is held by an inactive row', async () => {
      const a = await mkTag(uniq('Keo'));
      const b = await mkTag(uniq('Cẩu'));
      await deactivateDispatchTaskTag({ id: a.id });
      await assert.rejects(
        () => updateDispatchTaskTag({ id: b.id, label: a.label, actor }),
        (err) => (assertApiError(err, 409, 'Tag đã tồn tại.'), true),
      );
    });

    it('404 on an unknown id', async () => {
      await assert.rejects(
        () => updateDispatchTaskTag({ id: 2_000_000_000, label: uniq('X'), actor }),
        (err) => (assertApiError(err, 404, 'Tag không tồn tại.'), true),
      );
    });

    it('applies the same validation as create', async () => {
      const tag = await mkTag(uniq('Keo'));
      await assert.rejects(
        () => updateDispatchTaskTag({ id: tag.id, label: '   ', actor }),
        (err) => (assertApiError(err, 400, 'Tên tag phải từ 1 đến 80 ký tự.'), true),
      );
      await assert.rejects(
        () => updateDispatchTaskTag({ id: tag.id, label: 'a'.repeat(81), actor }),
        (err) => (assertApiError(err, 400, 'Tên tag phải từ 1 đến 80 ký tự.'), true),
      );
      await assert.rejects(
        () => updateDispatchTaskTag({ id: tag.id, label: `Keo; ${uniq('x')}`, actor }),
        (err) => (assertApiError(err, 400, 'Tên tag không được chứa dấu ;'), true),
      );
      await assert.rejects(
        () => updateDispatchTaskTag({ id: tag.id, label: 'İ'.repeat(80), actor }),
        (err) => (assertApiError(err, 400, 'Tên tag quá dài sau khi chuẩn hóa.'), true),
      );
    });
  });

  describe('deactivateDispatchTaskTag', () => {
    it('soft-deletes an active tag', async () => {
      const tag = await mkTag(uniq('Xếp dỡ'));
      assert.deepEqual(await deactivateDispatchTaskTag({ id: tag.id }), { ok: true });
      const row = await tagRow(tag.id);
      assert.equal(row.isActive, false);
    });

    it('is idempotent on an already-inactive row', async () => {
      const tag = await mkTag(uniq('Xếp dỡ'));
      await deactivateDispatchTaskTag({ id: tag.id });
      assert.deepEqual(await deactivateDispatchTaskTag({ id: tag.id }), { ok: true });
      const row = await tagRow(tag.id);
      assert.equal(row.isActive, false);
    });

    it('404 on an unknown id', async () => {
      await assert.rejects(
        () => deactivateDispatchTaskTag({ id: 2_000_000_000 }),
        (err) => (assertApiError(err, 404, 'Tag không tồn tại.'), true),
      );
    });
  });
});
