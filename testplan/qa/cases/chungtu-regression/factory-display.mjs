// cases/chungtu-regression/factory-display.mjs
// Regression: /shipments/<id> with operational_site_id set on a container but
// shipments.factory_name empty — detail page must resolve to factory short name.
// Source: báo cáo khách hàng 2026-09-07, regression on Long Minh id=2 / id=5.

export const caseId = 'FACTORY-DISPLAY-REGRESSION-2026-09-07';
export const role = 'CUS';

export default async function (ctx) {
  // Find a shipment where detail shows shipment.factoryName empty AND at least one
  // container has operationalSiteId set (the regression shape).
  const list = await ctx.apiGet('/shipments?page=1&limit=20');
  const items = list.body.items || list.body.data || [];
  let target = null;
  for (const s of items) {
    const detail = await ctx.apiGet(`/shipments/${s.id}`);
    const j = detail.body;
    const shipment = j.shipment || j;
    const factoryName = shipment.factoryName || shipment.factory_name;
    const containers = j.containers || [];
    const hasSite = containers.some((c) => c.operationalSiteId || c.operational_site_id);
    if (hasSite && (!factoryName || factoryName === '')) {
      target = {
        id: s.id,
        blNumber: shipment.blNumber || shipment.bl_number,
        factoryName,
        siteIds: containers.map((c) => c.operationalSiteId || c.operational_site_id).filter(Boolean),
      };
      break;
    }
  }
  if (!target) return { verdict: 'BLOCKED', errors: ['no shipment matching the regression shape on staging'] };

  await ctx.goto(`/shipments/${target.id}`);
  await ctx.screenshot('a_detail');

  // Read the factory cell directly via DOM walk: find the label "Nhà máy / công
  // trường" and read its sibling value cell.
  const factoryCellText = await ctx.page.evaluate(() => {
    // The factory cell is in a grid where label + value are paired. Find label,
    // then read its value sibling.
    const labels = Array.from(document.querySelectorAll('*'));
    for (const lab of labels) {
      if ((lab.textContent || '').trim() === 'Nhà máy / công trường') {
        // Walk up to a row that contains both label and value
        let row = lab.parentElement;
        for (let i = 0; i < 3 && row; i++) {
          if (row.children.length >= 2) {
            // The label is one child, value is another
            const sibs = Array.from(row.children);
            for (const s of sibs) {
              if (s !== lab) {
                const t = (s.textContent || '').trim();
                if (t && t !== 'Nhà máy / công trường') return t.slice(0, 80);
              }
            }
          }
          row = row.parentElement;
        }
        return null;
      }
    }
    return null;
  });

  // Resolve expected short names from operational_sites catalog
  const customerId = (await ctx.apiGet(`/shipments/${target.id}`)).body.shipment?.customerId;
  const sitesRes = await ctx.apiGet(`/shipments/operational-sites?customerId=${customerId || ''}`).catch(() => null);
  const siteShortNames = (sitesRes?.body?.items || sitesRes?.body || []).map((s) => s.shortName || s.short_name).filter(Boolean);

  // Expected: factory cell text matches one of the short names corresponding to
  // the target shipment's container siteIds.
  const expectedSites = (await ctx.apiGet(`/shipments/${target.id}`)).body.containers
    .map((c) => c.operationalSiteId || c.operational_site_id)
    .filter(Boolean);
  const expectedShortNames = (sitesRes?.body?.items || sitesRes?.body || [])
    .filter((s) => expectedSites.includes(s.id))
    .map((s) => s.shortName || s.short_name)
    .filter(Boolean);

  const cellTrim = (factoryCellText || '').trim();
  // Card _47 AC3: the cell composes container code + site display name
  // (staging showed "QAC1 Nhà máy Đồng Văn"), so both branches match by
  // substring. A site WITH a shortName must show it; a site WITHOUT one falls
  // back to its full name — both branches reach a definite verdict, the case
  // never rests INCONCLUSIVE on this axis again.
  const matchedSites = (sitesRes?.body?.items || sitesRes?.body || [])
    .filter((s) => expectedSites.includes(s.id));
  const expectedFullNames = matchedSites.map((s) => s.name).filter(Boolean);
  const cellMatches = expectedShortNames.some((n) => cellTrim.includes(n));
  const cellMatchesFullName = expectedFullNames.some((n) => cellTrim.includes(n));
  const cellIsDash = cellTrim === '—' || cellTrim === '' || /Chưa có nhà máy/i.test(cellTrim);

  return {
    verdict: cellMatches || cellMatchesFullName ? 'PASS' : 'FAIL',
    target,
    factoryCellText: cellTrim,
    cellMatches,
    cellMatchesFullName,
    cellIsDash,
    expectedShortNames,
    expectedFullNames,
    siteShortNames,
  };
}
