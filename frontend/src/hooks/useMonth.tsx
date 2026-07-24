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
  const initial = getInitialMonth();
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);

  const goPrev = useCallback(() => {
    setMonth(prev => {
      if (prev === 1) {
        setYear(y => y - 1);
        return 12;
      }
      return prev - 1;
    });
  }, []);

  const goNext = useCallback(() => {
    setMonth(prev => {
      if (prev === 12) {
        setYear(y => y + 1);
        return 1;
      }
      return prev + 1;
    });
  }, []);

  const setMonthYear = useCallback((m: number, y: number) => {
    setMonth(m);
    setYear(y);
  }, []);

  return (
    <MonthContext.Provider value={{ month, year, goPrev, goNext, setMonthYear }}>
      {children}
    </MonthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook co-located with its Provider; splitting would fragment a standard React context pattern
export function useMonth(): MonthContextValue {
  const ctx = useContext(MonthContext);
  if (!ctx) throw new Error('useMonth must be used within a MonthProvider');
  return ctx;
}
