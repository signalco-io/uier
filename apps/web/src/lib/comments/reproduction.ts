import type { DbComment } from '../db/schema';
import { commentPath } from './dto';

/** Explicit member-only fields. Page links contain only stored approved state, never a raw URL or user agent. */
export type ReproductionContext = {
    browser?: string;
    os?: string;
    windowSize?: [number, number];
    pixelRatio?: number;
    capturedAt?: string;
    url?: string;
    /** The same allowlisted fields, formatted for copying. */
    text: string;
};

function label(value: unknown) {
    return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 64) || undefined : undefined;
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
            const page = new URL(commentPath(comment), comment.origin);
            if (['http:', 'https:'].includes(page.protocol) && page.origin === comment.origin && !page.username && !page.password)
                url = page.href;
        }
    } catch { /* Malformed legacy addresses remain unavailable. */ }
    const context = { browser: label(device?.browser), os: label(device?.os), windowSize, pixelRatio, capturedAt, url };
    return {
        ...context,
        text: [
            `Browser: ${context.browser ?? 'Unknown'}`,
            `Operating system: ${context.os ?? 'Unknown'}`,
            `Viewport: ${windowSize ? `${windowSize[0]}×${windowSize[1]} CSS px` : 'Unavailable'}`,
            `Pixel ratio: ${pixelRatio ?? 'Unavailable'}`,
            `Captured: ${capturedAt ?? 'Unavailable'}`,
            `Page: ${url ?? 'Unavailable'}`
        ].join('\n')
    };
}
