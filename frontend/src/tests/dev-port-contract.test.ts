import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260928_192 — one dev port contract, asserted against the files that
 * actually decide it.
 *
 * The failure this pins is SILENT. `frontend/vite.config.ts` said 7174 + proxy
 * 3001 while the Makefile served 7175 + proxy 3002, every QA harness defaulted
 * to 7175, and `backend/.env` set PORT=3002. Running the short command gave you
 * a server whose `/api` calls went to a port nothing was listening on, and the
 * resulting 401/403 reads as an auth bug, so it gets debugged as one.
 *
 * These read the Makefile and `backend/.env` rather than hardcoding, so the day
 * a port legitimately moves, this test follows it instead of needing an edit.
 */
const repoFile = (p: string) => readFileSync(resolve(process.cwd(), '..', p), 'utf8');
const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
const makefile = repoFile('Makefile');
const backendEnv = repoFile('backend/.env');

describe('dev port contract', () => {
  it('serves the same port the Makefile and the harness use', () => {
    const makefilePort = makefile.match(/npx vite --port (\d+)/)?.[1];
    expect(makefilePort, 'Makefile should pin a vite port').toBeTruthy();
    expect(viteConfig).toMatch(new RegExp(`port:\\s*${makefilePort}\\b`));
  });

  it('proxies to the port the backend actually binds', () => {
    const backendPort = backendEnv.match(/^PORT=(\d+)/m)?.[1];
    expect(backendPort, 'backend/.env should set PORT').toBeTruthy();
    expect(viteConfig).toMatch(
      new RegExp(`VITE_API_PROXY_TARGET \\|\\| 'http://localhost:${backendPort}'`),
    );
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
    const backendPort = backendEnv.match(/^PORT=(\d+)/m)?.[1];
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
        // 7174 was the stale dev port; 7175 is the contract; 3002 is the API.
        if (port !== '7175' && port !== '3002') offenders.push(`${name}:${port}`);
      }
    }
    expect(offenders, `scripts must use 7175 (frontend) / 3002 (api): ${offenders.join(', ')}`).toEqual([]);
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
