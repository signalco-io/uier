"use client";

import { useCallback, useSyncExternalStore } from 'react';
import { agentIsWorking } from './agents';

/** One expiry timer per mounted indicator; no polling or network traffic, even after disconnection. */
export function useAgentWorking(workingUntil: string | undefined | (string | undefined)[]) {
    const key = (Array.isArray(workingUntil) ? workingUntil : [workingUntil]).filter((value): value is string => Boolean(value)).join('|');
    const subscribe = useCallback((changed: () => void) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = () => {
            const next = key.split('|').map(value => Date.parse(value) - Date.now()).filter(value => value > 0).sort((a, b) => a - b)[0];
            if (next !== undefined) timer = setTimeout(() => { changed(); schedule(); }, next);
        };
        schedule();
        return () => clearTimeout(timer);
    }, [key]);
    // The snapshot changes at each expiry, even when other agents are still working.
    return Boolean(useSyncExternalStore(subscribe, () => key.split('|').filter(value => agentIsWorking(value)).join('|'), () => ''));
}
