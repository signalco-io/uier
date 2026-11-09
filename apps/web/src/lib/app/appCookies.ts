import { isLocalRuntime } from '../comments/environment';

export function appCookieOptions(maxAge: number) {
    return { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge, secure: !isLocalRuntime() };
}
