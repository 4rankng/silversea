import React, { lazy, Suspense, type ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SearchProvider } from './context/SearchContext';
import { MonthProvider } from './hooks/useMonth';
import { AgentDirectiveProvider } from './context/AgentDirectiveProvider';
import { TourControllerProvider } from './context/TourControllerContext';
import { TourController } from './components/agent/TourController';
import { ReducedMotionProvider } from './hooks/usePrefersReducedMotion';
import { Role } from '@tingting/shared';
import Layout from './components/Layout';
import CustomerPortalLayout from './pages/portal/CustomerPortalLayout';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { ToastProvider } from './components/shared/Toast';
import { homeForRole, routes } from './lib/routes';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TripListPage = lazy(() => import('./pages/TripListPage'));
const TripCreatePage = lazy(() => import('./pages/TripCreatePage'));
const TripDetailPage = lazy(() => import('./pages/TripDetailPage'));
const TripEditPage = lazy(() => import('./pages/TripEditPage'));
const FinancePage = lazy(() => import('./pages/FinancePage'));
const DebtListPage = lazy(() => import('./pages/DebtListPage'));
const DebtDetailPage = lazy(() => import('./pages/DebtDetailPage'));
const PenaltyPage = lazy(() => import('./pages/PenaltyPage'));
const ConfigPage = lazy(() => import('./pages/ConfigPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
// Wave 0: minimal shipment (lô hàng) list + detail. Read-only — full CUS UI
// ships in Wave 2.
const ShipmentsPage = lazy(() => import('./pages/ShipmentsPage'));
const ShipmentDetailPage = lazy(() => import('./pages/ShipmentDetailPage'));
// Wave 2: Customer portal pages.
const PortalShipmentsPage = lazy(() => import('./pages/portal/PortalShipmentsPage'));
const PortalShipmentDetailPage = lazy(() => import('./pages/portal/PortalShipmentDetailPage'));
const ClerkShipmentCreatePage = lazy(() => import('./pages/clerk/ClerkShipmentCreatePage'));
const ClerkShipmentDocsPage = lazy(() => import('./pages/clerk/ClerkShipmentDocsPage'));
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
const AdminAdvancesPage = lazy(() => import('./pages/AdminAdvancesPage'));
const AdminAdvanceSettlementsPage = lazy(() => import('./pages/AdminAdvanceSettlementsPage'));

const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const ProfitPage = lazy(() => import('./pages/ProfitPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const FleetPage = lazy(() => import('./pages/FleetPage'));
const TruckTiresPage = lazy(() => import('./pages/TruckTiresPage'));
const TrucksConfigPage = lazy(() => import('./pages/config/TrucksConfigPage'));
const TruckOwnersConfigPage = lazy(() => import('./pages/config/TruckOwnersConfigPage'));
const RoutesConfigPage = lazy(() => import('./pages/config/RoutesConfigPage'));
const CargoTypesConfigPage = lazy(() => import('./pages/config/CargoTypesConfigPage'));
const PricingTablesConfigPage = lazy(() => import('./pages/config/PricingTablesConfigPage'));
const RoadAllowancesConfigPage = lazy(() => import('./pages/config/RoadAllowancesConfigPage'));
const PenaltyReasonsConfigPage = lazy(() => import('./pages/config/PenaltyReasonsConfigPage'));
const FuelConfigPage = lazy(() => import('./pages/config/FuelConfigPage'));
const FuelNormsConfigPage = lazy(() => import('./pages/config/FuelNormsConfigPage'));
const WeightPricingTiersConfigPage = lazy(() => import('./pages/config/WeightPricingTiersConfigPage'));
const LiftPricingConfigPage = lazy(() => import('./pages/config/LiftPricingConfigPage'));
const AncillaryRevenueConfigPage = lazy(() => import('./pages/config/AncillaryRevenueConfigPage'));
const FaqEntriesConfigPage = lazy(() => import('./pages/config/FaqEntriesConfigPage'));
const AppSettingsConfigPage = lazy(() => import('./pages/config/AppSettingsConfigPage'));
const CompanyInfoConfigPage = lazy(() => import('./pages/config/CompanyInfoConfigPage'));
const CapTableConfigPage = lazy(() => import('./pages/config/CapTableConfigPage'));
const CustomersConfigPage = lazy(() => import('./pages/config/CustomersConfigPage'));
const TrailersConfigPage = lazy(() => import('./pages/config/TrailersConfigPage'));
const SalaryPeriodConfigPage = lazy(() => import('./pages/config/SalaryPeriodConfigPage'));
const TripExpenseConfigPage = lazy(() => import('./pages/config/TripExpenseConfigPage'));
const SupplierListPage = lazy(() => import('./pages/SupplierListPage'));
const ExpenseListPage = lazy(() => import('./pages/ExpenseListPage'));
const ExpenseEntryPage = lazy(() => import('./pages/ExpenseEntryPage'));
const PayableListPage = lazy(() => import('./pages/PayableListPage'));
const PayableDetailPage = lazy(() => import('./pages/PayableDetailPage'));
const SalaryAttendancePage = lazy(() => import('./pages/SalaryAttendancePage'));

const ExpenseCategoriesConfigPage = lazy(() => import('./pages/config/ExpenseCategoriesConfigPage'));
const ForwarderExpenseTypesConfigPage = lazy(() => import('./pages/config/ForwarderExpenseTypesConfigPage'));
const TirePositionsConfigPage = lazy(() => import('./pages/config/TirePositionsConfigPage'));
const DebitNoteTemplatesConfigPage = lazy(() => import('./pages/config/DebitNoteTemplatesConfigPage'));
const DebitNoteTemplateEditorPage = lazy(() => import('./pages/config/DebitNoteTemplateEditorPage'));
const ChatbotMonitoringPage = lazy(() => import('./pages/ChatbotMonitoringPage'));

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 10, color: 'var(--fg-3)' }}>
      <div className="spin" style={{ width: 24, height: 24, border: '3px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ fontSize: 14 }}>Đang tải…</span>
    </div>
  );
}

function AppRoutes() {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) return <PageLoader />;

  if (!isAuthenticated) return (
    <Suspense fallback={<PageLoader />}>
      <LoginPage />
    </Suspense>
  );

  const isDriver = user?.role === Role.DRIVER;
  const isForwarder = user?.role === Role.FORWARDER;
  const isClerk = user?.role === Role.CLERK;
  const isAdmin = user?.role === Role.ADMIN;
  const driverHome = routes.myTrips;
  const forwarderHome = routes.myForwarderTrips;
  const clerkHome = routes.clerkShipmentNew;
  const adminHome = routes.dashboard;
  const isPortalUser = isDriver || isForwarder;
  const portalHome = isDriver ? driverHome : forwarderHome;
  const customerHome = routes.portalShipments;
  const isCustomer = user?.role === Role.CUSTOMER;
  const defaultHome = homeForRole(user?.role ?? '');
  const homeRedirect = isDriver
    ? driverHome
    : isForwarder
      ? forwarderHome
      : isCustomer
        ? customerHome
        : isClerk
          ? clerkHome
          : adminHome;
  const adminOnly = (el: ReactElement) => (isPortalUser || isCustomer || isClerk ? <Navigate to={homeRedirect} replace /> : el);
  const driverOnly = (el: ReactElement) => (isDriver ? el : <Navigate to={homeRedirect} replace />);
  const forwarderOnly = (el: ReactElement) => (isForwarder ? el : <Navigate to={homeRedirect} replace />);
  const customerOnly = (el: ReactElement) => (isCustomer ? el : <Navigate to={homeRedirect} replace />);
  const managerOrAdminOnly = (el: ReactElement) => (isAdmin || user?.role === Role.MANAGER ? el : <Navigate to={homeRedirect} replace />);
  // /users is the single home for everyone; accountants get scoped (driver-only) access.
  const officeStaffOnly = (el: ReactElement) => (isAdmin || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT ? el : <Navigate to={homeRedirect} replace />);
  // M10.1: CLERK (nhân viên chứng từ) mobile surfaces. ADMIN is admitted as
  // superuser; every other role is bounced to its own home. CLERK's home is
  // the create page itself until a clerk landing page ships.
  const clerkOrAdminOnly = (el: ReactElement) => (isAdmin || isClerk ? el : <Navigate to={homeRedirect} replace />);
  // Strict ADMIN-only — chatbot monitoring exposes raw turns and must never
  // be reachable by MANAGER/ACCOUNTANT. Mirrors managerOrAdminOnly's shape:
  // admit only when the role matches, else bounce to the portal or staff home.
  const strictAdminOnly = (el: ReactElement) => (user?.role === Role.ADMIN ? el : <Navigate to={homeRedirect} replace />);

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
            element={isPortalUser || isCustomer || isClerk ? <Navigate to={homeRedirect} replace /> : page(<DashboardPage />)}
          />
          <Route path="/dispatch" element={adminOnly(page(<DispatchPage />))} />
          <Route path="/fleet" element={adminOnly(page(<FleetPage />))} />
<Route path="/fleet/:id/tires" element={officeStaffOnly(page(<TruckTiresPage />))} />
<Route path="/fleet/trailers/:id/tires" element={officeStaffOnly(page(<TruckTiresPage vehicle="trailer" />))} />
          <Route path="/trips" element={adminOnly(page(<TripListPage />))} />
          <Route path="/trips/new" element={adminOnly(page(<TripCreatePage />))} />
          <Route path="/trips/:id" element={adminOnly(page(<TripDetailPage />))} />
          <Route path="/trips/:id/edit" element={adminOnly(page(<TripEditPage />))} />
          <Route path="/finance" element={adminOnly(page(<FinancePage />))} />
          <Route path="/profit" element={adminOnly(page(<ProfitPage />))} />
          <Route path="/debt" element={adminOnly(page(<DebtListPage />))} />
          <Route path="/debt/:id" element={adminOnly(page(<DebtDetailPage />))} />
          <Route path="/debt/:id/billing/new" element={adminOnly(page(<DebtDetailPage />))} />
          <Route path="/penalties" element={adminOnly(page(<PenaltyPage />))} />
          <Route path="/advances" element={adminOnly(page(<AdminAdvancesPage />))} />
          <Route path="/admin/advance-settlements" element={officeStaffOnly(page(<AdminAdvanceSettlementsPage />))} />

          <Route path="/my-penalties" element={driverOnly(page(<DriverPenaltyPage />))} />
          <Route path="/customers" element={adminOnly(page(<CustomersPage />))} />
          <Route path="/customers/:id" element={adminOnly(page(<DebtDetailPage />))} />
          <Route path="/customers/:id/billing/new" element={adminOnly(page(<DebtDetailPage />))} />
          {/* Wave 0: shipment (lô hàng) read-only list + detail. RBAC mirrors
              the shipments Casbin resource (ADMIN wildcard, MANAGER/ACCOUNTANT
              read). CLERK gets its own portal surface in a later wave. */}
          <Route path="/shipments" element={officeStaffOnly(page(<ShipmentsPage />))} />
          <Route path="/shipments/:id" element={officeStaffOnly(page(<ShipmentDetailPage />))} />
          <Route path="/routes" element={<Navigate to="/config/routes" replace />} />
          <Route path="/trucks" element={<Navigate to="/fleet" replace />} />
          <Route path="/drivers" element={<Navigate to="/fleet" replace />} />
          <Route path="/trailers" element={<Navigate to="/config/trailers" replace />} />
          <Route path="/config" element={adminOnly(page(<ConfigPage />))} />
          <Route path="/config/trailers" element={adminOnly(page(<TrailersConfigPage />))} />
          <Route path="/config/trucks" element={adminOnly(page(<TrucksConfigPage />))} />
          <Route path="/config/trucks/:truckId/owners" element={adminOnly(page(<TruckOwnersConfigPage />))} />
          <Route path="/config/routes" element={adminOnly(page(<RoutesConfigPage />))} />
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
          <Route path="/config/faq-entries" element={strictAdminOnly(page(<FaqEntriesConfigPage />))} />
          <Route path="/config/onboarding-settings" element={strictAdminOnly(<Navigate to="/config/app-settings" replace />)} />
          <Route path="/config/app-settings" element={strictAdminOnly(page(<AppSettingsConfigPage />))} />
          <Route path="/config/company-info" element={adminOnly(page(<CompanyInfoConfigPage />))} />
          <Route path="/config/trip-expense" element={adminOnly(page(<TripExpenseConfigPage />))} />
          <Route path="/config/cap-table" element={adminOnly(page(<CapTableConfigPage />))} />
          <Route path="/config/customers" element={adminOnly(page(<CustomersConfigPage />))} />
          <Route path="/config/management-fees" element={<Navigate to="/config" replace />} />
          <Route path="/config/salary-periods" element={adminOnly(page(<SalaryPeriodConfigPage />))} />
          <Route path="/config/expense-categories" element={adminOnly(page(<ExpenseCategoriesConfigPage />))} />
          <Route path="/config/tire-positions" element={officeStaffOnly(page(<TirePositionsConfigPage />))} />
          <Route path="/config/container-types" element={<Navigate to="/config" replace />} />
          <Route path="/config/seal-types" element={<Navigate to="/config" replace />} />
          <Route path="/config/ports" element={<Navigate to="/config" replace />} />
          <Route path="/config/forwarder-expense-types" element={adminOnly(page(<ForwarderExpenseTypesConfigPage />))} />
          <Route path="/config/debit-note-templates" element={officeStaffOnly(page(<DebitNoteTemplatesConfigPage />))} />
          <Route path="/config/debit-note-templates/new" element={officeStaffOnly(page(<DebitNoteTemplateEditorPage />))} />
          <Route path="/config/debit-note-templates/:id" element={officeStaffOnly(page(<DebitNoteTemplateEditorPage />))} />
          <Route path="/suppliers" element={adminOnly(page(<SupplierListPage />))} />
          <Route path="/suppliers/:id" element={adminOnly(page(<PayableDetailPage />))} />
          <Route path="/expenses" element={adminOnly(page(<ExpenseListPage />))} />
          <Route path="/expenses/new" element={adminOnly(page(<ExpenseEntryPage />))} />
          <Route path="/expenses/:id/edit" element={adminOnly(page(<ExpenseEntryPage />))} />
          <Route path="/payables" element={adminOnly(page(<PayableListPage />))} />
          <Route path="/payables/:id" element={adminOnly(page(<PayableDetailPage />))} />
          <Route path="/salary" element={adminOnly(page(<SalaryAttendancePage />))} />
          <Route path="/users" element={officeStaffOnly(page(<UsersPage />))} />
          <Route path="/chatbot-monitoring" element={strictAdminOnly(page(<ChatbotMonitoringPage />))} />
          <Route path="/audit-logs" element={officeStaffOnly(page(<AuditLogPage />))} />
          <Route path="/audit-log" element={<Navigate to="/audit-logs" replace />} />
          <Route path="/admin/audit-logs" element={<Navigate to="/audit-logs" replace />} />
          <Route path="/admin/audit-log" element={<Navigate to="/audit-logs" replace />} />
          <Route path="/my-trips" element={driverOnly(page(<DriverTripsPage />))} />
          <Route path="/my-trips/two-orders" element={driverOnly(page(<DriverTwoOrdersPage />))} />
          <Route path="/my-trips/:id" element={driverOnly(page(<DriverTripDetailPage />))} />
          <Route path="/my-earnings" element={driverOnly(page(<DriverEarningsPage />))} />
          <Route path="/my-payslips" element={driverOnly(page(<DriverPayslipsPage />))} />
          <Route path="/my-forwarder-trips" element={forwarderOnly(page(<ForwarderTripsPage />))} />
          <Route path="/my-forwarder-trips/:id" element={forwarderOnly(page(<ForwarderTripDetailPage />))} />
          <Route path="/my-advances" element={forwarderOnly(page(<ForwarderAdvancesPage />))} />
          <Route path="/my-settlements" element={forwarderOnly(page(<ForwarderSettlementsPage />))} />
          <Route path="/my-settlements/new" element={forwarderOnly(page(<ForwarderSettlementCreatePage />))} />
          <Route path="/my-settlements/:id" element={forwarderOnly(page(<SettlementPrintPage />))} />
          <Route path="/settlements/:id" element={officeStaffOnly(page(<SettlementPrintPage />))} />
          {/* Wave 2: Customer portal routes. Only CUSTOMER role can access. */}
          <Route path="/portal/shipments" element={customerOnly(page(<PortalShipmentsPage />))} />
          <Route path="/portal/shipments/:id" element={customerOnly(page(<PortalShipmentDetailPage />))} />
          <Route path="/portal/debit-notes" element={customerOnly(page(<PortalDebitNotesPage />))} />
          <Route path="/portal/statement" element={customerOnly(page(<PortalStatementPage />))} />
          {/* Wave 4 M10.1: CLERK mobile quick-shipment-create. ADMIN is
              admitted as superuser; the clerk home is this create page until
              a clerk landing page ships. */}
          <Route path="/clerk/shipments/new" element={clerkOrAdminOnly(page(<ClerkShipmentCreatePage />))} />
          {/* Wave 4 M10.2: clerk doc-entry page (BL + containers + dispatch-readiness). */}
          <Route path="/clerk/shipments/:id/docs" element={clerkOrAdminOnly(page(<ClerkShipmentDocsPage />))} />
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
            <TourControllerProvider>
              <MonthProvider>
                <SearchProvider>
                  <AppRoutes />
                </SearchProvider>
              </MonthProvider>
              {/* Sibling of <AppRoutes/>, OUTSIDE the agent Drawer so it survives
                  route changes and never inherits the drawer's navigate-close. */}
              <TourController />
            </TourControllerProvider>
          </AgentDirectiveProvider>
        </ToastProvider>
      </AuthProvider>
    </ReducedMotionProvider>
  );
}
