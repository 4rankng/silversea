import { db } from '../db';
import * as s from '../db/schema';
import { Role, FINANCIAL_ROLES, type ApprovalItemType } from '@tingting/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';

export { type ApprovalItemType };

export interface ApprovalQueueItem {
  id: string;
  type: ApprovalItemType;
  title: string;
  subtitle: string;
  amount: number;
  requestedAt: string;
  href: string;
  severity: 'normal' | 'urgent';
}

export interface ApprovalQueueResponse {
  total: number;
  byType: Record<ApprovalItemType, number>;
  items: ApprovalQueueItem[];
}

const URGENT_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export async function getApprovalQueue(userId: number, role: string): Promise<ApprovalQueueResponse> {
  const isAdmin = role === Role.ADMIN;
  const isManager = role === Role.MANAGER;
  const isAccountant = role === Role.ACCOUNTANT;
  const isFinancial = (FINANCIAL_ROLES as readonly string[]).includes(role);

  if (!isFinancial) {
    return { total: 0, byType: emptyByType(), items: [] };
  }

  // Build query promises conditionally, then fire them all in parallel
  const queryPromises: Promise<ApprovalQueueItem[]>[] = [];

  // Debt offsets & advances — only ADMIN and MANAGER can approve
  if (isAdmin || isManager) {
    queryPromises.push(
      db
        .select({
          id: s.debtOffsets.id,
          amount: s.debtOffsets.amount,
          createdAt: s.debtOffsets.createdAt,
          customerName: s.customers.name,
          supplierName: s.suppliers.name,
          requesterName: s.users.fullName,
        })
        .from(s.debtOffsets)
        .innerJoin(s.customers, eq(s.customers.id, s.debtOffsets.customerId))
        .innerJoin(s.suppliers, eq(s.suppliers.id, s.debtOffsets.supplierId))
        .leftJoin(s.users, eq(s.users.id, s.debtOffsets.createdBy))
        .where(eq(s.debtOffsets.approvalStatus, 'PENDING'))
        .orderBy(asc(s.debtOffsets.createdAt))
        .limit(50)
        .then(rows => rows.map(r => {
          const amt = Number(r.amount);
          return {
            id: `debtOffsets:${r.id}`,
            type: 'debtOffsets' as const,
            title: `Bù trừ ${formatVND(amt, true)} giữa ${r.customerName} & ${r.supplierName}`,
            subtitle: `${r.requesterName ?? 'Không rõ'} · ${timeAgo(r.createdAt)}`,
            amount: amt,
            requestedAt: r.createdAt.toISOString(),
            href: `/debt#offsets`,
            severity: isUrgent(r.createdAt) ? 'urgent' as const : 'normal' as const,
          };
        })),
    );

    queryPromises.push(
      db
        .select({
          id: s.advanceRequests.id,
          amount: s.advanceRequests.amount,
          reason: s.advanceRequests.reason,
          createdAt: s.advanceRequests.createdAt,
          requesterName: s.users.fullName,
        })
        .from(s.advanceRequests)
        .innerJoin(s.users, eq(s.users.id, s.advanceRequests.requesterId))
        .where(
          and(
            eq(s.advanceRequests.status, 'PENDING'),
            ne(s.advanceRequests.requesterId, userId),
          ),
        )
        .orderBy(asc(s.advanceRequests.createdAt))
        .limit(50)
        .then(rows => rows.map(r => {
          const amt = Number(r.amount);
          return {
            id: `advances:${r.id}`,
            type: 'advances' as const,
            title: `Tạm ứng ${formatVND(amt, true)} — ${r.reason}`,
            subtitle: `${r.requesterName} · ${timeAgo(r.createdAt)}`,
            amount: amt,
            requestedAt: r.createdAt.toISOString(),
            href: `/advances?focus=${r.id}`,
            severity: isUrgent(r.createdAt) ? 'urgent' as const : 'normal' as const,
          };
        })),
    );
  }

  if (isAdmin || isAccountant) {
    queryPromises.push(
      db
        .select({
          id: s.advanceSettlements.id,
          totalExpenseAmount: s.advanceSettlements.totalExpenseAmount,
          refundAmount: s.advanceSettlements.refundAmount,
          createdAt: s.advanceSettlements.createdAt,
          requesterName: s.users.fullName,
        })
        .from(s.advanceSettlements)
        .innerJoin(s.users, eq(s.users.id, s.advanceSettlements.forwarderId))
        .where(
          and(
            inArray(s.advanceSettlements.status, ['PENDING', 'CHECKED_BY_ACCOUNTANT']),
            ne(s.advanceSettlements.forwarderId, userId),
          ),
        )
        .orderBy(asc(s.advanceSettlements.createdAt))
        .limit(50)
        .then(rows => rows.map(r => {
          const amt = Number(r.totalExpenseAmount) + Number(r.refundAmount);
          return {
            id: `advanceSettlementsApprove:${r.id}`,
            type: 'advanceSettlementsApprove' as const,
            title: `Duyệt phiếu thanh toán ${formatVND(amt, true)} — ${r.requesterName}`,
            subtitle: `Chờ kế toán duyệt · ${timeAgo(r.createdAt)}`,
            amount: amt,
            requestedAt: r.createdAt.toISOString(),
            href: `/settlements/${r.id}`,
            severity: isUrgent(r.createdAt) ? 'urgent' as const : 'normal' as const,
          };
        })),
    );
  }

  const batches = await Promise.all(queryPromises);
  const items = batches.flat();

  items.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

  const byType = emptyByType();
  for (const it of items) byType[it.type]++;

  return { total: items.length, byType, items };
}

function emptyByType(): Record<ApprovalItemType, number> {
  return {
    ancillaryFees: 0,
    debtOffsets: 0,
    advances: 0,
    advanceSettlementsCheck: 0,
    advanceSettlementsApprove: 0,
  };
}

import { formatVND } from '../lib/format';

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  const months = Math.floor(days / 30);
  return `${months} tháng trước`;
}

function isUrgent(d: Date): boolean {
  return Date.now() - d.getTime() > URGENT_THRESHOLD_MS;
}
