// Salary-period close barrel: the close/reopen lifecycle + governance flows,
// payslips/official posting, and the exclusion workflow live in leaf modules
// (salary-period-close-lifecycle / -payslips / -exclusion, shared machinery in
// salary-period-close-shared). This file is the compatibility barrel — named
// re-exports only, importers unchanged.
export type {
  SalaryPeriodDriverIssue,
  SalaryPeriodApprovedExclusion,
  SalaryPeriodDriverReadiness,
  SalaryPeriodReadinessSummary,
  SalaryPeriodCloseResult,
  SalaryPeriodLifecycleState,
  SalaryPeriodExclusionResult,
} from './salary-period-close-shared.service';
export {
  closeSalaryPeriod,
  reopenSalaryPeriod,
  getSalaryPeriodClose,
  getSalaryPeriodLifecycle,
  listSalaryPeriodCloses,
  requestSalaryPeriodClose,
  checkSalaryPeriodClose,
  approveSalaryPeriodClose,
  requestSalaryPeriodReopen,
  checkSalaryPeriodReopen,
  approveSalaryPeriodReopen,
} from './salary-period-close-lifecycle.service';
export {
  issueSalaryPeriodPayslips,
  markSalaryPeriodOfficialPosting,
  getSalaryPeriodReadiness,
} from './salary-period-close-payslips.service';
export {
  listSalaryPeriodExclusions,
  createSalaryPeriodExclusion,
  checkSalaryPeriodExclusion,
  approveSalaryPeriodExclusion,
  completeSalaryPeriodExclusionFollowup,
} from './salary-period-close-exclusion.service';
