'use server';

import { actOnNotificationToken } from '@/src/lib/notifications/preferences';
import { ApiError } from '@/src/lib/comments/http';

export async function notificationAction(_state: { ok: boolean; message: string }, data: FormData) {
    try {
        const action = data.get('action');
        if (action !== 'verify' && action !== 'unsubscribe' && action !== 'mute') return { ok: false, message: 'Choose a valid action.' };
        await actOnNotificationToken(data.get('token'), action);
        return { ok: true, message: action === 'verify' ? 'Reply notifications confirmed. You can close this page.' : action === 'mute' ? 'Project emails muted.' : 'Unsubscribed from this thread.' };
    } catch (error) {
        if (error instanceof ApiError) return { ok: false, message: error.message };
        console.error('[notifications] Preference update failed.');
        return { ok: false, message: 'The change could not be saved. Try again.' };
    }
}
