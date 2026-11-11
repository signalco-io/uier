import { cache } from 'react';
import { headers } from 'next/headers';
import { getSessionUser } from '../app/session';
import { loadAppCatalog } from './catalog';
import { resolveAppLanguage } from './languages';
import { createAppI18n } from './translate';

/** React cache deduplicates within one render, never across users or requests. */
export const getAppLanguage = cache(async () => {
    const [user, requestHeaders] = await Promise.all([getSessionUser(), headers()]);
    return resolveAppLanguage(user?.appLanguage, requestHeaders.get('accept-language'));
});

export const getAppCatalog = cache(async () => {
    const language = await getAppLanguage();
    // English source phrases are already in the UI. Send no redundant English dictionary.
    return language === 'en' ? {} : loadAppCatalog(language);
});

export const getAppI18n = cache(async () => {
    const [language, catalog] = await Promise.all([getAppLanguage(), getAppCatalog()]);
    return createAppI18n(language, catalog);
});
