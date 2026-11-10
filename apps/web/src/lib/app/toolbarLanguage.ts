import { z } from 'zod';
import {
    defaultProjectLanguage,
    defaultToolbarLanguage,
    readToolbarLanguage,
    toolbarLanguages,
    type ToolbarLanguage,
    type ToolbarLanguageInfo
} from '@uier/toolbar/languages';
import { userPk, type DbProject, type DbUser, type DbWorkspace } from './model';
import { updateDoc } from './store';
import { UserFacingError } from './actionErrors';

// The toolbar's language (docs/project-settings.md#toolbar-language): a workspace default, a project's
// override and each account's own choice. The codes are `@uier/toolbar/languages`; the toolbar resolves
// the person's choice > the project's > the workspace's > English.

export const toolbarLanguageSchema = z.enum(toolbarLanguages, 'Choose a language.');

/** An account's choice; `null` clears it (back to the project's or workspace's language) */
export const userToolbarLanguageSchema = toolbarLanguageSchema.nullable();

/** A project's choice: the workspace's language (`workspace`, nothing stored) or its own */
export const projectToolbarLanguageModes = ['workspace', ...toolbarLanguages] as const;
export type ProjectToolbarLanguageMode = typeof projectToolbarLanguageModes[number];
export const projectToolbarLanguageModeSchema = z.enum(projectToolbarLanguageModes, 'Choose a language.');

/** The workspace's default language: English unless an admin chose another (missing on existing workspaces) */
export function workspaceToolbarLanguage(workspace: Pick<DbWorkspace, 'toolbarLanguage'> | null | undefined): ToolbarLanguage {
    return readToolbarLanguage(workspace?.toolbarLanguage) ?? defaultToolbarLanguage;
}

/** What a project chose; anything but a known language (missing, older documents) follows the workspace */
export function projectToolbarLanguageMode(project: Pick<DbProject, 'toolbarLanguage'>): ProjectToolbarLanguageMode {
    return readToolbarLanguage(project.toolbarLanguage) ?? 'workspace';
}

/** An account's own choice, `null` when it has none */
export function userToolbarLanguage(user: Pick<DbUser, 'toolbarLanguage'> | null | undefined): ToolbarLanguage | null {
    return readToolbarLanguage(user?.toolbarLanguage) ?? null;
}

/**
 * What the toolbar is told: the project's default language and where it comes from, resolved against the
 * current workspace at use time, and an account's own choice (`preference`, only for a signed-in account;
 * a guest's choice stays in their browser). Languages are not private: a guest sees them in the toolbar.
 */
export function toolbarLanguageInfo(
    workspace: Pick<DbWorkspace, 'toolbarLanguage'> | null | undefined,
    project: Pick<DbProject, 'toolbarLanguage'> | null | undefined,
    user?: Pick<DbUser, 'toolbarLanguage'> | null
): ToolbarLanguageInfo {
    const { language, source } = defaultProjectLanguage(workspace?.toolbarLanguage, project?.toolbarLanguage);
    return { default: language, source, ...(user ? { preference: userToolbarLanguage(user) } : {}) };
}

/**
 * Saves an account's toolbar language, or clears it with `null`. Only this field changes, through the
 * document's etag, so a concurrent profile or picture change is never undone. The caller checked who
 * the account is (the session, or a project member's review token).
 */
export async function setUserToolbarLanguage(userId: string, language: unknown): Promise<ToolbarLanguage | null> {
    const parsed = userToolbarLanguageSchema.parse(language);
    const updated = await updateDoc<DbUser>(userPk(userId), userId, user => {
        const { toolbarLanguage: _previous, ...rest } = user;
        return { ...rest, ...(parsed ? { toolbarLanguage: parsed } : {}), updatedAt: new Date().toISOString() };
    });
    if (!updated)
        throw new UserFacingError('Your account is unavailable.');
    return parsed;
}
