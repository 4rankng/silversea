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
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { ToastProvider } from './components/shared/Toast';

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
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const DriverTripsPage = lazy(() => import('./pages/DriverTripsPage'));
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
  const isAdmin = user?.role === Role.ADMIN;
  const driverHome = '/my-trips';
  const forwarderHome = '/my-forwarder-trips';
  const adminHome = '/dashboard';
  const isPortalUser = isDriver || isForwarder;
  const portalHome = isDriver ? driverHome : forwarderHome;
  const adminOnly = (el: ReactElement) => (isPortalUser ? <Navigate to={portalHome} replace /> : el);
  const driverOnly = (el: ReactElement) => (isDriver ? el : <Navigate to={isForwarder ? forwarderHome : adminHome} replace />);
  const forwarderOnly = (el: ReactElement) => (isForwarder ? el : <Navigate to={isDriver ? driverHome : adminHome} replace />);
  const managerOrAdminOnly = (el: ReactElement) => (isAdmin || user?.role === Role.MANAGER ? el : <Navigate to={isPortalUser ? portalHome : adminHome} replace />);
  // /users is the single home for everyone; accountants get scoped (driver-only) access.
  const officeStaffOnly = (el: ReactElement) => (isAdmin || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT ? el : <Navigate to={isPortalUser ? portalHome : adminHome} replace />);
  // Strict ADMIN-only — chatbot monitoring exposes raw turns and must never
  // be reachable by MANAGER/ACCOUNTANT. Mirrors managerOrAdminOnly's shape:
  // admit only when the role matches, else bounce to the portal or staff home.
  const strictAdminOnly = (el: ReactElement) => (user?.role === Role.ADMIN ? el : <Navigate to={isPortalUser ? portalHome : adminHome} replace />);

  // Wrap each page in its own ErrorBoundary so a crash in one route
  // doesn't block navigation to other routes.
  const page = (el: ReactElement) => (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        {el}
      </Suspense>
    </ErrorBoundary>
  );

  return (
    <Layout>
      <Routes>
          <Route path="/" element={<Navigate to={isPortalUser ? portalHome : adminHome} replace />} />
          <Route
            path="/dashboard"
            element={isPortalUser ? <Navigate to={portalHome} replace /> : page(<DashboardPage />)}
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
          <Route path="/audit-logs" element={managerOrAdminOnly(page(<AuditLogPage />))} />
          <Route path="/audit-log" element={<Navigate to="/audit-logs" replace />} />
          <Route path="/admin/audit-logs" element={<Navigate to="/audit-logs" replace />} />
          <Route path="/admin/audit-log" element={<Navigate to="/audit-logs" replace />} />
          <Route path="/my-trips" element={driverOnly(page(<DriverTripsPage />))} />
          <Route path="/my-trips/:id" element={driverOnly(page(<DriverTripDetailPage />))} />
          <Route path="/my-earnings" element={driverOnly(page(<DriverEarningsPage />))} />
          <Route path="/my-forwarder-trips" element={forwarderOnly(page(<ForwarderTripsPage />))} />
          <Route path="/my-forwarder-trips/:id" element={forwarderOnly(page(<ForwarderTripDetailPage />))} />
          <Route path="/my-advances" element={forwarderOnly(page(<ForwarderAdvancesPage />))} />
          <Route path="/my-settlements" element={forwarderOnly(page(<ForwarderSettlementsPage />))} />
          <Route path="/my-settlements/new" element={forwarderOnly(page(<ForwarderSettlementCreatePage />))} />
          <Route path="/my-settlements/:id" element={forwarderOnly(page(<SettlementPrintPage />))} />
          <Route path="/settlements/:id" element={officeStaffOnly(page(<SettlementPrintPage />))} />
          <Route
            path="*"
            element={<Navigate to={isPortalUser ? portalHome : adminHome} replace />}
          />
        </Routes>
      </Layout>
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
