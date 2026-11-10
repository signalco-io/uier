import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import type { ToolbarLanguage } from '../languages';
import { retryLanguage, setLanguagePreference, useLanguageState } from '../i18n';
import { apiRequest } from './api';

/**
 * Saves a signed-in account's toolbar language: a project's review API (the member's review token) or,
 * on uier's own pages, the visitor API (the app's session). `null` goes back to the default.
 */
async function saveLanguage(language: ToolbarLanguage | null) {
    const url = toolbarConfig.project
        ? `${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/language`
        : `${toolbarConfig.apiUrl}/api/visitor/language`;
    await apiRequest<{ language: ToolbarLanguage | null }>(url, { method: 'POST', body: { language } });
}

/**
 * Options' language choice. It shows at once; a guest's choice stays in this browser, a signed-in account's
 * is saved to it (the toolbar on every site and Account → Toolbar language). A failed save goes back to the
 * choice before it and says so.
 */
export function useLanguageChoice() {
    const state = useLanguageState();
    const saving = useRef(false);
    const save = useMutation({
        mutationFn: ({ language }: { language: ToolbarLanguage | null; previous: ToolbarLanguage | null }) => saveLanguage(language),
        onError: (_error, { previous }) => setLanguagePreference(previous),
        onSettled: () => { saving.current = false; }
    });
    const choose = (language: ToolbarLanguage | null) => {
        // Keep a second choice from overtaking the account write, including before React re-renders.
        if (saving.current) return;
        if (language === state.preference) {
            // The same choice again: load its language again if it could not load
            if (state.failed) retryLanguage();
            return;
        }
        const previous = state.preference;
        save.reset();
        setLanguagePreference(language);
        if (state.account) {
            saving.current = true;
            save.mutate({ language, previous });
        }
    };
    return { state, choose, saving: save.isPending, failed: save.isError };
}
