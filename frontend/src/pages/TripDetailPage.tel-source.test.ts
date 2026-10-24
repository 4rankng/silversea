import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DRI-01 (card 211026130743) — every admin/forwarder surface that renders a
 * warehouse/factory phone dials through the ONE shared TelLink pattern
 * (components/TelLink): the raw `href={`tel:${...}`}` template shipped dead
 * URIs for space/dot-formatted numbers. Source pin so the pattern cannot
 * regress back to hand-rolled anchors on these surfaces.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('DRI-01 — house TelLink on admin trip-detail + site surfaces', () => {
  it('admin trip detail renders the instructions SĐT through TelLink (no raw tel: template)', () => {
    const source = read('src/pages/TripDetailPage.tsx');
    expect(source).toContain("import { TelLink } from '../components/TelLink'");
    expect(source).toContain('<TelLink phone={trip.instructions.contactPhone}');
    expect(source).not.toMatch(/href=\{`tel:\$\{/);
  });

  it('forwarder trip detail renders the instructions SĐT through TelLink', () => {
    const source = read('src/pages/ForwarderTripDetailPage.tsx');
    expect(source).toContain("import { TelLink } from '../components/TelLink'");
    expect(source).toContain('<TelLink phone={trip.instructions.contactPhone}');
    expect(source).not.toMatch(/href=\{`tel:\$\{/);
  });

  it('the site details dialog dials Số điện thoại through TelLink', () => {
    const source = read('src/components/shipment/OperationalSiteDetailsDialog.tsx');
    expect(source).toContain("import { TelLink } from '../TelLink'");
    expect(source).toContain('label="Số điện thoại" value={site.contactPhone} tel');
  });

  it('the master-data factory list renders its number dialable with an explicit call affordance (SIL-467 one-line run keeps DRI-01)', () => {
    const source = read('src/pages/config/FactoriesConfigPage.tsx');
    // The number itself dials (telHref) and a labelled icon anchor is the
    // explicit affordance beside it — the one-baseline replacement for the
    // per-contact TelLink + Gọi button run.
    expect(source).toContain('href={telHref(details.phone)}');
    expect(source).toContain('aria-label={`Gọi ${details.phone}`}');
  });

  it('the basic-facts card dials SĐT kho/nhà máy through TelLink when the site has one', () => {
    const source = read('src/features/trip-detail/components/BasicInfoCard.tsx');
    expect(source).toContain("import { TelLink } from '../../../components/TelLink'");
    expect(source).toContain("label: 'SĐT kho/nhà máy'");
    expect(source).toContain('<TelLink phone={row.value} className="val val-tel" />');
  });
});
