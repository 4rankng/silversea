import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Role, TripStatus, TxnType } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { globalErrorHandler } from '../middleware/errorHandler';
import salaryRoutes from '../routes/salary';
import { confirmSalary } from '../services/attendance.service';
import {
  approveSalaryPeriodExclusion,
  checkSalaryPeriodExclusion,
  createSalaryPeriodExclusion,
  getSalaryPeriodReadiness,
} from '../services/salary-period-close.service';
import { syncAttendanceAfterStatusChange } from '../services/trip-attendance-sync.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const periodYear = 6300 + (Number(suffix.split('-')[0]) % 500);
const GOVERNED_PERIOD = `${periodYear}-10`;
const GOVERNED_DAY = `${GOVERNED_PERIOD}-08`;
const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];
const createdTripIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdGovernanceActionIds: number[] = [];
const createdAdjustmentIds: number[] = [];
const closePeriods = new Set<string>();
let failpointCounter = 0;
let server: http.Server;
let baseUrl = '';

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `q15-salary-route-${role}-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return { id: user.id, role: user.role as Role };
}

async function mkDriver(tag: string) {
  const user = await mkUser(Role.DRIVER, tag);
  const [driver] = await db.insert(s.drivers).values({
    name: `Q15 salary route ${tag} ${suffix}`,
    userId: user.id,
    status: 'ACTIVE',
    baseSalary: '12000000',
  }).returning();
  createdDriverIds.push(driver.id);
  return driver;
}

async function insertClosedPeriod(
  period: string,
  version: number = 1,
  options: {
    payslipIssuedAt?: Date | null;
    officialPostedAt?: Date | null;
  } = {},
) {
  await db.insert(s.salaryPeriodCloses).values({
    period,
    status: 'CLOSED',
    version,
    closedBy: null,
    payslipIssuedAt: options.payslipIssuedAt ?? null,
    officialPostedAt: options.officialPostedAt ?? null,
  }).onConflictDoNothing({ target: s.salaryPeriodCloses.period });
  closePeriods.add(period);
}

async function mkCatalogs() {
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers).limit(1);
  const [route] = await db.select({ id: s.routes.id }).from(s.routes).limit(1);
  const [cargoType] = await db.select({ id: s.cargoTypes.id }).from(s.cargoTypes).limit(1);
  if (!customer || !route || !cargoType) {
    throw new Error('Missing seeded catalogs for q15 salary route test');
  }
  return { customer, route, cargoType };
}

async function mkTrip(input: {
  driverId: number;
  departureDate: string;
  completedAt: Date;
  salary: number;
  tag: string;
}) {
  const catalogs = await mkCatalogs();
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q15R-${input.tag}-${suffix}`.slice(0, 50),
    customerId: catalogs.customer.id,
    routeId: catalogs.route.id,
    cargoTypeId: catalogs.cargoType.id,
    driverId: input.driverId,
    status: TripStatus.COMPLETED,
    departureDate: input.departureDate,
    completedAt: input.completedAt,
    carrierType: 'OWN',
    driverSalary: String(input.salary),
    revenue: '0',
    totalRoadAllowance: '0',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function postDriverSalary(tripId: number, driverId: number, amount: number, note: string) {
  const [entry] = await db.insert(s.ledger).values({
    entityType: 'DRIVER',
    entityId: driverId,
    txnType: TxnType.DRIVER_SALARY,
    txnId: tripId,
    debit: '0',
    credit: String(amount),
    balance: String(amount),
    timestamp: new Date(),
    note,
  }).returning();
  createdLedgerIds.push(entry.id);
  return entry;
}

async function postSalary(
  path: string,
  body: Record<string, unknown>,
  actor: { id: number; role: Role },
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Test-User-Id': String(actor.id),
    'X-Test-Role': actor.role,
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function withIdempotencyInsertFailure(endpoint: string, idempotencyKey: string, run: () => Promise<void>) {
  failpointCounter += 1;
  const identSuffix = suffix.replace(/[^a-z0-9]+/gi, '_');
  const functionName = `q15_fail_idempotency_insert_${identSuffix}_${failpointCounter}`;
  const triggerName = `q15_fail_idempotency_insert_trg_${identSuffix}_${failpointCounter}`;
  await db.execute(sql.raw(`
    create function "${functionName}"() returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'q15 simulated idempotency insert failure';
    end;
    $$;
  `));
  await db.execute(sql.raw(`
    create trigger "${triggerName}"
    before insert on idempotency_keys
    for each row
    when (new.endpoint = '${endpoint}' and new.idempotency_key = '${idempotencyKey}')
    execute function "${functionName}"();
  `));
  try {
    await run();
  } finally {
    await db.execute(sql.raw(`drop trigger if exists "${triggerName}" on idempotency_keys;`));
    await db.execute(sql.raw(`drop function if exists "${functionName}"();`));
  }
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/salary', (req, _res, next) => {
    const userId = Number(req.header('X-Test-User-Id'));
    const role = String(req.header('X-Test-Role') ?? Role.ACCOUNTANT) as Role;
    req.user = {
      userId,
      username: `q15-salary-route-${userId}`,
      email: null,
      fullName: null,
      role,
    };
    next();
  });
  app.use('/api/salary', salaryRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/salary`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (createdUserIds.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
  }
  if (createdAdjustmentIds.length > 0) {
    await db.delete(s.salaryPeriodAdjustments).where(inArray(s.salaryPeriodAdjustments.id, createdAdjustmentIds));
  }
  for (const period of closePeriods) {
    await db.delete(s.periodLocks).where(and(
      eq(s.periodLocks.domain, 'SALARY'),
      eq(s.periodLocks.periodKey, period),
    ));
  }
  if (createdGovernanceActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdGovernanceActionIds));
  }
  if (closePeriods.size > 0) {
    await db.delete(s.salaryPeriodCloses).where(inArray(s.salaryPeriodCloses.period, [...closePeriods]));
  }
  if (createdLedgerIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
  }
  if (createdDriverIds.length > 0) {
    await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.driverId, createdDriverIds));
    await db.delete(s.salaryConfirmations).where(inArray(s.salaryConfirmations.driverId, createdDriverIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdDriverIds.length > 0) {
    await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await client.end();
});

describe('Q15 salary-period governed routes', () => {
  it('replays close and reopen governance decisions exactly once at the HTTP boundary', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'close-maker');
    const checker = await mkUser(Role.MANAGER, 'close-checker');
    const firstApprover = await mkUser(Role.ADMIN, 'close-approver-a');
    const secondApprover = await mkUser(Role.ADMIN, 'close-approver-b');
    const driver = await mkDriver('close-driver');
    const trip = await mkTrip({
      driverId: driver.id,
      departureDate: GOVERNED_DAY,
      completedAt: new Date(`${GOVERNED_DAY}T10:00:00.000Z`),
      salary: 1_600_000,
      tag: 'close',
    });
    await postDriverSalary(trip.id, driver.id, 1_600_000, 'q15 route governed salary');
    await confirmSalary(driver.id, periodYear, 10, accountant.id);
    await syncAttendanceAfterStatusChange(
      trip.id,
      TripStatus.COMPLETED,
      driver.id,
      GOVERNED_DAY,
      null,
      firstApprover.id,
    );

    const readiness = await getSalaryPeriodReadiness(GOVERNED_PERIOD);
    const unrelatedPendingDrivers = readiness.drivers.filter((item) =>
      item.driverId !== driver.id && item.status === 'PENDING' && item.exclusion == null);
    for (const pendingDriver of unrelatedPendingDrivers) {
      const requestedExclusion = await createSalaryPeriodExclusion({
        period: GOVERNED_PERIOD,
        driverId: pendingDriver.driverId,
        actorId: accountant.id,
        actorRole: accountant.role,
        reason: `Loại trừ tạm để cô lập ca kiểm thử Q15 route cho ${pendingDriver.driverName}`,
        handlingMode: 'SUPPLEMENTARY_PERIOD',
        targetPeriod: GOVERNED_PERIOD,
        note: 'q15 route isolation supplementary',
      });
      createdGovernanceActionIds.push(requestedExclusion.actionId);
      const checkedExclusion = await checkSalaryPeriodExclusion({
        actionId: requestedExclusion.actionId,
        actorId: checker.id,
        actorRole: checker.role,
        expectedVersion: requestedExclusion.version,
      });
      const approvedExclusion = await approveSalaryPeriodExclusion({
        actionId: checkedExclusion.actionId,
        actorId: firstApprover.id,
        actorRole: firstApprover.role,
        expectedVersion: checkedExclusion.version,
      });
      assert.equal(approvedExclusion.status, 'APPROVED');
    }

    const period = GOVERNED_PERIOD;

    const missingCloseKey = await postSalary(
      `/periods/${period}/close`,
      { note: 'Thiếu khóa chốt kỳ' },
      accountant,
    );
    assert.equal(missingCloseKey.status, 400);
    assert.match(String(missingCloseKey.body.error), /Idempotency-Key/i);

    const closeRequestKey = `q15-close-request-${period}`;
    const requested = await postSalary(
      `/periods/${period}/close`,
      { note: 'Q15 route close request' },
      accountant,
      closeRequestKey,
    );
    assert.equal(requested.status, 201);
    assert.equal(requested.body.status, 'PENDING_CHECK');
    createdGovernanceActionIds.push(Number(requested.body.id));

    const replayedRequest = await postSalary(
      `/periods/${period}/close`,
      { note: 'Q15 route close request' },
      accountant,
      closeRequestKey,
    );
    assert.equal(replayedRequest.status, 200);
    assert.equal(replayedRequest.body.replayed, true);

    const selfCheck = await postSalary(
      `/periods/${period}/close-actions/${requested.body.id}/check`,
      { expectedVersion: Number(requested.body.version) },
      accountant,
      `q15-close-self-check-${period}`,
    );
    assert.equal(selfCheck.status, 403);

    const closeCheckKey = `q15-close-check-${period}`;
    const checked = await postSalary(
      `/periods/${period}/close-actions/${requested.body.id}/check`,
      { expectedVersion: Number(requested.body.version) },
      checker,
      closeCheckKey,
    );
    assert.equal(checked.status, 200);
    assert.equal(checked.body.status, 'PENDING_APPROVAL');

    const replayedCheck = await postSalary(
      `/periods/${period}/close-actions/${requested.body.id}/check`,
      { expectedVersion: Number(requested.body.version) },
      checker,
      closeCheckKey,
    );
    assert.equal(replayedCheck.status, 200);
    assert.equal(replayedCheck.body.replayed, true);

    const selfApprove = await postSalary(
      `/periods/${period}/close-actions/${requested.body.id}/approve`,
      { expectedVersion: Number(checked.body.version) },
      checker,
      `q15-close-self-approve-${period}`,
    );
    assert.equal(selfApprove.status, 403);

    const closeApproveKey = `q15-close-approve-${period}`;
    const approved = await postSalary(
      `/periods/${period}/close-actions/${requested.body.id}/approve`,
      { expectedVersion: Number(checked.body.version) },
      firstApprover,
      closeApproveKey,
    );
    assert.equal(approved.status, 200);
    closePeriods.add(period);
    assert.equal(approved.body.status, 'APPROVED');
    const [closedRow] = await db.select({
      status: s.salaryPeriodCloses.status,
      version: s.salaryPeriodCloses.version,
    })
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, period))
      .limit(1);
    assert.equal(closedRow?.status, 'CLOSED');
    assert.ok(Number(closedRow?.version) >= 1);

    const replayedApprove = await postSalary(
      `/periods/${period}/close-actions/${requested.body.id}/approve`,
      { expectedVersion: Number(checked.body.version) },
      firstApprover,
      closeApproveKey,
    );
    assert.equal(replayedApprove.status, 200);
    assert.equal(replayedApprove.body.replayed, true);

    const reopenRequestKey = `q15-reopen-request-${period}`;
    const reopenRequested = await postSalary(
      `/periods/${period}/reopen`,
      { expectedVersion: Number(closedRow?.version), reason: 'Q15 route reopen request' },
      firstApprover,
      reopenRequestKey,
    );
    assert.equal(reopenRequested.status, 201);
    assert.equal(reopenRequested.body.status, 'PENDING_CHECK');
    createdGovernanceActionIds.push(Number(reopenRequested.body.id));

    const replayedReopenRequest = await postSalary(
      `/periods/${period}/reopen`,
      { expectedVersion: Number(closedRow?.version), reason: 'Q15 route reopen request' },
      firstApprover,
      reopenRequestKey,
    );
    assert.equal(replayedReopenRequest.status, 200);
    assert.equal(replayedReopenRequest.body.replayed, true);

    const reopenCheckKey = `q15-reopen-check-${period}`;
    const reopenChecked = await postSalary(
      `/periods/${period}/reopen-actions/${reopenRequested.body.id}/check`,
      { expectedVersion: Number(reopenRequested.body.version) },
      checker,
      reopenCheckKey,
    );
    assert.equal(reopenChecked.status, 200);
    assert.equal(reopenChecked.body.status, 'PENDING_APPROVAL');

    const replayedReopenCheck = await postSalary(
      `/periods/${period}/reopen-actions/${reopenRequested.body.id}/check`,
      { expectedVersion: Number(reopenRequested.body.version) },
      checker,
      reopenCheckKey,
    );
    assert.equal(replayedReopenCheck.status, 200);
    assert.equal(replayedReopenCheck.body.replayed, true);

    const reopenApproveKey = `q15-reopen-approve-${period}`;
    const reopened = await postSalary(
      `/periods/${period}/reopen-actions/${reopenRequested.body.id}/approve`,
      { expectedVersion: Number(reopenChecked.body.version) },
      secondApprover,
      reopenApproveKey,
    );
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.status, 'APPROVED');
    const [reopenedRow] = await db.select({ status: s.salaryPeriodCloses.status })
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, period))
      .limit(1);
    assert.equal(reopenedRow?.status, 'REOPENED');

    const replayedReopenApprove = await postSalary(
      `/periods/${period}/reopen-actions/${reopenRequested.body.id}/approve`,
      { expectedVersion: Number(reopenChecked.body.version) },
      secondApprover,
      reopenApproveKey,
    );
    assert.equal(replayedReopenApprove.status, 200);
    assert.equal(replayedReopenApprove.body.replayed, true);
  });

  it('replays salary-period adjustment request/check/approve and rejects stale source versions', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'adjust-maker');
    const checker = await mkUser(Role.MANAGER, 'adjust-checker');
    const approver = await mkUser(Role.ADMIN, 'adjust-approver');
    const driver = await mkDriver('adjust-driver');
    const sourcePeriod = `7402-${String((Date.now() % 12) + 1).padStart(2, '0')}`;
    const targetPeriod = `7403-${String(((Date.now() + 1) % 12) + 1).padStart(2, '0')}`;

    await insertClosedPeriod(sourcePeriod);

    const stale = await postSalary(
      `/periods/${sourcePeriod}/adjustments`,
      {
        driverId: driver.id,
        targetPeriod,
        amount: 350000,
        reason: 'Phiên bản cũ',
        expectedVersion: 1,
      },
      accountant,
      `q15-adjust-stale-${sourcePeriod}`,
    );
    assert.equal(stale.status, 201);
    createdGovernanceActionIds.push(Number(stale.body.actionId));

    await db.update(s.salaryPeriodCloses).set({
      version: sql`${s.salaryPeriodCloses.version} + 1`,
      updatedAt: new Date(Date.now() + 1_000),
    }).where(eq(s.salaryPeriodCloses.period, sourcePeriod));

    const staleConflict = await postSalary(
      `/periods/${sourcePeriod}/adjustments`,
      {
        driverId: driver.id,
        targetPeriod,
        amount: 360000,
        reason: 'Nguồn đã đổi',
        expectedVersion: 1,
      },
      accountant,
      `q15-adjust-stale-conflict-${sourcePeriod}`,
    );
    assert.equal(staleConflict.status, 409);

    const freshPeriod = `7404-${String((Date.now() % 12) + 1).padStart(2, '0')}`;
    await insertClosedPeriod(freshPeriod);

    const missingAdjustmentKey = await postSalary(
      `/periods/${freshPeriod}/adjustments`,
      {
        driverId: driver.id,
        targetPeriod,
        amount: 450000,
        reason: 'Thiếu khóa điều chỉnh',
        expectedVersion: 1,
      },
      accountant,
    );
    assert.equal(missingAdjustmentKey.status, 400);
    assert.match(String(missingAdjustmentKey.body.error), /Idempotency-Key/i);

    const requestKey = `q15-adjust-request-${freshPeriod}`;
    const requested = await postSalary(
      `/periods/${freshPeriod}/adjustments`,
      {
        driverId: driver.id,
        targetPeriod,
        amount: 450000,
        reason: 'Bổ sung công sau khi chốt',
        expectedVersion: 1,
      },
      accountant,
      requestKey,
    );
    assert.equal(requested.status, 201);
    assert.equal(requested.body.status, 'PENDING_CHECK');
    createdGovernanceActionIds.push(Number(requested.body.actionId));

    const wrongPeriod = `${Number(freshPeriod.slice(0, 4)) + 1}-${freshPeriod.slice(5)}`;
    const wrongPeriodCheck = await postSalary(
      `/periods/${wrongPeriod}/adjustments/${requested.body.actionId}/check`,
      { expectedVersion: Number(requested.body.version) },
      checker,
      `q15-adjust-wrong-period-check-${freshPeriod}`,
    );
    assert.equal(wrongPeriodCheck.status, 404);

    const replayedRequest = await postSalary(
      `/periods/${freshPeriod}/adjustments`,
      {
        driverId: driver.id,
        targetPeriod,
        amount: 450000,
        reason: 'Bổ sung công sau khi chốt',
        expectedVersion: 1,
      },
      accountant,
      requestKey,
    );
    assert.equal(replayedRequest.status, 200);
    assert.equal(replayedRequest.body.replayed, true);

    const checkKey = `q15-adjust-check-${freshPeriod}`;
    const checked = await postSalary(
      `/periods/${freshPeriod}/adjustments/${requested.body.actionId}/check`,
      { expectedVersion: Number(requested.body.version) },
      checker,
      checkKey,
    );
    assert.equal(checked.status, 200);
    assert.equal(checked.body.status, 'PENDING_APPROVAL');

    const replayedCheck = await postSalary(
      `/periods/${freshPeriod}/adjustments/${requested.body.actionId}/check`,
      { expectedVersion: Number(requested.body.version) },
      checker,
      checkKey,
    );
    assert.equal(replayedCheck.status, 200);
    assert.equal(replayedCheck.body.replayed, true);

    const selfApprove = await postSalary(
      `/periods/${freshPeriod}/adjustments/${requested.body.actionId}/approve`,
      { expectedVersion: Number(checked.body.version) },
      checker,
      `q15-adjust-self-approve-${freshPeriod}`,
    );
    assert.equal(selfApprove.status, 409);

    const wrongPeriodApprove = await postSalary(
      `/periods/${wrongPeriod}/adjustments/${requested.body.actionId}/approve`,
      { expectedVersion: Number(checked.body.version) },
      approver,
      `q15-adjust-wrong-period-approve-${freshPeriod}`,
    );
    assert.equal(wrongPeriodApprove.status, 404);
    const adjustmentsBeforeBoundApproval = await db.select()
      .from(s.salaryPeriodAdjustments)
      .where(eq(s.salaryPeriodAdjustments.governanceActionId, Number(requested.body.actionId)));
    assert.equal(adjustmentsBeforeBoundApproval.length, 0);

    const approveKey = `q15-adjust-approve-${freshPeriod}`;
    const approved = await postSalary(
      `/periods/${freshPeriod}/adjustments/${requested.body.actionId}/approve`,
      { expectedVersion: Number(checked.body.version) },
      approver,
      approveKey,
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'APPROVED');
    assert.ok(Number(approved.body.adjustmentId) > 0);
    createdAdjustmentIds.push(Number(approved.body.adjustmentId));

    const replayedApprove = await postSalary(
      `/periods/${freshPeriod}/adjustments/${requested.body.actionId}/approve`,
      { expectedVersion: Number(checked.body.version) },
      approver,
      approveKey,
    );
    assert.equal(replayedApprove.status, 200);
    assert.equal(replayedApprove.body.replayed, true);
  });

  it('salary-period adjustment request rolls back when idempotency persistence fails after the business callback', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'adjust-rollback');
    const driver = await mkDriver('adjust-rollback-driver');
    const sourcePeriod = `${periodYear + 20}-03`;
    const targetPeriod = `${periodYear + 20}-04`;
    const reason = `Q23 adjustment rollback ${suffix}`;
    const adjustmentKey = `q23-adjustment-fail-${sourcePeriod}`;

    await insertClosedPeriod(sourcePeriod, 1);

    await withIdempotencyInsertFailure('salary-periods.adjustments.request', adjustmentKey, async () => {
      const response = await postSalary(
        `/periods/${sourcePeriod}/adjustments`,
        {
          driverId: driver.id,
          targetPeriod,
          amount: 275000,
          reason,
          expectedVersion: 1,
        },
        accountant,
        adjustmentKey,
      );
      assert.equal(response.status, 500);
    });

    const storedActions = await db.select()
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'SALARY_PERIOD'),
        eq(s.governanceActions.actionKind, 'SALARY_PERIOD_ADJUSTMENT'),
        eq(s.governanceActions.reason, reason),
      ));
    assert.equal(storedActions.length, 0);

    const storedKeys = await db.select()
      .from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, adjustmentKey));
    assert.equal(storedKeys.length, 0);
  });

  it('governs salary issue and official posting with three actors, no pre-effect and exact replay', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'issue-maker');
    const checker = await mkUser(Role.MANAGER, 'issue-checker');
    const approver = await mkUser(Role.ADMIN, 'issue-approver');
    const driver = await mkUser(Role.DRIVER, 'issue-driver');
    const issuePeriod = `7501-${String((Date.now() % 12) + 1).padStart(2, '0')}`;
    await insertClosedPeriod(issuePeriod, 1);

    const missingIssueKey = await postSalary(
      `/periods/${issuePeriod}/issue`,
      { expectedVersion: 1, note: 'thiếu khóa issue' },
      accountant,
    );
    assert.equal(missingIssueKey.status, 400);
    assert.match(String(missingIssueKey.body.error), /Idempotency-Key/i);

    const missingIssueVersion = await postSalary(
      `/periods/${issuePeriod}/issue`,
      { note: 'thiếu phiên bản issue' },
      accountant,
      `q23-issue-missing-version-${issuePeriod}`,
    );
    assert.equal(missingIssueVersion.status, 400);
    assert.match(String(missingIssueVersion.body.error), /expectedVersion/i);

    const issueDenied = await postSalary(
      `/periods/${issuePeriod}/issue`,
      { expectedVersion: 1, note: 'driver issue' },
      driver,
      `q23-issue-rbac-${issuePeriod}`,
    );
    assert.equal(issueDenied.status, 403);

    const issueKey = `q23-issue-${issuePeriod}`;
    const issued = await postSalary(
      `/periods/${issuePeriod}/issue`,
      { expectedVersion: 1, note: 'Phát hành phiếu lương Q23' },
      accountant,
      issueKey,
    );
    assert.equal(issued.status, 201);
    assert.equal(issued.body.status, 'PENDING_CHECK');
    createdGovernanceActionIds.push(Number(issued.body.id));
    const [beforeIssueApproval] = await db.select().from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, issuePeriod)).limit(1);
    assert.equal(beforeIssueApproval.payslipIssuedAt, null);
    assert.equal(beforeIssueApproval.version, 1);

    const replayedIssue = await postSalary(
      `/periods/${issuePeriod}/issue`,
      { expectedVersion: 1, note: 'Phát hành phiếu lương Q23' },
      accountant,
      issueKey,
    );
    assert.equal(replayedIssue.status, 201);
    assert.equal(replayedIssue.body.replayed, true);
    assert.equal(replayedIssue.body.id, issued.body.id);

    const issueDrift = await postSalary(
      `/periods/${issuePeriod}/issue`,
      { expectedVersion: 1, note: 'Đổi ghi chú issue' },
      accountant,
      issueKey,
    );
    assert.equal(issueDrift.status, 409);
    assert.match(String(issueDrift.body.error), /Khóa giao dịch trùng/i);

    const selfIssueCheck = await postSalary(
      `/periods/${issuePeriod}/issue-actions/${issued.body.id}/check`,
      { expectedVersion: Number(issued.body.version) },
      accountant,
      `q15-issue-self-check-${issuePeriod}`,
    );
    assert.equal(selfIssueCheck.status, 403);

    const wrongIssuePeriod = `${Number(issuePeriod.slice(0, 4)) + 1}-${issuePeriod.slice(5)}`;
    const wrongIssueCheck = await postSalary(
      `/periods/${wrongIssuePeriod}/issue-actions/${issued.body.id}/check`,
      { expectedVersion: Number(issued.body.version) },
      checker,
      `q15-issue-wrong-period-${issuePeriod}`,
    );
    assert.equal(wrongIssueCheck.status, 404);

    const issueChecked = await postSalary(
      `/periods/${issuePeriod}/issue-actions/${issued.body.id}/check`,
      { expectedVersion: Number(issued.body.version) },
      checker,
      `q15-issue-check-${issuePeriod}`,
    );
    assert.equal(issueChecked.status, 200);
    assert.equal(issueChecked.body.status, 'PENDING_APPROVAL');
    assert.equal((await db.select().from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, issuePeriod)).limit(1))[0]?.payslipIssuedAt, null);

    const issueSelfApprove = await postSalary(
      `/periods/${issuePeriod}/issue-actions/${issued.body.id}/approve`,
      { expectedVersion: Number(issueChecked.body.version) },
      checker,
      `q15-issue-self-approve-${issuePeriod}`,
    );
    assert.equal(issueSelfApprove.status, 403);

    const issueApproveKey = `q15-issue-approve-${issuePeriod}`;
    const issueApproved = await postSalary(
      `/periods/${issuePeriod}/issue-actions/${issued.body.id}/approve`,
      { expectedVersion: Number(issueChecked.body.version) },
      approver,
      issueApproveKey,
    );
    assert.equal(issueApproved.status, 200);
    assert.equal(issueApproved.body.status, 'APPROVED');
    const [issuedClose] = await db.select().from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, issuePeriod)).limit(1);
    assert.ok(issuedClose.payslipIssuedAt);
    assert.ok(issuedClose.version > 1);
    const replayedIssueApproval = await postSalary(
      `/periods/${issuePeriod}/issue-actions/${issued.body.id}/approve`,
      { expectedVersion: Number(issueChecked.body.version) },
      approver,
      issueApproveKey,
    );
    assert.equal(replayedIssueApproval.status, 200);
    assert.equal(replayedIssueApproval.body.replayed, true);

    const staleIssue = await postSalary(
      `/periods/${issuePeriod}/issue`,
      { expectedVersion: 1, note: 'Issue bằng phiên bản cũ' },
      accountant,
      `q23-issue-stale-${issuePeriod}`,
    );
    assert.equal(staleIssue.status, 409);
    assert.match(String(staleIssue.body.error), /Vui lòng tải lại/i);

    const postBlockedPeriod = `7502-${String(((Date.now() + 1) % 12) + 1).padStart(2, '0')}`;
    await insertClosedPeriod(postBlockedPeriod, 1);
    const postBeforeIssue = await postSalary(
      `/periods/${postBlockedPeriod}/post`,
      { expectedVersion: 1, note: 'post trước khi issue' },
      accountant,
      `q23-post-preissue-${postBlockedPeriod}`,
    );
    assert.equal(postBeforeIssue.status, 409);
    assert.match(String(postBeforeIssue.body.error), /chưa phát hành phiếu lương/i);

    const missingPostKey = await postSalary(
      `/periods/${issuePeriod}/post`,
      { expectedVersion: issuedClose.version, note: 'thiếu khóa post' },
      accountant,
    );
    assert.equal(missingPostKey.status, 400);
    assert.match(String(missingPostKey.body.error), /Idempotency-Key/i);

    const postDenied = await postSalary(
      `/periods/${issuePeriod}/post`,
      { expectedVersion: issuedClose.version, note: 'driver post' },
      driver,
      `q23-post-rbac-${issuePeriod}`,
    );
    assert.equal(postDenied.status, 403);

    const postKey = `q23-post-${issuePeriod}`;
    const posted = await postSalary(
      `/periods/${issuePeriod}/post`,
      { expectedVersion: issuedClose.version, note: 'Hạch toán chính thức Q23' },
      accountant,
      postKey,
    );
    assert.equal(posted.status, 201);
    assert.equal(posted.body.status, 'PENDING_CHECK');
    createdGovernanceActionIds.push(Number(posted.body.id));
    const [beforePostApproval] = await db.select().from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, issuePeriod)).limit(1);
    assert.equal(beforePostApproval.officialPostedAt, null);
    assert.equal(beforePostApproval.version, issuedClose.version);

    const replayedPost = await postSalary(
      `/periods/${issuePeriod}/post`,
      { expectedVersion: issuedClose.version, note: 'Hạch toán chính thức Q23' },
      accountant,
      postKey,
    );
    assert.equal(replayedPost.status, 201);
    assert.equal(replayedPost.body.replayed, true);
    assert.equal(replayedPost.body.id, posted.body.id);

    const postDrift = await postSalary(
      `/periods/${issuePeriod}/post`,
      { expectedVersion: issuedClose.version, note: 'Đổi ghi chú post' },
      accountant,
      postKey,
    );
    assert.equal(postDrift.status, 409);
    assert.match(String(postDrift.body.error), /Khóa giao dịch trùng/i);

    const postChecked = await postSalary(
      `/periods/${issuePeriod}/post-actions/${posted.body.id}/check`,
      { expectedVersion: Number(posted.body.version) },
      checker,
      `q15-post-check-${issuePeriod}`,
    );
    assert.equal(postChecked.status, 200);
    assert.equal(postChecked.body.status, 'PENDING_APPROVAL');
    const wrongPostApprove = await postSalary(
      `/periods/${wrongIssuePeriod}/post-actions/${posted.body.id}/approve`,
      { expectedVersion: Number(postChecked.body.version) },
      approver,
      `q15-post-wrong-period-${issuePeriod}`,
    );
    assert.equal(wrongPostApprove.status, 404);
    assert.equal((await db.select().from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, issuePeriod)).limit(1))[0]?.officialPostedAt, null);

    const postApproveKey = `q15-post-approve-${issuePeriod}`;
    const postApproved = await postSalary(
      `/periods/${issuePeriod}/post-actions/${posted.body.id}/approve`,
      { expectedVersion: Number(postChecked.body.version) },
      approver,
      postApproveKey,
    );
    assert.equal(postApproved.status, 200);
    assert.equal(postApproved.body.status, 'APPROVED');
    const [postedClose] = await db.select().from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, issuePeriod)).limit(1);
    assert.ok(postedClose.officialPostedAt);
    assert.ok(postedClose.version > issuedClose.version);
    const replayedPostApproval = await postSalary(
      `/periods/${issuePeriod}/post-actions/${posted.body.id}/approve`,
      { expectedVersion: Number(postChecked.body.version) },
      approver,
      postApproveKey,
    );
    assert.equal(replayedPostApproval.status, 200);
    assert.equal(replayedPostApproval.body.replayed, true);

    const stalePost = await postSalary(
      `/periods/${issuePeriod}/post`,
      { expectedVersion: issuedClose.version, note: 'Post bằng phiên bản cũ' },
      accountant,
      `q23-post-stale-${issuePeriod}`,
    );
    assert.equal(stalePost.status, 409);
    assert.match(String(stalePost.body.error), /Vui lòng tải lại/i);
  });

  it('salary confirmation approve rolls back when idempotency persistence fails after the business callback', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'confirm-maker');
    const checker = await mkUser(Role.MANAGER, 'confirm-checker');
    const approver = await mkUser(Role.ADMIN, 'confirm-approver');
    const driver = await mkDriver('confirm-driver');
    const year = periodYear + 30;
    const month = 9;

    const requestKey = `q23-confirm-request-${driver.id}-${year}-${month}`;
    const requested = await postSalary(
      `/${driver.id}/${year}/${month}/confirm`,
      {},
      accountant,
      requestKey,
    );
    assert.equal(requested.status, 200);
    assert.equal(requested.body.status, 'PENDING_CHECK');
    createdGovernanceActionIds.push(Number(requested.body.id));

    const checkKey = `q23-confirm-check-${driver.id}-${year}-${month}`;
    const checked = await postSalary(
      `/${driver.id}/${year}/${month}/confirm-actions/${requested.body.id}/check`,
      { expectedVersion: Number(requested.body.version) },
      checker,
      checkKey,
    );
    assert.equal(checked.status, 200);
    assert.equal(checked.body.status, 'PENDING_APPROVAL');

    const approveKey = `q23-confirm-approve-fail-${driver.id}-${year}-${month}`;
    await withIdempotencyInsertFailure('governance.approve', approveKey, async () => {
      const response = await postSalary(
        `/${driver.id}/${year}/${month}/confirm-actions/${requested.body.id}/approve`,
        { expectedVersion: Number(checked.body.version) },
        approver,
        approveKey,
      );
      assert.equal(response.status, 500);
    });

    const [storedAction] = await db.select({
      status: s.governanceActions.status,
      version: s.governanceActions.version,
      approvedAt: s.governanceActions.approvedAt,
      approverId: s.governanceActions.approverId,
    })
      .from(s.governanceActions)
      .where(eq(s.governanceActions.id, Number(requested.body.id)))
      .limit(1);
    assert.equal(storedAction?.status, 'PENDING_APPROVAL');
    assert.equal(storedAction?.version, Number(checked.body.version));
    assert.equal(storedAction?.approvedAt, null);
    assert.equal(storedAction?.approverId, null);

    const storedConfirmations = await db.select({
      status: s.salaryConfirmations.status,
      confirmedBy: s.salaryConfirmations.confirmedBy,
      confirmedAt: s.salaryConfirmations.confirmedAt,
    })
      .from(s.salaryConfirmations)
      .where(and(
        eq(s.salaryConfirmations.driverId, driver.id),
        eq(s.salaryConfirmations.year, year),
        eq(s.salaryConfirmations.month, month),
      ));
    assert.equal(storedConfirmations.length, 0);

    const storedKeys = await db.select()
      .from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, approveKey));
    assert.equal(storedKeys.length, 0);
  });

  it('salary issue rolls back when idempotency persistence fails after the business callback', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'issue-rollback');
    const period = `${periodYear}-11`;
    await insertClosedPeriod(period, 1);
    const issueKey = `q23-salary-fail-${period}`;

    await withIdempotencyInsertFailure('salary-periods.issue', issueKey, async () => {
      const response = await postSalary(
        `/periods/${period}/issue`,
        { expectedVersion: 1 },
        accountant,
        issueKey,
      );
      assert.equal(response.status, 500);
    });

    const [closeRow] = await db.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, period))
      .limit(1);
    assert.ok(closeRow);
    assert.equal(closeRow?.payslipIssuedAt, null);
    assert.equal(closeRow?.version, 1);

    const storedKeys = await db.select()
      .from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, issueKey));
    assert.equal(storedKeys.length, 0);
  });
});
