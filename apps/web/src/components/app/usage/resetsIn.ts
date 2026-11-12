import type { AppTranslator } from '@/src/lib/i18n/types';
import type { AppLanguage } from '@/src/lib/i18n/languages';

/** When a limit starts again, in the viewer's language. Callers outside the app keep English. */
export function resetsIn(seconds: number, t: AppTranslator = (message, values) => message.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values?.[name] ?? placeholder)), language: AppLanguage = 'en') {
    if (seconds < 60)
        return t('in less than a minute');
    const relative = new Intl.RelativeTimeFormat(language, { numeric: 'always' });
    if (seconds < 3600) {
        const minutes = Math.ceil(seconds / 60);
        return relative.format(minutes, 'minute');
    }
    const hours = Math.round(seconds / 3600);
    if (hours <= 1) return t('in about an hour');
    if (language === 'en') return t('in about {count} hours', { count: new Intl.NumberFormat(language).format(hours) });
    return t('{time}, approximately', { time: relative.format(hours, 'hour') });
}
