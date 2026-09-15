import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');

describe('shared operational-site dialog stylesheet ownership', () => {
  it('loads factory and child route layouts without depending on the shipment page chunk', () => {
    const factory = read('components/shipment/OperationalSiteCreateDialog.tsx');
    const route = read('features/shipments/create/RouteCreateDialog.tsx');
    expect(factory).toMatch(/^import ['"]\.\/OperationalSiteCreateDialog\.css['"]/m);
    expect(route).toMatch(/^import ['"]\.\/RouteCreateDialog\.css['"]/m);
    expect(factory).not.toMatch(/className="csc-/);
    expect(route).not.toMatch(/className="csc-route-dialog/);
    expect(read('components/shipment/OperationalSiteCreateDialog.css')).toMatch(/\.operational-site-create__add-route\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;/);
    expect(read('features/shipments/create/RouteCreateDialog.css')).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.route-create-dialog__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });
});
