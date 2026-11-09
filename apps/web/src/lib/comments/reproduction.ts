import type { DbComment } from '../db/schema';
import { commentSourcePath } from './dto';
import { deviceSettings, pageLanguagePattern } from '@uier/toolbar/devices';

/**
 * Explicit member-only fields. Page links contain only stored approved state; a comment never holds
 * a raw URL, user-agent string or IP address.
 */
export type ReproductionContext = {
    browser?: string;
    os?: string;
    /** A phone's or tablet's model ("Pixel 8") */
    model?: string;
    windowSize?: [number, number];
    pixelRatio?: number;
    input?: 'touch' | 'mouse';
    colorScheme?: 'light' | 'dark';
    reducedMotion?: boolean;
    /** The page's language ("en-GB") */
    pageLanguage?: string;
    capturedAt?: string;
    url?: string;
    /** The same allowlisted fields, formatted for copying. */
    text: string;
};

function label(value: unknown) {
    return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 64) || undefined : undefined;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]) {
    return values.includes(value as T) ? value as T : undefined;
}

export function toReproductionContext(comment: DbComment, allowedOrigins: readonly string[]): ReproductionContext {
    const device = comment.device;
    const size = device?.windowSize;
    const windowSize: [number, number] | undefined = Array.isArray(size) && size.length === 2 && size.every(n => Number.isInteger(n) && n >= 0 && n <= 20000)
        ? [size[0]!, size[1]!] : undefined;
    const pixelRatio = typeof device?.pixelRatio === 'number' && Number.isFinite(device.pixelRatio) && device.pixelRatio > 0 && device.pixelRatio <= 10 ? device.pixelRatio : undefined;
    const captureTime = typeof device?.capturedAt === 'string' ? Date.parse(device.capturedAt) : NaN;
    const capturedAt = Number.isFinite(captureTime) ? new Date(captureTime).toISOString() : undefined;
    let url: string | undefined;
    try {
        if (comment.origin && allowedOrigins.includes(comment.origin) && comment.path.startsWith('/') && !comment.path.startsWith('//') && !comment.path.includes('\\')) {
            const page = new URL(commentSourcePath(comment), comment.origin);
            if (['http:', 'https:'].includes(page.protocol) && page.origin === comment.origin && !page.username && !page.password)
                url = page.href;
        }
    } catch { /* Malformed legacy addresses remain unavailable. */ }
    // Recorded since the toolbar parses the user-agent string; older comments have none of them
    const input = oneOf(device?.input, ['touch', 'mouse'] as const);
    const colorScheme = oneOf(device?.colorScheme, ['light', 'dark'] as const);
    const reducedMotion = typeof device?.reducedMotion === 'boolean' ? device.reducedMotion : undefined;
    const pageLanguage = typeof device?.pageLanguage === 'string' && pageLanguagePattern.test(device.pageLanguage) ? device.pageLanguage : undefined;
    const context = {
        browser: label(device?.browser), os: label(device?.os), model: label(device?.model), windowSize, pixelRatio,
        input, colorScheme, reducedMotion, pageLanguage, capturedAt, url
    };
    return {
        ...context,
        text: [
            `Browser: ${context.browser ?? 'Unknown'}`,
            `Operating system: ${context.os ?? 'Unknown'}`,
            `Viewport: ${windowSize ? `${windowSize[0]}×${windowSize[1]} CSS px` : 'Unavailable'}`,
            `Pixel ratio: ${pixelRatio ?? 'Unavailable'}`,
            ...deviceSettings(context).map(([name, value]) => `${name}: ${value}`),
            `Captured: ${capturedAt ?? 'Unavailable'}`,
            `Page: ${url ?? 'Unavailable'}`
        ].join('\n')
    };
}
