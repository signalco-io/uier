'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';
import type { ActionState } from '../../lib/app/actionResult';
import { destructiveTextClassName } from './PageHeader';

/** The outcome of a form's server action: an error (alert) or a confirmation (status) */
export function FormMessage({ state, className }: { state: ActionState<unknown>; className?: string }) {
    const { t } = useAppI18n();
    if (!state)
        return null;

    if (!state.ok) {
        return <p role="alert" className={cn('m-0 text-sm', destructiveTextClassName, className)}>{t(state.error)}</p>;
    }

    return state.message
        ? <p role="status" className={cn('m-0 text-sm text-muted-foreground', className)}>{t(state.message)}</p>
        : null;
}
