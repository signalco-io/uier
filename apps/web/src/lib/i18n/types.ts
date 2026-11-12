import type { AppLanguage } from './languages';

export type AppCatalog = Readonly<Record<string, string>>;
export type AppTranslationValues = Readonly<Record<string, string | number>>;
/** English source phrases are keys; named placeholders keep translated sentences in their own order. */
export type AppTranslator = (message: string, values?: AppTranslationValues) => string;
export type AppI18n = { language: AppLanguage; t: AppTranslator };
