'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type Mode = 'website' | 'files';
const Context = createContext<{ mode: Mode; setMode: (mode: Mode) => void }>({ mode: 'website', setMode: () => {} });

export function NewProjectMode({ children }: { children: ReactNode }) {
    const [mode, setMode] = useState<Mode>('website');
    return <Context.Provider value={{ mode, setMode }}>{children}</Context.Provider>;
}

export function useNewProjectMode() {
    return useContext(Context);
}
