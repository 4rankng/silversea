import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260928_192 — one dev port contract, asserted against the files that
 * actually decide it.
 *
 * The failure this pins is SILENT. `frontend/vite.config.ts` said 7174 + proxy
 * 3001 while the Makefile served 7175 + proxy 3002, every QA harness defaulted
 * to 7175, and an ignored local environment file supplied PORT=3002. Running the short command gave you
 * a server whose `/api` calls went to a port nothing was listening on, and the
 * resulting 401/403 reads as an auth bug, so it gets debugged as one.
 *
 * Read the versioned startup commands, with machine overrides removed, so a
 * fresh checkout needs no ignored environment file to check its port contract.
 */
const repoFile = (p: string) => readFileSync(resolve(process.cwd(), '..', p), 'utf8');
const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
const makeEnvironment = { ...process.env };
for (const key of ['PORT', 'DATABASE_URL', 'VITE_API_PROXY_TARGET', 'DEV_BACKEND_PORT',
  'DEV_FRONTEND_PORT', 'DEV_DATABASE_URL', 'DEV_API_PROXY_TARGET']) delete makeEnvironment[key];
const dryRun = (target: string, env = makeEnvironment) => execFileSync('make',
  ['--no-print-directory', '-n', target], {
    cwd: resolve(process.cwd(), '..'), env, encoding: 'utf8',
  });
const devCommands = dryRun('dev');
const frontendPort = devCommands.match(/npx vite --port (\d+)/)?.[1];
const backendPort = devCommands.match(/PORT="(\d+)"[^\n]*pnpm dev/)?.[1];

describe('dev port contract', () => {
  it('serves the same port the Makefile and the harness use', () => {
    expect(frontendPort, 'Makefile should pin a vite port').toBeTruthy();
    expect(viteConfig).toMatch(new RegExp(`port:\\s*${frontendPort}\\b`));
  });

  it('proxies to the port the backend actually binds', () => {
    expect(backendPort, 'Makefile should pass the backend PORT explicitly').toBeTruthy();
    expect(viteConfig).toMatch(
      new RegExp(`VITE_API_PROXY_TARGET \\|\\| 'http://localhost:${backendPort}'`),
    );
  });

  it('supplies the same explicit local database to migrations and the backend', () => {
    const migrationDatabase = devCommands.match(/DATABASE_URL="([^"]+)" npx drizzle-kit migrate/)?.[1];
    const backendDatabase = devCommands.match(/PORT="\d+" DATABASE_URL="([^"]+)" pnpm dev/)?.[1];
    expect(migrationDatabase, 'migrations require a selected database without an ignored .env').toBeTruthy();
    expect(backendDatabase).toBe(migrationDatabase);
    const database = new URL(migrationDatabase!);
    expect(database.hostname).toBe('localhost');
    expect(database.port).toBe('5441');
    expect(database.pathname).toBe('/silversea');
  });

  it('keeps explicit ports, database and proxy overrides', () => {
    const overrideDatabase = 'postgres://local-user:local-password@localhost:6541/local-audit';
    const overridden = dryRun('dev', { ...makeEnvironment, PORT: '4002',
      DEV_FRONTEND_PORT: '8175', DATABASE_URL: overrideDatabase });
    expect(overridden).toContain('PORT="4002"');
    expect(overridden).toContain(`DATABASE_URL="${overrideDatabase}" npx drizzle-kit migrate`);
    expect(overridden).toContain(`DATABASE_URL="${overrideDatabase}" pnpm dev`);
    expect(overridden).toContain('VITE_API_PROXY_TARGET="http://localhost:4002" npx vite --port 8175');
    const explicitProxy = dryRun('dev', { ...makeEnvironment, PORT: '4002',
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:5002' });
    expect(explicitProxy).toContain('VITE_API_PROXY_TARGET="http://127.0.0.1:5002"');
  });

  it('keeps the purge dry-run separate from destructive local setup', () => {
    const purgeCommands = dryRun('qapurge-dry');
    expect(purgeCommands).toContain('purge-qa-fixtures.js --dry-run');
    expect(purgeCommands).not.toMatch(/db-recreate|DROP DATABASE|drizzle-kit migrate|pnpm seed/);
    const setupCommands = dryRun('setup');
    expect(setupCommands).toContain('DROP DATABASE');
    expect(setupCommands).toContain('DATABASE_URL=');
    expect(setupCommands).toContain('npx drizzle-kit migrate');
    expect(setupCommands).toContain('pnpm seed');
    expect(setupCommands).not.toContain('ssh root@');
  });

  it('keeps strictPort so a busy port fails instead of silently moving', () => {
    // A silent move to the next free port is what desyncs the browser from the
    // proxy target and the harness's expectation at the same time.
    expect(viteConfig).toMatch(/strictPort:\s*true/);
  });

  it('does not default the proxy to the staging-import port', () => {
    // 3001 belongs to tools/staging-import/import.mjs. Proxying dev at it sends
    // every /api call nowhere, which is the original bug wearing a new number.
    expect(viteConfig).not.toMatch(/VITE_API_PROXY_TARGET \|\| 'http:\/\/localhost:3001'/);
  });

  it('agrees with the other dev server config used by the sweeps', () => {
    // vite.nowatch.config.mjs is a second frontend entrypoint; if it drifts, the
    // same footgun returns through a different door.
    const nowatch = readFileSync(resolve(process.cwd(), 'vite.nowatch.config.mjs'), 'utf8');
    expect(nowatch).toMatch(new RegExp(`VITE_API_PROXY_TARGET \\|\\| 'http://localhost:${backendPort}'`));
  });

  it('leaves no live QA script hardcoding a frontend port', () => {
    // 11 scripts hardcoded 7174 while everything else said 7175, which is how a
    // run ends up silently measuring a different server than the one a human
    // is looking at. env.mjs already says 7175 and is the documented source.
    const qaScripts = resolve(process.cwd(), '..', 'testplan', 'qa', 'scripts');
    const offenders: string[] = [];
    for (const name of readdirSync(qaScripts)) {
      if (!name.endsWith('.mjs') || name.startsWith('_')) continue;
      const text = readFileSync(resolve(qaScripts, name), 'utf8');
      const ports = [...text.matchAll(/localhost:(\d{4})/g)].map((m) => m[1]);
      for (const port of ports) {
        if (port !== frontendPort && port !== backendPort) offenders.push(`${name}:${port}`);
      }
    }
    expect(offenders, `scripts must use ${frontendPort} (frontend) / ${backendPort} (api): ${offenders.join(', ')}`).toEqual([]);
  });

  it('keeps the other active harness defaults on the same startup ports', () => {
    const harnessFiles = ['scripts/lib/http.mjs'];
    for (const directory of ['scripts']) {
      for (const name of readdirSync(resolve(process.cwd(), '..', directory))) {
        if (name.endsWith('.mjs') || name.endsWith('.py')) harnessFiles.push(`${directory}/${name}`);
      }
    }
    const offenders: string[] = [];
    for (const file of harnessFiles) {
      for (const line of repoFile(file).split('\n')) {
        // Read executable defaults, not historical comments or explicit test
        // URLs used to demonstrate supported non-default target overrides.
        if (!/^(?:export )?const |^API_URL = |^BASE_URL = /.test(line)) continue;
        for (const match of line.matchAll(/['"]http:\/\/localhost:(\d{4})/g)) {
          if (match[1] !== frontendPort && match[1] !== backendPort) offenders.push(`${file}:${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has a preflight that fails loudly before measuring anything', () => {
    // The silent failure was the expensive part: wrong port, every assertion
    // red, 401s that read as an auth bug. The audit must refuse to start.
    const audit = repoFile('testplan/qa/scripts/ui-filter-audit-20260927.mjs');
    expect(audit).toMatch(/PREFLIGHT FAILED/);
    expect(audit).toMatch(/ECONNREFUSED|cause\?\.code/);
    // And the shared env module offers the same guard for anything using it.
    expect(repoFile('testplan/qa/lib/env.mjs')).toMatch(/export async function preflight/);
  });
});
