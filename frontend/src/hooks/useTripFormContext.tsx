import { createContext, useContext, type ReactNode } from 'react';
import type { UseTripFormReturn } from './useTripForm';

const TripFormContext = createContext<UseTripFormReturn | null>(null);

export function TripFormProvider({ form, children }: { form: UseTripFormReturn; children: ReactNode }) {
  return (
    <TripFormContext.Provider value={form}>
      {children}
    </TripFormContext.Provider>
  );
}

 
export function useTripFormContext(): UseTripFormReturn {
  const ctx = useContext(TripFormContext);
  if (!ctx) throw new Error('useTripFormContext must be used within a TripFormProvider');
  return ctx;
}
