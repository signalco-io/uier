import type { AppTranslator } from '@/src/lib/i18n/types';

/** Source phrases stay readable; Croatian's few form has a separate catalog entry. */
export function pluralText(t: AppTranslator, language: string, count: number, one: string, other: string) {
    const category = new Intl.PluralRules(language).select(count);
    return t(category === 'one' ? one : category === 'few' ? `${other} [few]` : other, { count });
}
