import type { ToolbarLanguage } from '../languages';
import type { LanguageAsset } from './languageHandoff';
import { de } from './de';
import { fr } from './fr';
import { es } from './es';
import { it } from './it';
import { hr } from './hr';
import { lazyDe } from './lazy/de';
import { lazyFr } from './lazy/fr';
import { lazyEs } from './lazy/es';
import { lazyIt } from './lazy/it';
import { lazyHr } from './lazy/hr';

// Every language, for packaged clients (the browser extension): they never add remote scripts, so they
// bundle the languages the web loads as assets (`languageHandoff.ts`) and hand them over through
// `ToolbarAdapters.loadLanguage`.

const languages: Record<Exclude<ToolbarLanguage, 'en'>, LanguageAsset> = {
    de: { language: 'de', messages: de, checks: lazyDe },
    fr: { language: 'fr', messages: fr, checks: lazyFr },
    es: { language: 'es', messages: es, checks: lazyEs },
    it: { language: 'it', messages: it, checks: lazyIt },
    hr: { language: 'hr', messages: hr, checks: lazyHr }
};

/** A packaged language's strings (`ToolbarAdapters.loadLanguage`) */
export async function loadPackagedLanguage(language: ToolbarLanguage): Promise<LanguageAsset> {
    if (language === 'en') throw new Error('English is part of the toolbar.');
    return languages[language];
}
