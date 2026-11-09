import { browser } from './browser';
import type { WorkerMessage } from './protocol';
declare const __EXTENSION_API__: string;
export const apiOrigin = __EXTENSION_API__;
export const sessionKey = 'extension-session-v1';
export const refreshKey = `extension-refresh-v1:${apiOrigin}`;
export const random = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export type Binding = { activation: string; sessionId: string; tabId: number; origin: string; projectId: string; publicId: string; documentId?: string; scope?: { token: string; expiresAt: number } };
export type Session = { id: string; token: string; expiresAt: number };
export type Credentials = Omit<Session, 'id'> & { refreshToken?: string; refreshExpiresAt?: number };
export type RefreshSession = { id: string; refreshToken: string; refreshExpiresAt: number; attempt?: string };
export type Result = { status: number; headers: [string, string][]; body: string };
export function reviewable(url: string | undefined) {
    if (!url) return false;
    try {
        const u = new URL(url);
        return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
            && u.hostname !== 'addons.mozilla.org'
            && u.hostname !== 'chromewebstore.google.com' && u.hostname !== 'microsoftedge.microsoft.com'
            && !(u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'));
    } catch { return false; }
}
export async function message<T>(input: WorkerMessage): Promise<T> {
    const response = await browser.runtime.sendMessage(input);
    if (!response?.ok) throw new Error(response?.error || 'The extension could not connect.');
    return response.value as T;
}
