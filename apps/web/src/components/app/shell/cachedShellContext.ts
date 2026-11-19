'use client';

import { createContext } from 'react';

/** Inside the copy of the shell this browser draws before the live one (`CachedShell`): it saves nothing itself */
export const CachedShellContext = createContext(false);
