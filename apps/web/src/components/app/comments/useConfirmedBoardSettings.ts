'use client';

import { useState } from 'react';
import type { BoardColumn, BoardSort } from '@/src/lib/app/boardSort';

type Settings = Record<BoardColumn, BoardSort> & { archiveExpanded: boolean; groupIds: false | string[] };
type Key = keyof Settings;

/** Successful saves outlive their action transition until an authorized snapshot observes each field. */
export function useConfirmedBoardSettings(saved: Settings, scope: string) {
    const [confirmed, setConfirmed] = useState<{ scope: string; values: Partial<Settings> }>({ scope, values: {} });
    const current = confirmed.scope === scope ? confirmed.values : {};
    const remaining = Object.fromEntries(Object.entries(current).filter(([key, value]) =>
        JSON.stringify(saved[key as Key]) !== JSON.stringify(value))) as Partial<Settings>;
    if (confirmed.scope !== scope || Object.keys(remaining).length !== Object.keys(current).length)
        setConfirmed({ scope, values: remaining });
    const confirm = (values: Partial<Settings>) => setConfirmed(current => ({
        scope, values: { ...(current.scope === scope ? current.values : {}), ...values }
    }));
    return [{ ...saved, ...remaining }, confirm] as const;
}
