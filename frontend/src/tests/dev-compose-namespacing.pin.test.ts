import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dev-compose namespacing pin (card 20260920_9): the 932f490f merge silently
 * reverted e481d070's ss-prod-* namespace to ss-main-* on the sibling's ports,
 * which would make `make dev` from this checkout seize the silversea-main
 * checkout's containers and data volume. tsc/vitest never parse compose, and
 * no gate diffed infra naming across merges — so this file pins the namespace
 * itself. Container names must be ss-prod-* on this checkout's ports; the
 * ss-main-* namespace belongs to the sibling checkout. Volume key ss-prod-pgdata
 * (never used before 2026-09-20): the old silversea-pgdata key resurrects a
 * stale pre-namespacing dev DB (observed live: 314 trips from that era).
 */
const COMPOSE_PATH = join(__dirname, '../../../docker-compose.dev.yml');
const compose = readFileSync(COMPOSE_PATH, 'utf8');

const containerNames = [...compose.matchAll(/^\s*container_name:\s*(\S+)/gm)].map((m) => m[1]);
const portMaps = [...compose.matchAll(/^\s*-\s*"(\d+):(\d+)"/gm)].map((m) => `${m[1]}:${m[2]}`);

describe('dev compose namespacing pin', () => {
  it('names every container ss-prod-* and never ss-main-*', () => {
    expect(containerNames.length).toBe(3);
    for (const name of containerNames) {
      expect(name.startsWith('ss-prod-')).toBe(true);
      expect(name.includes('ss-main')).toBe(false);
    }
    expect(containerNames).toEqual(['ss-prod-db', 'ss-prod-redis', 'ss-prod-adminer']);
  });

  it('binds exactly this checkout ports 5441/6391/8083', () => {
    expect(portMaps).toEqual(['5441:5432', '6391:6379', '8083:8080']);
  });

  it('keeps the never-resurrect volume key ss-prod-pgdata', () => {
    expect(compose).toMatch(/^\s*-\s*ss-prod-pgdata:/m);
    expect(compose).toMatch(/^ {2}ss-prod-pgdata:$/m);
    expect(compose).not.toMatch(/^\s*-\s*silversea-pgdata:/m);
    expect(compose).not.toMatch(/^ {2}silversea-pgdata:$/m);
  });
});
