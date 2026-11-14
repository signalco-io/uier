import type { AppTranslator } from '@/src/lib/i18n/types';

/** A client's projects by status: "2 active, 1 done" (the Clients tab, the project header's client popover) */
export function clientStatusText(active: number, done: number, t: AppTranslator) {
    return [active && t('{count} active', { count: active }), done && t('{count} done', { count: done })].filter(Boolean).join(', ');
}
