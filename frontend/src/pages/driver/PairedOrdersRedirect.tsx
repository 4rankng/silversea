// PairedOrdersRedirect — SIL-664 route migration. The M8.3 day view moved
// from /my-trips/two-orders to /my-trips/paired-orders (owner-approved name).
// Old deep links (notifications, bookmarks, chat) must keep working: this
// component forwards to the new path, PRESERVING the ?date= query so a dated
// link still lands on that day's paired-orders view instead of silently
// falling back to today.

import { Navigate, useLocation } from 'react-router-dom';

const NEW_PATH = '/my-trips/paired-orders';

export default function PairedOrdersRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: NEW_PATH, search: location.search }} replace />;
}
