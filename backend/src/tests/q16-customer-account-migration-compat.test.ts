import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { CustomerAccountType, Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { updateUser } from '../services/user.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const customerIds: number[] = [];
const passwordHash = await bcrypt.hash('admin123', 10);

async function createCustomer(name: string) {
  const [customer] = await db.insert(s.customers)
    .values({ name: `${name} ${suffix}` })
    .returning({ id: s.customers.id });
  customerIds.push(customer.id);
  return customer.id;
}

async function createLegacyCustomerUser(options: {
  username: string;
  customerIds: number[];
  customerAccountType?: CustomerAccountType;
}) {
  const [user] = await db.insert(s.users).values({
    username: options.username,
    passwordHash,
    role: Role.CUSTOMER,
    customerId: options.customerIds[0] ?? null,
    customerAccountType: options.customerAccountType ?? CustomerAccountType.SINGLE_ENTITY,
  }).returning({ id: s.users.id });
  userIds.push(user.id);
  if (options.customerIds.length > 0) {
    await db.insert(s.userCustomerLinks).values(
      options.customerIds.map((customerId) => ({
        userId: user.id,
        customerId,
      })),
    );
  }
  return user.id;
}

async function loadPersistedCustomerAccountType(userId: number) {
  const [row] = await db.select({
    customerAccountType: s.users.customerAccountType,
    customerId: s.users.customerId,
  }).from(s.users).where(eq(s.users.id, userId)).limit(1);
  assert.ok(row, `expected persisted user ${userId}`);
  return row;
}

after(async () => {
  if (userIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, userIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  await disconnectRedis();
  await client.end();
});

test('squashed baseline persists the customer-account-type contract while historical rows still need runtime repair', async () => {
  const primaryCustomerId = await createCustomer('Q16 migration single');
  const groupCustomerAId = await createCustomer('Q16 migration multi A');
  const groupCustomerBId = await createCustomer('Q16 migration multi B');

  const singleEntityUserId = await createLegacyCustomerUser({
    username: `q16-migration-single-${suffix}`,
    customerIds: [primaryCustomerId],
  });
  const multiEntityUserId = await createLegacyCustomerUser({
    username: `q16-migration-multi-${suffix}`,
    customerIds: [groupCustomerAId, groupCustomerBId],
  });

  const enumRows = await client<{ enumlabel: string }[]>`
    select e.enumlabel
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'customer_account_type'
    order by e.enumsortorder
  `;
  assert.deepEqual(
    enumRows.map((row) => row.enumlabel),
    [],
    'customer account types are application-owned rather than a PostgreSQL enum',
  );
  const [columnRow] = await client<{
    column_default: string | null;
    is_nullable: 'YES' | 'NO';
    udt_name: string;
  }[]>`
    select column_default, is_nullable, udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'customer_account_type'
  `;
  assert.ok(columnRow, 'expected users.customer_account_type to exist in the current schema');
  assert.equal(columnRow.is_nullable, 'NO');
  assert.equal(columnRow.udt_name, 'text');
  assert.match(
    columnRow.column_default ?? '',
    /'SINGLE_ENTITY'::text/i,
  );

  const singleEntityUser = await loadPersistedCustomerAccountType(singleEntityUserId);
  const multiEntityUser = await loadPersistedCustomerAccountType(multiEntityUserId);

  assert.equal(singleEntityUser.customerAccountType, CustomerAccountType.SINGLE_ENTITY);
  assert.equal(singleEntityUser.customerId, primaryCustomerId);
  assert.equal(multiEntityUser.customerAccountType, CustomerAccountType.SINGLE_ENTITY);
  assert.equal(multiEntityUser.customerId, groupCustomerAId);
  const multiLinkRows = await db.select({ customerId: s.userCustomerLinks.customerId })
    .from(s.userCustomerLinks)
    .where(eq(s.userCustomerLinks.userId, multiEntityUserId));
  assert.equal(multiLinkRows.length, 2, 'historical multi-link rows must still be readable before runtime repair');
});

test('updateUser keeps a historical multi-link customer account editable and repairs its persisted type', async () => {
  const customerAId = await createCustomer('Q16 service multi A');
  const customerBId = await createCustomer('Q16 service multi B');
  const legacyUserId = await createLegacyCustomerUser({
    username: `q16-service-multi-${suffix}`,
    customerIds: [customerAId, customerBId],
  });

  const updated = await updateUser(legacyUserId, {
    fullName: 'Khach hang tap doan cu',
    assignmentAdminOnly: true,
  });

  assert.equal(updated.customerAccountType, CustomerAccountType.CORPORATE_GROUP);
  assert.deepEqual(updated.customerIds, [customerAId, customerBId].sort((a, b) => a - b));
  assert.equal(updated.customerId, customerAId);

  const persisted = await loadPersistedCustomerAccountType(legacyUserId);
  assert.equal(persisted.customerAccountType, CustomerAccountType.CORPORATE_GROUP);
  assert.equal(persisted.customerId, customerAId);
});

test('updateUser keeps a historical one-link customer account as SINGLE_ENTITY', async () => {
  const customerId = await createCustomer('Q16 service single');
  const legacyUserId = await createLegacyCustomerUser({
    username: `q16-service-single-${suffix}`,
    customerIds: [customerId],
  });

  const updated = await updateUser(legacyUserId, {
    fullName: 'Khach hang mot phap nhan',
    assignmentAdminOnly: true,
  });

  assert.equal(updated.customerAccountType, CustomerAccountType.SINGLE_ENTITY);
  assert.deepEqual(updated.customerIds, [customerId]);
  assert.equal(updated.customerId, customerId);

  const persisted = await loadPersistedCustomerAccountType(legacyUserId);
  assert.equal(persisted.customerAccountType, CustomerAccountType.SINGLE_ENTITY);
  assert.equal(persisted.customerId, customerId);
});
