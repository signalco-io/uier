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

export const getAppCatalog = cache(async () => loadAppCatalog(await getAppLanguage()));

export const getAppI18n = cache(async () => {
    const [language, catalog] = await Promise.all([getAppLanguage(), getAppCatalog()]);
    return createAppI18n(language, catalog);
});
