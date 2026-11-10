import { runtimeAdapters } from '../adapters';
import { addAssetScript } from '../assetScript';
import type { ToolbarLanguage } from '../languages';
import { languageHandoffKey, type LanguageAsset, type LanguageScript } from './languageHandoff';

/** Where each language asset but English is published, next to the review bundle (`tsup.config.ts`) */
const published = __UIER_LANGUAGE_ASSETS__;

/**
 * A language's strings: on the web its content-addressed, integrity-checked asset, added as a classic
 * script like the audit asset; in packaged clients their own copy (`ToolbarAdapters.loadLanguage`).
 */
export function loadLanguageAsset(language: ToolbarLanguage): Promise<LanguageAsset> {
    const adapters = runtimeAdapters();
    if (adapters)
        return adapters.loadLanguage ? adapters.loadLanguage(language) : Promise.reject(new Error('Only English is available here.'));
    const asset = published[language];
    if (!asset)
        return Promise.reject(new Error('This language is not available here.'));
    let loaded: LanguageAsset | undefined;
    return addAssetScript<LanguageAsset>({
        path: asset.path,
        integrity: asset.integrity,
        prepare: script => {
            (script as LanguageScript)[languageHandoffKey] = value => {
                if (value?.language === language && value.messages && value.checks) loaded = value;
            };
        },
        received: () => loaded,
        errors: { notStarted: 'The language did not start.', notLoaded: 'The language could not be loaded.' }
    });
}
