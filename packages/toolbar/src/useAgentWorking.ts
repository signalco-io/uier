"use client";

import { useCallback, useSyncExternalStore } from 'react';
import { agentIsWorking } from './agents';

/** One expiry timer per mounted indicator; no polling or network traffic, even after disconnection. */
export function useAgentWorking(workingUntil: string | undefined) {
    const subscribe = useCallback((changed: () => void) => {
        const remaining = workingUntil ? Date.parse(workingUntil) - Date.now() : 0;
        if (!(remaining > 0)) return () => {};
        const timer = setTimeout(changed, remaining);
        return () => clearTimeout(timer);
    }, [workingUntil]);
    return useSyncExternalStore(subscribe, () => agentIsWorking(workingUntil), () => false);
}
