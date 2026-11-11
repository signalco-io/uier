import type { AppLanguage } from './languages';
import type { AppCatalog } from './types';

// Catalogs are immutable, public resources. Request/account state is never stored here.
const loaders = {
    en: () => Promise.all([import('./catalogs/common/en'), import('./catalogs/access/en'), import('./catalogs/management/en'), import('./catalogs/comments/en')]),
    de: () => Promise.all([import('./catalogs/common/de'), import('./catalogs/access/de'), import('./catalogs/management/de'), import('./catalogs/comments/de')]),
    fr: () => Promise.all([import('./catalogs/common/fr'), import('./catalogs/access/fr'), import('./catalogs/management/fr'), import('./catalogs/comments/fr')]),
    es: () => Promise.all([import('./catalogs/common/es'), import('./catalogs/access/es'), import('./catalogs/management/es'), import('./catalogs/comments/es')]),
    it: () => Promise.all([import('./catalogs/common/it'), import('./catalogs/access/it'), import('./catalogs/management/it'), import('./catalogs/comments/it')]),
    hr: () => Promise.all([import('./catalogs/common/hr'), import('./catalogs/access/hr'), import('./catalogs/management/hr'), import('./catalogs/comments/hr')])
};

export async function loadAppCatalog(language: AppLanguage): Promise<AppCatalog> {
    const catalogs = await loaders[language]();
    return Object.assign({}, ...catalogs.map(catalog => catalog.default));
}
