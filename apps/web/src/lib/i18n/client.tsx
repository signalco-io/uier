'use client';

import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from 'react';
import { createAppI18n } from './translate';
import type { AppLanguage } from './languages';
import type { AppCatalog } from './types';

// Shared specimens on public pages keep their English text without importing app catalogs or auth.
const AppI18nContext = createContext(createAppI18n('en', {}));

/** Only the chosen language's catalog crosses the server/client boundary. */
export function AppI18nProvider({ language, catalog, children }: PropsWithChildren<{ language: AppLanguage; catalog: AppCatalog }>) {
    const value = useMemo(() => createAppI18n(language, catalog), [language, catalog]);
    useEffect(() => {
        const previous = document.documentElement.lang;
        document.documentElement.lang = language;
        return () => { document.documentElement.lang = previous; };
    }, [language]);
    return <AppI18nContext.Provider value={value}><div lang={language} className="contents" data-app-language={language}>{children}</div></AppI18nContext.Provider>;
}

export function useAppI18n() {
    return useContext(AppI18nContext);
}
