import { cx } from '@signalco/ui-primitives/cx';
import type { ActionState } from '../../lib/app/actionResult';
import { destructiveTextClassName } from './PageHeader';

/** The outcome of a form's server action: an error (alert) or a confirmation (status) */
export function FormMessage({ state, className }: { state: ActionState<unknown>; className?: string }) {
    if (!state)
        return null;

    if (!state.ok) {
        return <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName, className)}>{state.error}</p>;
    }

    return state.message
        ? <p role="status" className={cx('m-0 text-sm text-muted-foreground', className)}>{state.message}</p>
        : null;
}
