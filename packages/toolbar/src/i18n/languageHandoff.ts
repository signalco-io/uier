import type { ToolbarLanguage } from '../languages';
import type { Messages } from './en';
import type { LazyMessages } from './lazy/en';

// How a language other than English reaches the toolbar (docs/localization.md). English is part of the
// review bundle; each other language is its own asset (`assets/<code>.ts`, built to `dist/language-<code>.js`)
// with the toolbar's strings and the on-demand checks' strings, loaded only when the toolbar shows it.

/** What a language asset hands over */
export type LanguageAsset = { language: ToolbarLanguage; messages: Messages; checks: LazyMessages };

/** The toolbar's callback a language asset calls while it runs */
export type LanguageReceiver = (asset: LanguageAsset) => void;

/**
 * Where the toolbar puts its callback, never a page global: a property of the language's script
 * element (`LanguageScript`), as for the audit asset (`checks/auditHandoff.ts`). Packaged clients (the
 * browser extension) never add remote scripts: they package the languages (`packaged.ts`).
 */
export const languageHandoffKey = Symbol.for('uier.toolbar.language');
export type LanguageScript = HTMLScriptElement & { [languageHandoffKey]?: LanguageReceiver };

/** Run by a language asset: hands its strings to the review bundle that added its script */
export function handOverLanguage(asset: LanguageAsset) {
    (document.currentScript as LanguageScript | null)?.[languageHandoffKey]?.(asset);
}
