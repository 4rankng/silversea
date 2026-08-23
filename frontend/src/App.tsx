import React, { lazy, Suspense, type ReactElement } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SearchProvider } from './context/SearchContext';
import { MonthProvider } from './hooks/useMonth';
import { AgentDirectiveProvider } from './context/AgentDirectiveProvider';
import { ReducedMotionProvider } from './hooks/usePrefersReducedMotion';
import { Role } from '@tingting/shared';
import Layout from './components/Layout';
import CustomerPortalLayout from './pages/portal/CustomerPortalLayout';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { ToastProvider } from './components/shared/Toast';
import { homeForRole, routes } from './lib/routes';
import { canReadShipmentRoutes } from './lib/role-access';
import { getModernRole } from './lib/role-helpers';

export function legacyAdvanceSettlementsTarget(search: string): string {
  const params = new URLSearchParams(search);
  params.set('view', 'settlements');
  return `${routes.advances}?${params.toString()}`;
}

function LegacyAdvanceSettlementsRedirect() {
  const location = useLocation();
  return <Navigate to={legacyAdvanceSettlementsTarget(location.search)} replace />;
}

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TripListPage = lazy(() => import('./pages/TripListPage'));
const TripCreatePage = lazy(() => import('./pages/TripCreatePage'));
const TripDetailPage = lazy(() => import('./pages/TripDetailPage'));
const TripEditPage = lazy(() => import('./pages/TripEditPage'));
const FinancePage = lazy(() => import('./pages/FinancePage'));
const AccountingWorkspacePage = lazy(() => import('./pages/AccountingWorkspacePage'));
const FuelEvidenceReviewPage = lazy(() => import('./pages/FuelEvidenceReviewPage'));
const TreasuryPositionPage = lazy(() => import('./pages/TreasuryPositionPage'));
const RecoverableCostsPage = lazy(() => import('./pages/RecoverableCostsPage'));
const DebtListPage = lazy(() => import('./pages/DebtListPage'));
const DebtDetailPage = lazy(() => import('./pages/DebtDetailPage'));
const PenaltyPage = lazy(() => import('./pages/PenaltyPage'));
const ConfigPage = lazy(() => import('./pages/ConfigPage'));
const AdminCenterPage = lazy(() => import('./pages/AdminCenterPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
// Wave 0: minimal shipment (lô hàng) list + detail. Read-only — full CUS UI
// ships in Wave 2.
const ShipmentsPage = lazy(() => import('./pages/ShipmentsPage'));
const ShipmentDetailPage = lazy(() => import('./pages/ShipmentDetailPage'));
const ShipmentsDetailPage = lazy(() => import('./pages/ShipmentsDetailPage'));
// Wave 2: Customer portal pages.
const PortalShipmentsPage = lazy(() => import('./pages/portal/PortalShipmentsPage'));
const PortalShipmentDetailPage = lazy(() => import('./pages/portal/PortalShipmentDetailPage'));
const ClerkShipmentCreatePage = lazy(() => import('./pages/clerk/ClerkShipmentCreatePage'));
const PortalDebitNotesPage = lazy(() => import('./pages/portal/PortalDebitNotesPage'));
const PortalStatementPage = lazy(() => import('./pages/portal/PortalStatementPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const DriverTripsPage = lazy(() => import('./pages/DriverTripsPage'));
const DriverTwoOrdersPage = lazy(() => import('./pages/driver/DriverTwoOrdersPage'));
const DriverPayslipsPage = lazy(() => import('./pages/driver/DriverPayslipsPage'));
const DriverTripDetailPage = lazy(() => import('./pages/DriverTripDetailPage'));
const DriverEarningsPage = lazy(() => import('./pages/DriverEarningsPage'));
const DriverPenaltyPage = lazy(() => import('./pages/DriverPenaltyPage'));
const ForwarderTripsPage = lazy(() => import('./pages/ForwarderTripsPage'));
const ForwarderTripDetailPage = lazy(() => import('./pages/ForwarderTripDetailPage'));
const ForwarderAdvancesPage = lazy(() => import('./pages/ForwarderAdvancesPage'));
const ForwarderSettlementsPage = lazy(() => import('./pages/ForwarderSettlementsPage'));
const ForwarderSettlementCreatePage = lazy(() => import('./pages/ForwarderSettlementCreatePage'));
const SettlementPrintPage = lazy(() => import('./pages/SettlementPrintPage'));
const AdvanceWorkspacePage = lazy(() => import('./pages/AdvanceWorkspacePage'));

const MasterPlanPage = lazy(() => import('./pages/MasterPlanPage'));
const DispatchDetailPlanPage = lazy(() => import('./pages/DispatchDetailPlanPage'));
// Dispatcher resource-catalog lookups (read-only views over /api/trucks,
// /api/drivers, /api/suppliers).
const FleetVehiclesPage = lazy(() => import('./pages/FleetVehiclesPage'));
const FleetDriversPage = lazy(() => import('./pages/FleetDriversPage'));
const DispatchSuppliersPage = lazy(() => import('./pages/DispatchSuppliersPage'));
const ProfitPage = lazy(() => import('./pages/ProfitPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const FleetPage = lazy(() => import('./pages/FleetPage'));
const TruckTiresPage = lazy(() => import('./pages/TruckTiresPage'));
const TrucksConfigPage = lazy(() => import('./pages/config/TrucksConfigPage'));
const TruckOwnersConfigPage = lazy(() => import('./pages/config/TruckOwnersConfigPage'));
const RoutesConfigPage = lazy(() => import('./pages/config/RoutesConfigPage'));
const BusinessCalendarConfigPage = lazy(() => import('./pages/config/BusinessCalendarConfigPage'));
const CargoTypesConfigPage = lazy(() => import('./pages/config/CargoTypesConfigPage'));
const PricingTablesConfigPage = lazy(() => import('./pages/config/PricingTablesConfigPage'));
const RoadAllowancesConfigPage = lazy(() => import('./pages/config/RoadAllowancesConfigPage'));
const PenaltyReasonsConfigPage = lazy(() => import('./pages/config/PenaltyReasonsConfigPage'));
const FuelConfigPage = lazy(() => import('./pages/config/FuelConfigPage'));
const FuelNormsConfigPage = lazy(() => import('./pages/config/FuelNormsConfigPage'));
const WeightPricingTiersConfigPage = lazy(() => import('./pages/config/WeightPricingTiersConfigPage'));
const LiftPricingConfigPage = lazy(() => import('./pages/config/LiftPricingConfigPage'));
const AncillaryRevenueConfigPage = lazy(() => import('./pages/config/AncillaryRevenueConfigPage'));
const AppSettingsConfigPage = lazy(() => import('./pages/config/AppSettingsConfigPage'));
const MasterDataImportPage = lazy(() => import('./pages/config/MasterDataImportPage'));
const CompanyInfoConfigPage = lazy(() => import('./pages/config/CompanyInfoConfigPage'));
const CapTableConfigPage = lazy(() => import('./pages/config/CapTableConfigPage'));
const CustomersConfigPage = lazy(() => import('./pages/config/CustomersConfigPage'));
const TrailersConfigPage = lazy(() => import('./pages/config/TrailersConfigPage'));
const SalaryPeriodConfigPage = lazy(() => import('./pages/config/SalaryPeriodConfigPage'));
const PortsConfigPage = lazy(() => import('./pages/config/PortsConfigPage'));
const TripExpenseConfigPage = lazy(() => import('./pages/config/TripExpenseConfigPage'));
const SupplierListPage = lazy(() => import('./pages/SupplierListPage'));
const ExpenseListPage = lazy(() => import('./pages/ExpenseListPage'));
const ExpenseEntryPage = lazy(() => import('./pages/ExpenseEntryPage'));
const PayableListPage = lazy(() => import('./pages/PayableListPage'));
const PayableDetailPage = lazy(() => import('./pages/PayableDetailPage'));
const SalaryAttendancePage = lazy(() => import('./pages/SalaryAttendancePage'));
const CreditOverrideQueuePage = lazy(() => import('./pages/CreditOverrideQueuePage'));
const GovernanceActionsPage = lazy(() => import('./pages/GovernanceActionsPage'));

const ExpenseCategoriesConfigPage = lazy(() => import('./pages/config/ExpenseCategoriesConfigPage'));
const ForwarderExpenseTypesConfigPage = lazy(() => import('./pages/config/ForwarderExpenseTypesConfigPage'));
const TirePositionsConfigPage = lazy(() => import('./pages/config/TirePositionsConfigPage'));
const DebitNoteTemplatesConfigPage = lazy(() => import('./pages/config/DebitNoteTemplatesConfigPage'));
const DebitNoteTemplateEditorPage = lazy(() => import('./pages/config/DebitNoteTemplateEditorPage'));

function PageLoader() {
  return (
    <div data-page-loader="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 10, color: 'var(--fg-3)' }}>
      <div className="spin" style={{ width: 24, height: 24, border: '3px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ fontSize: 14 }}>Đang tải…</span>
    </div>
  );
}

export function AppRoutes() {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;

  if (!isAuthenticated) return (
    <>
      {location.pathname !== '/login' && <Navigate to="/login" replace />}
      <Suspense fallback={<PageLoader />}>
        <LoginPage />
      </Suspense>
    </>
  );

  const currentRole = getModernRole(user?.role ?? '');
  const isDriver = currentRole === Role.DRIVER;
  const isOps = currentRole === Role.OPS;
  const isCus = currentRole === Role.CUS;
  const isAdmin = currentRole === Role.ADMIN;
  const isDispatcher = currentRole === Role.DISPATCHER;
  const driverHome = routes.myTrips;
  const opsHome = routes.myOrders; // formerly forwarderHome
  const cusHome = routes.shipments; // formerly clerkHome
  const isPortalUser = isDriver || isOps; // updated to use isOps
  const customerHome = routes.portalShipments;
  const isCustomer = currentRole === Role.CUSTOMER;
  const defaultHome = homeForRole(currentRole);
  const homeRedirect = isDriver
    ? driverHome
    : isOps
      ? opsHome
      : isCustomer
        ? customerHome
        : isCus
          ? cusHome
          : defaultHome;
  const adminOnly = (el: ReactElement) => (isPortalUser || isCustomer || isCus || isDispatcher || currentRole === Role.ACCOUNTANT ? <Navigate to={homeRedirect} replace /> : el);
  const driverOnly = (el: ReactElement) => (isDriver ? el : <Navigate to={homeRedirect} replace />);
  const opsOnly = (el: ReactElement) => (isOps ? el : <Navigate to={homeRedirect} replace />); // formerly forwarderOnly
  const customerOnly = (el: ReactElement) => (isCustomer ? el : <Navigate to={homeRedirect} replace />);
  // Accountant cannot access dispatch pages
  const dispatchOnly = (el: ReactElement) => (
    isAdmin || currentRole === Role.MANAGER || isDispatcher
      ? el
      : <Navigate to={homeRedirect} replace />
  );
  // /users is the single home for everyone; accountants get scoped (driver-only) access.
  const officeStaffOnly = (el: ReactElement) => (isAdmin || currentRole === Role.MANAGER || currentRole === Role.ACCOUNTANT ? el : <Navigate to={homeRedirect} replace />);
  const accountantOnly = (el: ReactElement) => (currentRole === Role.ACCOUNTANT ? el : <Navigate to={homeRedirect} replace />);
  const shipmentReaderOnly = (el: ReactElement) => (
    canReadShipmentRoutes(currentRole)
      ? el
      : <Navigate to={homeRedirect} replace />
  );
  const financeReaderOnly = (el: ReactElement) => (
    isAdmin || currentRole === Role.MANAGER || currentRole === Role.ACCOUNTANT
      ? el
      : <Navigate to={homeRedirect} replace />
  );
  const capabilityOnly = (capability: string, el: ReactElement) => (
    user?.capabilities?.includes(capability)
      ? el
      : <Navigate to={homeRedirect} replace />
  );
  const recoverableCostOnly = (el: ReactElement) => (
    isAdmin || currentRole === Role.MANAGER || currentRole === Role.ACCOUNTANT || isCus
      ? el
      : <Navigate to={homeRedirect} replace />
  );
  const shipmentCreatorOnly = (el: ReactElement) => (
    isAdmin || isCus || isDispatcher || currentRole === Role.MANAGER
      ? el
      : <Navigate to={homeRedirect} replace />
  );
  // Strict ADMIN-only — chatbot monitoring exposes raw turns and must never
  // be reachable by MANAGER/ACCOUNTANT. Mirrors managerOrAdminOnly's shape:
  // admit only when the role matches, else bounce to the portal or staff home.
  const strictAdminOnly = (el: ReactElement) => (isAdmin ? el : <Navigate to={homeRedirect} replace />);

  // Wrap each page in its own ErrorBoundary so a crash in one route
  // doesn't block navigation to other routes.
  const page = (el: ReactElement) => (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        {el}
      </Suspense>
    </ErrorBoundary>
  );
  const Shell = isCustomer ? CustomerPortalLayout : Layout;

  return (
    <Shell>
      <Routes>
          <Route path="/" element={<Navigate to={defaultHome} replace />} />
          <Route
            path="/dashboard"
            element={isPortalUser || isCustomer || isCus || isDispatcher || currentRole === Role.ACCOUNTANT ? <Navigate to={homeRedirect} replace /> : page(<DashboardPage />)}
          />
          {/* Dispatch planning: /dispatch = Kế hoạch Tổng quát (shipment-level
              carrier allocation), /dispatch-detail = Kế hoạch Chi tiết
              (auto-split container grid with plate assignment). */}
          <Route path="/dispatch" element={dispatchOnly(page(<MasterPlanPage />))} />
          <Route path="/dispatch-detail" element={dispatchOnly(page(<DispatchDetailPlanPage />))} />
          {/* Dispatcher resource catalogs — read-only lookups for staffing
              dispatch plans. ADMIN/MANAGER keep their full /fleet workspace. */}
          <Route path="/fleet/vehicles" element={dispatchOnly(page(<FleetVehiclesPage />))} />
          <Route path="/fleet/drivers" element={dispatchOnly(page(<FleetDriversPage />))} />
          <Route path="/fleet" element={adminOnly(page(<FleetPage />))} />
<Route path="/fleet/:id/tires" element={officeStaffOnly(page(<TruckTiresPage />))} />
<Route path="/fleet/trailers/:id/tires" element={officeStaffOnly(page(<TruckTiresPage vehicle="trailer" />))} />
          <Route path="/trips" element={adminOnly(page(<TripListPage />))} />
          <Route path="/trips/new" element={adminOnly(page(<TripCreatePage />))} />
          <Route path="/trips/:id" element={dispatchOnly(page(<TripDetailPage />))} />
          <Route path="/trips/:id/edit" element={adminOnly(page(<TripEditPage />))} />
          <Route path="/finance" element={financeReaderOnly(page(<FinancePage />))} />
          <Route path="/accounting" element={officeStaffOnly(page(<AccountingWorkspacePage />))} />
          <Route path="/accounting/fuel-evidence" element={accountantOnly(page(<FuelEvidenceReviewPage />))} />
          <Route path="/finance/treasury" element={capabilityOnly('treasury.read', financeReaderOnly(page(<TreasuryPositionPage />)))} />
          <Route path="/recoverable-costs" element={capabilityOnly('recoverable_costs.read', recoverableCostOnly(page(<RecoverableCostsPage />)))} />
          <Route path="/profit" element={financeReaderOnly(page(<ProfitPage />))} />
          <Route path="/debt" element={financeReaderOnly(page(<DebtListPage />))} />
          <Route path="/debt/:id" element={financeReaderOnly(page(<DebtDetailPage />))} />
          <Route path="/debt/:id/billing/new" element={financeReaderOnly(page(<DebtDetailPage />))} />
          <Route path="/penalties" element={adminOnly(page(<PenaltyPage />))} />
          <Route path="/advances" element={financeReaderOnly(page(<AdvanceWorkspacePage />))} />
          <Route
            path="/admin/advance-settlements"
            element={officeStaffOnly(<LegacyAdvanceSettlementsRedirect />)}
          />

          <Route path="/my-penalties" element={driverOnly(page(<DriverPenaltyPage />))} />
          <Route path="/customers" element={adminOnly(page(<CustomersPage />))} />
          <Route path="/customers/:id" element={adminOnly(page(<DebtDetailPage />))} />
          <Route path="/customers/:id/billing/new" element={adminOnly(page(<DebtDetailPage />))} />
          {/* Shipment list/detail mirrors the backend read policy, including
              Dispatcher read access. Mutation routes remain separately gated. */}
          <Route path="/shipments" element={shipmentReaderOnly(page(<ShipmentsPage />))} />
          <Route path="/shipments/new" element={shipmentCreatorOnly(page(<ClerkShipmentCreatePage />))} />
          <Route path="/shipments-detail" element={shipmentReaderOnly(page(<ShipmentsDetailPage />))} />
          <Route path="/shipments/:id" element={shipmentReaderOnly(page(<ShipmentDetailPage />))} />
          <Route path="/routes" element={<Navigate to="/config/routes" replace />} />
          <Route path="/trucks" element={<Navigate to="/fleet" replace />} />
          <Route path="/drivers" element={<Navigate to="/fleet" replace />} />
          <Route path="/trailers" element={<Navigate to="/config/trailers" replace />} />
          {/* Trung tâm quản trị — strict-ADMIN health hub (mirrors the
              /system/admin-health work-inbox RBAC). Kept separate from /config. */}
          <Route path="/admin-center" element={strictAdminOnly(page(<AdminCenterPage />))} />
          <Route path="/config" element={adminOnly(page(<ConfigPage />))} />
          <Route path="/config/trailers" element={adminOnly(page(<TrailersConfigPage />))} />
          <Route path="/config/trucks" element={adminOnly(page(<TrucksConfigPage />))} />
          <Route path="/config/trucks/:truckId/owners" element={adminOnly(page(<TruckOwnersConfigPage />))} />
          <Route path="/config/routes" element={adminOnly(page(<RoutesConfigPage />))} />
          <Route path="/config/business-calendar" element={strictAdminOnly(page(<BusinessCalendarConfigPage />))} />
          <Route path="/config/cargo-types" element={adminOnly(page(<CargoTypesConfigPage />))} />
          <Route path="/config/pricing-tables" element={adminOnly(page(<PricingTablesConfigPage />))} />
          <Route path="/config/road-allowances" element={adminOnly(page(<RoadAllowancesConfigPage />))} />
          <Route path="/config/penalty-reasons" element={adminOnly(page(<PenaltyReasonsConfigPage />))} />
          <Route path="/config/fuel" element={adminOnly(page(<FuelConfigPage />))} />
          <Route path="/config/fuel-norms" element={adminOnly(page(<FuelNormsConfigPage />))} />
          <Route path="/config/weight-pricing-tiers" element={adminOnly(page(<WeightPricingTiersConfigPage />))} />
          <Route path="/config/lift-pricing" element={adminOnly(page(<LiftPricingConfigPage />))} />
          <Route path="/config/ancillary-revenue" element={adminOnly(page(<AncillaryRevenueConfigPage />))} />
          <Route path="/config/llm-settings" element={strictAdminOnly(<Navigate to="/config/app-settings" replace />)} />
          <Route path="/config/app-settings" element={strictAdminOnly(page(<AppSettingsConfigPage />))} />
          <Route path="/config/master-data-import" element={strictAdminOnly(page(<MasterDataImportPage />))} />
          <Route path="/config/company-info" element={officeStaffOnly(page(<CompanyInfoConfigPage />))} />
          <Route path="/config/trip-expense" element={adminOnly(page(<TripExpenseConfigPage />))} />
          <Route path="/config/cap-table" element={adminOnly(page(<CapTableConfigPage />))} />
          <Route path="/config/customers" element={adminOnly(page(<CustomersConfigPage />))} />
          <Route path="/config/management-fees" element={<Navigate to="/config" replace />} />
          <Route path="/config/salary-periods" element={adminOnly(page(<SalaryPeriodConfigPage />))} />
          <Route path="/config/expense-categories" element={adminOnly(page(<ExpenseCategoriesConfigPage />))} />
          <Route path="/config/tire-positions" element={officeStaffOnly(page(<TirePositionsConfigPage />))} />
          <Route path="/config/container-types" element={<Navigate to="/config" replace />} />
          <Route path="/config/seal-types" element={<Navigate to="/config" replace />} />
          <Route path="/config/ports" element={adminOnly(page(<PortsConfigPage />))} />
          <Route path="/config/forwarder-expense-types" element={adminOnly(page(<ForwarderExpenseTypesConfigPage />))} />
          <Route path="/config/debit-note-templates" element={officeStaffOnly(page(<DebitNoteTemplatesConfigPage />))} />
          <Route path="/config/debit-note-templates/new" element={officeStaffOnly(page(<DebitNoteTemplateEditorPage />))} />
          <Route path="/config/debit-note-templates/:id" element={officeStaffOnly(page(<DebitNoteTemplateEditorPage />))} />
          {/* Suppliers: ADMIN/MANAGER get the full payable-aware workspace;
              DISPATCHER gets the read-only subcontractor lookup (no payables —
              financial is Casbin-denied for dispatchers). */}
          <Route
            path="/suppliers"
            element={
              isDispatcher
                ? dispatchOnly(page(<DispatchSuppliersPage />))
                : adminOnly(page(<SupplierListPage />))
            }
          />
          <Route path="/suppliers/:id" element={adminOnly(page(<PayableDetailPage />))} />
          <Route path="/expenses" element={financeReaderOnly(page(<ExpenseListPage />))} />
          <Route path="/expenses/new" element={adminOnly(page(<ExpenseEntryPage />))} />
          <Route path="/expenses/:id/edit" element={adminOnly(page(<ExpenseEntryPage />))} />
          <Route path="/payables" element={financeReaderOnly(page(<PayableListPage />))} />
          <Route path="/payables/:id" element={financeReaderOnly(page(<PayableDetailPage />))} />
          <Route path="/salary" element={adminOnly(page(<SalaryAttendancePage />))} />
          <Route path="/credit-overrides" element={officeStaffOnly(page(<CreditOverrideQueuePage />))} />
          <Route path="/governance-actions" element={officeStaffOnly(page(<GovernanceActionsPage />))} />
          <Route path="/users" element={officeStaffOnly(page(<UsersPage />))} />
          <Route path="/audit-logs" element={officeStaffOnly(page(<AuditLogPage />))} />
          <Route path="/audit-log" element={<Navigate to="/audit-logs" replace />} />
          <Route path="/admin/audit-logs" element={<Navigate to="/audit-logs" replace />} />
          <Route path="/admin/audit-log" element={<Navigate to="/audit-logs" replace />} />
          <Route path="/my-trips" element={driverOnly(page(<DriverTripsPage />))} />
          <Route path="/my-trips/two-orders" element={driverOnly(page(<DriverTwoOrdersPage />))} />
          <Route path="/my-trips/:id" element={driverOnly(page(<DriverTripDetailPage />))} />
          <Route path="/my-earnings" element={driverOnly(page(<DriverEarningsPage />))} />
          <Route path="/my-payslips" element={driverOnly(page(<DriverPayslipsPage />))} />
          <Route path="/my-orders" element={opsOnly(page(<ForwarderTripsPage />))} />
          <Route path="/my-forwarder-trips" element={opsOnly(page(<ForwarderTripsPage />))} />
          <Route path="/my-forwarder-trips/:id" element={opsOnly(page(<ForwarderTripDetailPage />))} />
          <Route path="/my-advances" element={opsOnly(page(<ForwarderAdvancesPage />))} />
          <Route path="/my-settlements" element={opsOnly(page(<ForwarderSettlementsPage />))} />
          <Route path="/my-settlements/new" element={opsOnly(page(<ForwarderSettlementCreatePage />))} />
          <Route path="/my-settlements/:id" element={opsOnly(page(<SettlementPrintPage />))} />
          <Route path="/settlements/:id" element={officeStaffOnly(page(<SettlementPrintPage />))} />
          {/* Wave 2: Customer portal routes. Only CUSTOMER role can access. */}
          <Route path="/portal/shipments" element={customerOnly(page(<PortalShipmentsPage />))} />
          <Route path="/portal/shipments/:id" element={customerOnly(page(<PortalShipmentDetailPage />))} />
          <Route path="/portal/debit-notes" element={customerOnly(page(<PortalDebitNotesPage />))} />
          <Route path="/portal/statement" element={customerOnly(page(<PortalStatementPage />))} />
          <Route path="*" element={<Navigate to={defaultHome} replace />} />
        </Routes>
      </Shell>
  );
}

export default function App() {
  return (
    <ReducedMotionProvider>
      <AuthProvider>
        <ToastProvider>
          <AgentDirectiveProvider>
            <MonthProvider>
              <SearchProvider>
                <AppRoutes />
              </SearchProvider>
            </MonthProvider>
          </AgentDirectiveProvider>
        </ToastProvider>
      </AuthProvider>
    </ReducedMotionProvider>
  );
}
