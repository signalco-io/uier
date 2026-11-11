import { appErrorMessage } from './errorMessages';
import type { AppCatalog, AppI18n, AppTranslator, AppTranslationValues } from './types';
import type { AppLanguage } from './languages';

export function createAppTranslator(catalog: AppCatalog): AppTranslator {
    return (message: string, values?: AppTranslationValues) => {
        if (!Object.hasOwn(catalog, message) && !values) {
            const error = appErrorMessage(message);
            if (error) { message = error.message; values = error.values; }
        }
        const translated = Object.hasOwn(catalog, message) ? catalog[message]! : message;
        return values ? translated.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) =>
            Object.hasOwn(values, name) ? String(values[name]) : placeholder) : translated;
    };
}

export function createAppI18n(language: AppLanguage, catalog: AppCatalog): AppI18n {
    return { language, t: createAppTranslator(catalog) };
}

/** Pure English default for shared data formatters and API/export contracts. */
export const englishAppTranslator = createAppTranslator({});
