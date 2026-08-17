import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import { operationalName } from '../db/master-data-name';
import { listOperationalSitesForIntake } from '../services/shipment-intake.service';
import { companyInfoFromSettings } from '../services/company-info.service';
import { Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdSiteIds: number[] = [];

test('company profile exposes a short operational name without changing its legal name', () => {
  const updatedAt = new Date();
  const company = companyInfoFromSettings([
    { key: 'company.name', value: 'Công ty TNHH Vận tải Biển Bạc Việt Nam', updatedAt },
    { key: 'company.short_name', value: 'Biển Bạc', updatedAt },
  ]);

  assert.equal(company.name, 'Công ty TNHH Vận tải Biển Bạc Việt Nam');
  assert.equal(company.shortName, 'Biển Bạc');

  const legacyCompany = companyInfoFromSettings([
    { key: 'company.name', value: 'Công ty TNHH Dữ liệu Cũ', updatedAt },
  ]);
  assert.equal(legacyCompany.shortName, legacyCompany.name);
});

after(async () => {
  if (createdSiteIds.length > 0) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
  if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  await client.end();
});

test('operational names prefer short names while legal names remain unchanged', async () => {
  const fullCustomerName = `Công ty Cổ phần Sản xuất và Thương mại Biển Bạc ${suffix}`;
  const [customer] = await db.insert(s.customers).values({
    name: fullCustomerName,
    shortName: `Biển Bạc ${suffix}`,
  }).returning();
  createdCustomerIds.push(customer!.id);

  const fullRouteName = `Cảng Hải Phòng - Nhà máy Biển Bạc tại Bắc Ninh ${suffix}`;
  const [route] = await db.insert(s.routes).values({
    name: fullRouteName,
    shortName: `HP - Biển Bạc ${suffix}`,
  }).returning();
  createdRouteIds.push(route!.id);

  const [projected] = await db.select({
    customerDisplayName: operationalName(s.customers.shortName, s.customers.name),
    customerFullName: s.customers.name,
  }).from(s.customers).where(eq(s.customers.id, customer!.id));
  assert.equal(projected!.customerDisplayName, `Biển Bạc ${suffix}`);
  assert.equal(projected!.customerFullName, fullCustomerName);

  const [routeProjected] = await db.select({
    routeDisplayName: operationalName(s.routes.shortName, s.routes.name),
    routeFullName: s.routes.name,
  }).from(s.routes).where(eq(s.routes.id, route!.id));
  assert.equal(routeProjected!.routeDisplayName, `HP - Biển Bạc ${suffix}`);
  assert.equal(routeProjected!.routeFullName, fullRouteName);
});

test('operational-site API returns both names and preserves full-name authority', async () => {
  const [customer] = await db.insert(s.customers).values({
    name: `Công ty Nhà máy ${suffix}`,
    shortName: `NM ${suffix}`,
  }).returning();
  createdCustomerIds.push(customer!.id);

  const [site] = await db.insert(s.operationalSites).values({
    customerId: customer!.id,
    code: `SITE-${suffix}`.slice(0, 80),
    name: `Nhà máy Công ty Cổ phần Biển Bạc tại Bắc Ninh ${suffix}`,
    shortName: `Biển Bạc BN ${suffix}`,
    siteType: 'FACTORY',
    address: 'Bắc Ninh',
  }).returning();
  createdSiteIds.push(site!.id);

  const items = await listOperationalSitesForIntake(customer!.id, {
    userId: 1,
    username: 'admin',
    email: null,
    fullName: 'Quản trị viên',
    role: Role.ADMIN,
  });
  const item = items.find((candidate) => candidate.id === site!.id);
  assert.equal(item?.name, site!.name);
  assert.equal(item?.shortName, site!.shortName);
});
