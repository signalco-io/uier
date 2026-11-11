import type { AppTranslator } from '@/src/lib/i18n/types';
import type { AppLanguage } from '@/src/lib/i18n/languages';

/** When a limit starts again, in the viewer's language. Callers outside the app keep English. */
export function resetsIn(seconds: number, t: AppTranslator = (message, values) => message.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values?.[name] ?? placeholder)), language: AppLanguage = 'en') {
    if (seconds < 60)
        return t('in less than a minute');
    if (seconds < 3600) {
        const minutes = Math.ceil(seconds / 60);
        return t(minutes === 1 ? 'in {count} minute' : 'in {count} minutes', { count: new Intl.NumberFormat(language).format(minutes) });
    }
    const hours = Math.round(seconds / 3600);
    return hours <= 1 ? t('in about an hour') : t('in about {count} hours', { count: new Intl.NumberFormat(language).format(hours) });
}
