import type { ToolbarLanguage } from '../languages';

// Plural forms for the catalogs. English, German, French, Spanish and Italian need one and other
// (French and Spanish also have `many` for round millions, which reads like other); Croatian also has few
// (2–4, 22–24, ...: "2 komentara"), and its one covers 21, 31, ... ("21 komentar").

const rules = new Map<ToolbarLanguage, Intl.PluralRules>();

function category(language: ToolbarLanguage, count: number) {
    let rule = rules.get(language);
    if (!rule) {
        rule = new Intl.PluralRules(language);
        rules.set(language, rule);
    }
    return rule.select(count);
}

/** One of two forms by the language's plural rules */
export function plural(language: ToolbarLanguage, count: number, one: string, other: string) {
    return category(language, count) === 'one' ? one : other;
}

/** Croatian: one (1, 21, 31 ...), few (2–4, 22–24 ...) or other */
export function pluralHr(count: number, one: string, few: string, other: string) {
    const form = category('hr', count);
    return form === 'one' ? one : form === 'few' ? few : other;
}
