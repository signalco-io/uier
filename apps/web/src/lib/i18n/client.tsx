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

/** The language's catalog as the provider received it, for the shell's copy in this browser (`shellCache`) */
const AppCatalogContext = createContext<{ language: AppLanguage; catalog: AppCatalog } | null>(null);

/** Only the chosen language's catalog crosses the server/client boundary. */
export function AppI18nProvider({ language, catalog, children }: PropsWithChildren<{ language: AppLanguage; catalog: AppCatalog }>) {
    const value = useMemo(() => createAppI18n(language, catalog), [language, catalog]);
    const source = useMemo(() => ({ language, catalog }), [language, catalog]);
    useEffect(() => {
        const previous = document.documentElement.lang;
        document.documentElement.lang = language;
        return () => { document.documentElement.lang = previous; };
    }, [language]);
    useEffect(() => { lastAppI18n = value; }, [value]);
    return (
        <AppCatalogContext.Provider value={source}>
            <AppI18nContext.Provider value={value}><div lang={language} className="contents" data-app-language={language}>{children}</div></AppI18nContext.Provider>
        </AppCatalogContext.Provider>
    );
}

export function useAppI18n() {
    return useContext(AppI18nContext);
}

/** The provider's language and catalog; `null` outside every `AppI18nProvider` */
export function useAppCatalog() {
    return useContext(AppCatalogContext);
}

/**
 * The language of a copy the shell draws before the app's own provider is there (`CachedShell`): its words only, without
 * the document's language or the provider's element, which stay the live app's
 */
export function CachedAppI18nProvider({ language, catalog, children }: PropsWithChildren<{ language: AppLanguage; catalog: AppCatalog }>) {
    const value = useMemo(() => createAppI18n(language, catalog), [language, catalog]);
    return <AppI18nContext.Provider value={value}><div lang={language} className="contents">{children}</div></AppI18nContext.Provider>;
}

/**
 * For UI above every `AppI18nProvider` that replaces the app after it rendered (the error page): the app's last
 * language in this document, English before any. Rendered in the browser only, so there is nothing to hydrate.
 */
export function LastAppLanguage({ children }: PropsWithChildren) {
    return lastAppI18n ? <AppI18nContext.Provider value={lastAppI18n}>{children}</AppI18nContext.Provider> : children;
}
