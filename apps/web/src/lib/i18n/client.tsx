'use client';

import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from 'react';
import { createAppI18n } from './translate';
import type { AppLanguage } from './languages';
import type { AppCatalog } from './types';

// Shared specimens on public pages keep their English text without importing app catalogs or auth.
const AppI18nContext = createContext(createAppI18n('en', {}));

/**
 * The language this document last rendered the app in. The app's error page sits above each group's language
 * boundary (`AppBoundary`), so it has no provider of its own: it reads this one. Browser only: on the server one
 * module serves every request.
 */
let lastAppI18n: ReturnType<typeof createAppI18n> | undefined;

/** Only the chosen language's catalog crosses the server/client boundary. */
export function AppI18nProvider({ language, catalog, children }: PropsWithChildren<{ language: AppLanguage; catalog: AppCatalog }>) {
    const value = useMemo(() => createAppI18n(language, catalog), [language, catalog]);
    useEffect(() => {
        const previous = document.documentElement.lang;
        document.documentElement.lang = language;
        return () => { document.documentElement.lang = previous; };
    }, [language]);
    useEffect(() => { lastAppI18n = value; }, [value]);
    return <AppI18nContext.Provider value={value}><div lang={language} className="contents" data-app-language={language}>{children}</div></AppI18nContext.Provider>;
}

export function useAppI18n() {
    return useContext(AppI18nContext);
}

/**
 * For UI above every `AppI18nProvider` that replaces the app after it rendered (the error page): the app's last
 * language in this document, English before any. Rendered in the browser only, so there is nothing to hydrate.
 */
export function LastAppLanguage({ children }: PropsWithChildren) {
    return lastAppI18n ? <AppI18nContext.Provider value={lastAppI18n}>{children}</AppI18nContext.Provider> : children;
}
