import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

export interface PortalCustomerOption {
  id: number;
  name: string;
}

interface CustomerPortalScopeValue {
  customers: PortalCustomerOption[];
  selectedCustomerId: number | null;
  ready: boolean;
  error: string | null;
  retry: () => void;
  setSelectedCustomerId: (customerId: number) => void;
}

const CustomerPortalScopeContext = createContext<CustomerPortalScopeValue>({
  customers: [],
  selectedCustomerId: null,
  ready: true,
  error: null,
  retry: () => undefined,
  setSelectedCustomerId: () => undefined,
});

export function CustomerPortalScopeProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedCustomerId = useRef<number | null>((() => {
    const rawCustomerId = new URLSearchParams(location.search).get('customerId');
    if (rawCustomerId == null) return null;
    const parsedCustomerId = Number(rawCustomerId);
    return Number.isInteger(parsedCustomerId) && parsedCustomerId > 0 ? parsedCustomerId : null;
  })());
  const [customers, setCustomers] = useState<PortalCustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerIdState] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    api.get<{ primaryCustomerId: number | null; customers: PortalCustomerOption[] }>('/portal/customer-scope')
      .then((response) => {
        if (!active) return;
        setError(null);
        const linkedCustomers = response.customers ?? [];
        const allowedIds = new Set(linkedCustomers.map(customer => customer.id));
        const initialCustomerId = requestedCustomerId.current != null && allowedIds.has(requestedCustomerId.current)
          ? requestedCustomerId.current
          : response.primaryCustomerId != null && allowedIds.has(response.primaryCustomerId)
            ? response.primaryCustomerId
            : linkedCustomers[0]?.id ?? null;
        setCustomers(linkedCustomers);
        setSelectedCustomerIdState(initialCustomerId);
      })
      .catch(() => {
        if (!active) return;
        // The existing single-customer portal remains usable when the optional
        // scope catalog cannot be loaded; backend routes still default to the
        // primary compatibility pointer and enforce row scope.
        setCustomers([]);
        setSelectedCustomerIdState(null);
        setError('Không thể tải danh sách pháp nhân. Hệ thống đang hiển thị pháp nhân mặc định.');
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, [retryKey]);

  const value = useMemo<CustomerPortalScopeValue>(() => ({
    customers,
    selectedCustomerId,
    ready,
    error,
    retry: () => {
      setReady(false);
      setRetryKey(value => value + 1);
    },
    setSelectedCustomerId: (customerId) => {
      if (customers.some(customer => customer.id === customerId)) {
        setSelectedCustomerIdState(customerId);
        const searchParams = new URLSearchParams(location.search);
        searchParams.set('customerId', String(customerId));
        navigate({
          pathname: location.pathname,
          search: `?${searchParams.toString()}`,
          hash: location.hash,
        }, { replace: true });
      }
    },
  }), [customers, error, location.hash, location.pathname, location.search, navigate, ready, selectedCustomerId]);

  return (
    <CustomerPortalScopeContext.Provider value={value}>
      {children}
    </CustomerPortalScopeContext.Provider>
  );
}

export function useCustomerPortalScope() {
  return useContext(CustomerPortalScopeContext);
}

export function withCustomerScope(path: string, customerId: number | null): string {
  if (customerId == null) return path;
  return `${path}${path.includes('?') ? '&' : '?'}customerId=${customerId}`;
}
