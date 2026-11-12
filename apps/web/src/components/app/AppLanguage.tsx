import type { PropsWithChildren } from 'react';
import { getAppLanguage, getAppCatalog } from '@/src/lib/i18n/server';
import { AppI18nProvider } from '@/src/lib/i18n/client';

/** Request language and account data stay below the caller's streaming boundary. */
export async function AppLanguage({ children }: PropsWithChildren) {
    const [language, catalog] = await Promise.all([getAppLanguage(), getAppCatalog()]);
    return <AppI18nProvider language={language} catalog={catalog}>{children}</AppI18nProvider>;
}
