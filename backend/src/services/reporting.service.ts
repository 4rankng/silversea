/**
 * Reporting Service — Facade
 *
 * Re-exports from domain sub-modules for backward compatibility.
 * All existing imports of reporting.service continue to work unchanged.
 */

export * from './dashboard-stats.service';
export * from './pnl.service';
export * from './profit-distribution.service';
export * from './receivables-report.service';
export { calendarMonthDateRange } from './reporting-shared';
