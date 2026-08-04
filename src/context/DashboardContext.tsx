import React, { createContext, useContext, useState, useCallback } from 'react';
import type { MITState } from '../types';

export type { MITState };

interface DashboardContextValue {
  mitTasks: Record<string, MITState | null>;
  setMIT:   (listFile: string, state: MITState | null) => void;
}

const DashboardContext = createContext<DashboardContextValue>({
  mitTasks: {},
  setMIT:   () => {},
});

export function useMIT(listFile: string) {
  const { mitTasks, setMIT } = useContext(DashboardContext);
  return {
    mit:    mitTasks[listFile] ?? null,
    setMIT: (state: MITState | null) => setMIT(listFile, state),
  };
}

interface ProviderProps {
  children:         React.ReactNode;
  initialMitTasks:  Record<string, MITState | null>;
  onMitChange:      (tasks: Record<string, MITState | null>) => void;
}

export function DashboardProvider({ children, initialMitTasks, onMitChange }: ProviderProps) {
  const [mitTasks, setMitTasks] = useState<Record<string, MITState | null>>(initialMitTasks);

  const setMIT = useCallback((listFile: string, state: MITState | null) => {
    setMitTasks(prev => {
      const next = { ...prev, [listFile]: state };
      onMitChange(next);
      return next;
    });
  }, [onMitChange]);

  return (
    <DashboardContext.Provider value={{ mitTasks, setMIT }}>
      {children}
    </DashboardContext.Provider>
  );
}
