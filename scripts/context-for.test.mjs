import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import {
  defaultRepoRoot,
  loadManifest,
  resolveContext,
  validateManifest,
} from './context-for.mjs';

const manifest = loadManifest();

describe('development context resolver', () => {
  test('selects backend and financial profiles for an overlapping service path', () => {
    const result = resolveContext(manifest, {
      inputs: ['backend/src/services/financial.service.ts'],
    });
    assert.deepEqual(result.profiles, ['backend-api', 'financial']);
    assert.ok(result.context.includes('backend/src/index.ts'));
    assert.ok(result.context.includes('shared/src/calculations/round.ts'));
    assert.equal(result.context.length, new Set(result.context).size);
  });

  test('selects a profile from task language', () => {
    const result = resolveContext(manifest, { inputs: ['fix responsive mobile UI'] });
    assert.deepEqual(result.profiles, ['frontend']);
    assert.ok(result.qa.includes('cd frontend && pnpm test'));
  });

  test('short keywords match whole tokens instead of substrings', () => {
    const result = resolveContext(manifest, { inputs: ['build backend API'] });
    assert.ok(result.profiles.includes('backend-api'));
    assert.equal(result.profiles.includes('frontend'), false);
  });

  test('supports an explicit profile without a matching path', () => {
    const result = resolveContext(manifest, {
      inputs: ['unclassified task'],
      explicitProfiles: ['database'],
    });
    assert.deepEqual(result.profiles, ['database']);
    assert.ok(result.qa.includes('cd e2e && ./run_all.sh'));
  });

  test('no match returns only bounded base context', () => {
    const result = resolveContext(manifest, { inputs: ['unclassified task'] });
    assert.equal(result.matched, false);
    const expected = [
      ...manifest.base,
      ...manifest.optional.filter((entry) => existsSync(`${defaultRepoRoot}/${entry}`)),
    ];
    assert.deepEqual(result.context, expected);
    assert.deepEqual(result.qa, []);
  });

  test('missing optional context does not invalidate or pollute a clean checkout', () => {
    const withoutLocalHandoff = {
      ...manifest,
      optional: ['does-not-exist.md'],
    };
    const result = resolveContext(withoutLocalHandoff, { inputs: [] });
    assert.deepEqual(result.context, manifest.base);
    assert.deepEqual(validateManifest(withoutLocalHandoff), []);
  });

  test('absolute paths inside the repository are normalized', () => {
    const result = resolveContext(manifest, {
      inputs: [`${defaultRepoRoot}/frontend/src/App.tsx`],
    });
    assert.ok(result.profiles.includes('frontend'));
  });

  test('path inputs do not match natural-language keywords from other profiles', () => {
    const frontendDocs = resolveContext(manifest, {
      inputs: ['frontend/docs/api-layers.md'],
    });
    assert.deepEqual(frontendDocs.profiles, ['frontend']);

    const databaseSchema = resolveContext(manifest, {
      inputs: ['backend/src/db/schema.ts'],
    });
    assert.deepEqual(databaseSchema.profiles, ['database']);
  });

  test('slash-delimited task language still uses keyword matching', () => {
    const apiRbac = resolveContext(manifest, {
      inputs: ['API/RBAC authorization change'],
    });
    assert.ok(apiRbac.profiles.includes('backend-api'));

    const backendApi = resolveContext(manifest, {
      inputs: ['backend/API service'],
    });
    assert.ok(backendApi.profiles.includes('backend-api'));

    const frontendApi = resolveContext(manifest, {
      inputs: ['frontend UI/API'],
    });
    assert.ok(frontendApi.profiles.includes('frontend'));
    assert.ok(frontendApi.profiles.includes('backend-api'));
  });

  test('paths outside the repository do not infer profiles', () => {
    const result = resolveContext(manifest, {
      inputs: ['/tmp/frontend/agent-runtime.ts', '../backend/src/routes/users.ts'],
    });
    assert.deepEqual(result.profiles, []);
    assert.equal(result.matched, false);
  });
});

describe('development context manifest', () => {
  test('resolves using only tracked context files, without local plans or handoff', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'silversea-context-'));
    try {
      const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: defaultRepoRoot, encoding: 'utf8' }).split('\0'));
      const required = [...manifest.base, ...manifest.profiles.flatMap((profile) => profile.context)];
      for (const path of new Set(required)) {
        assert.ok(tracked.has(path), `required context must be tracked: ${path}`);
        mkdirSync(dirname(join(fixture, path)), { recursive: true });
        copyFileSync(join(defaultRepoRoot, path), join(fixture, path));
      }
      assert.deepEqual(validateManifest(manifest, fixture), []);
      const result = resolveContext(manifest, { inputs: ['frontend/src/App.tsx'], repoRoot: fixture });
      assert.ok(result.profiles.includes('frontend'));
      assert.ok(!result.context.includes('HANDOFF.md'));
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
  test('the checked-in manifest is structurally valid and all context files exist', () => {
    assert.deepEqual(validateManifest(manifest), []);
  });

  test('reports duplicate profiles and missing context files', () => {
    const invalid = {
      version: 1,
      base: ['missing.md'],
      optional: [],
      profiles: [
        {
          id: 'duplicate',
          description: 'first',
          match: { prefixes: [], exact: [], contains: [], keywords: [] },
          context: ['CONTEXT.md'],
          qa: ['pnpm lint'],
        },
        {
          id: 'duplicate',
          description: 'second',
          match: { prefixes: [], exact: [], contains: [], keywords: [] },
          context: ['CONTEXT.md'],
          qa: ['pnpm lint'],
        },
      ],
    };
    const errors = validateManifest(invalid, defaultRepoRoot);
    assert.ok(errors.includes('duplicate profile id: duplicate'));
    assert.ok(errors.includes('context path does not exist: missing.md'));
  });

  test('rejects context paths that escape the repository', () => {
    const invalid = {
      version: 1,
      base: ['../outside.md'],
      optional: ['../../optional.md'],
      profiles: [],
    };
    const errors = validateManifest(invalid, defaultRepoRoot);
    assert.ok(errors.includes('context path must be repository-relative: ../outside.md'));
    assert.ok(errors.includes('optional context path must be repository-relative: ../../optional.md'));
  });

  test('rejects malformed manifests and non-string match rules without throwing', () => {
    assert.deepEqual(validateManifest(null), ['manifest must be an object']);
    const invalid = {
      version: 1,
      base: ['CONTEXT.md'],
      optional: [],
      profiles: [
        {
          id: 'bad-rules',
          description: 'invalid match entry',
          match: { prefixes: [42], exact: [], contains: [], keywords: [] },
          context: ['CONTEXT.md'],
          qa: ['pnpm lint'],
        },
      ],
    };
    assert.ok(
      validateManifest(invalid).includes(
        'bad-rules: match.prefixes entries must be non-empty strings',
      ),
    );
  });
});
