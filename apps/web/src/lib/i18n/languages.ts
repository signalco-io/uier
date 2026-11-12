import { readToolbarLanguage, toolbarLanguages, toolbarLanguageNames, type ToolbarLanguage } from '@uier/toolbar/languages';

/** App and toolbar support the same stable language codes. Their preferences are independent. */
export const appLanguages = toolbarLanguages;
export type AppLanguage = ToolbarLanguage;
export const appLanguageNames = toolbarLanguageNames;
export const defaultAppLanguage: AppLanguage = 'en';
export const readAppLanguage = readToolbarLanguage;

/** The first supported browser language, respecting quality and regional variants. */
export function browserAppLanguage(acceptLanguage: string | null | undefined): AppLanguage {
    const preferences = (acceptLanguage ?? '').split(',').map((part, index) => {
        const [tag = '', ...parameters] = part.trim().split(';');
        const quality = parameters.find(parameter => /^\s*q\s*=/i.test(parameter));
        const q = quality ? Number(quality.slice(quality.indexOf('=') + 1).trim()) : 1;
        return { tag: tag.trim().toLowerCase(), q, index };
    }).filter(({ q }) => Number.isFinite(q) && q > 0 && q <= 1)
        .sort((a, b) => b.q - a.q || a.index - b.index);
    for (const { tag } of preferences) {
        // A wildcard has no language preference. Ignore malformed tags rather than guessing one.
        if (!/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/.test(tag)) continue;
        const supported = readAppLanguage(tag.split('-')[0]);
        if (supported) return supported;
    }
    return defaultAppLanguage;
}

/** An explicit account choice wins over the browser, including an explicit choice of English. */
export function resolveAppLanguage(preference: unknown, acceptLanguage?: string | null): AppLanguage {
    return readAppLanguage(preference) ?? browserAppLanguage(acceptLanguage);
}
