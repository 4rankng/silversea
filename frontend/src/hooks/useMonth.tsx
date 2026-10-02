import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface MonthContextValue {
  month: number;   // 1-12
  year: number;    // 4-digit
  goPrev: () => void;
  goNext: () => void;
  setMonthYear: (month: number, year: number) => void;
}

const MonthContext = createContext<MonthContextValue | null>(null);

function getInitialMonth(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export function MonthProvider({ children }: { children: ReactNode }) {
  const [{ month, year }, setPeriod] = useState(getInitialMonth);

  const goPrev = useCallback(() => {
    setPeriod(({ month, year }) => month === 1
      ? { month: 12, year: year - 1 }
      : { month: month - 1, year });
  }, []);

  const goNext = useCallback(() => {
    setPeriod(({ month, year }) => month === 12
      ? { month: 1, year: year + 1 }
      : { month: month + 1, year });
  }, []);

  const setMonthYear = useCallback((m: number, y: number) => {
    setPeriod({ month: m, year: y });
  }, []);

  return (
    <MonthContext.Provider value={{ month, year, goPrev, goNext, setMonthYear }}>
      {children}
    </MonthContext.Provider>
  );
}

 
export function useMonth(): MonthContextValue {
  const ctx = useContext(MonthContext);
  if (!ctx) throw new Error('useMonth must be used within a MonthProvider');
  return ctx;
}
