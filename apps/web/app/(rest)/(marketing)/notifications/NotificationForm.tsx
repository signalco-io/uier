'use client';

import { useActionState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { notificationAction } from './actions';

export function NotificationForm({ token, mode }: { token: string; mode: 'verify' | 'subscription' | 'project' }) {
    const [state, action, pending] = useActionState(notificationAction, { ok: false, message: '' });
    return <form action={action} className="flex flex-col items-start gap-4 rounded-xl border p-6">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="action" value={mode === 'verify' ? 'verify' : mode === 'project' ? 'mute' : 'unsubscribe'} />
        <p>{mode === 'verify' ? 'Email is optional. Confirming follows only this thread. Each digest includes an unsubscribe link.'
            : mode === 'project' ? 'Muting stops all notification emails for this project. You can unmute in the toolbar or app.'
                : 'Unsubscribing stops notification emails for this thread. You can follow it again in the toolbar.'}</p>
        {!state.ok && <Button type="submit" disabled={pending}>{mode === 'verify' ? 'Confirm reply notifications' : mode === 'project' ? 'Mute project emails' : 'Unsubscribe from thread'}</Button>}
        {state.message && <p role={state.ok ? 'status' : 'alert'}>{state.message}</p>}
    </form>;
}
