import { defaultProjectLanguage, readToolbarLanguage } from '@uier/toolbar/languages';
import type { DbProject, DbWorkspace } from '../../app/model';
import { getAppStore, type AppStore } from '../../app/store';
import { loadAppCatalog } from '../../i18n/catalog';
import { createAppI18n } from '../../i18n/translate';

export const englishSlackI18n = createAppI18n('en', {});

/** Shared channel messages follow the project's review language, never an individual account or request. */
export async function loadSlackI18n(project: DbProject, store: AppStore = getAppStore()) {
    const workspace = readToolbarLanguage(project.toolbarLanguage) ? undefined
        : (await store.get<DbWorkspace>(project.pk, project.workspaceId))?.doc;
    const { language } = defaultProjectLanguage(workspace?.toolbarLanguage, project.toolbarLanguage);
    return language === 'en' ? englishSlackI18n : createAppI18n(language, await loadAppCatalog(language));
}
