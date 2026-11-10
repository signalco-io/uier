/**
 * The toolbar's languages (`@uier/toolbar/languages`), shared by the toolbar, the app's settings and the
 * API. Pure: no React and no DOM, so server code can import it. The codes are stable machine values,
 * stored on workspaces, projects and accounts; never rename one.
 *
 * Which language the toolbar shows, first match wins:
 * 1. the person's own choice: a signed-in account's preference (Options or Account), or a guest's choice
 *    kept in this browser;
 * 2. the project's language;
 * 3. the workspace's default language;
 * 4. English.
 */
export const toolbarLanguages = ['en', 'de', 'fr', 'es', 'it', 'hr'] as const;
export type ToolbarLanguage = typeof toolbarLanguages[number];

/** What a missing setting means: existing workspaces, projects and accounts show English */
export const defaultToolbarLanguage: ToolbarLanguage = 'en';

/** Each language in its own words, as language pickers show them, whatever the current language is */
export const toolbarLanguageNames: Record<ToolbarLanguage, string> = {
    en: 'English',
    de: 'Deutsch',
    fr: 'Français',
    es: 'Español',
    it: 'Italiano',
    hr: 'Hrvatski'
};

/** Each language's name in English, for the app's settings (the app is in English) */
export const toolbarLanguageEnglishNames: Record<ToolbarLanguage, string> = {
    en: 'English',
    de: 'German',
    fr: 'French',
    es: 'Spanish',
    it: 'Italian',
    hr: 'Croatian'
};

/** "German (Deutsch)", "English": the app's label of a language */
export function toolbarLanguageLabel(language: ToolbarLanguage) {
    const english = toolbarLanguageEnglishNames[language];
    const own = toolbarLanguageNames[language];
    return english === own ? english : `${english} (${own})`;
}

export function isToolbarLanguage(value: unknown): value is ToolbarLanguage {
    return typeof value === 'string' && (toolbarLanguages as readonly string[]).includes(value);
}

/** A stored or received value as a language; anything else (missing, older or foreign values) is none */
export function readToolbarLanguage(value: unknown): ToolbarLanguage | undefined {
    return isToolbarLanguage(value) ? value : undefined;
}

/** Where the default language of a project's toolbar comes from */
export type ToolbarLanguageSource = 'project' | 'workspace' | 'default';

/** The language a project's toolbar shows to someone who has not chosen one, and where it comes from */
export function defaultProjectLanguage(workspace: unknown, project: unknown): { language: ToolbarLanguage; source: ToolbarLanguageSource } {
    const own = readToolbarLanguage(project);
    if (own) return { language: own, source: 'project' };
    const inherited = readToolbarLanguage(workspace);
    if (inherited) return { language: inherited, source: 'workspace' };
    return { language: defaultToolbarLanguage, source: 'default' };
}

/**
 * What the review API (`GET /api/review/<project>`) and the visitor API (`GET /api/visitor`) tell the
 * toolbar: the default language with its source, and a signed-in account's own choice (`null` when it
 * has none; missing for guests, whose choice stays in their browser).
 */
export type ToolbarLanguageInfo = {
    default: ToolbarLanguage;
    source: ToolbarLanguageSource;
    preference?: ToolbarLanguage | null;
};

/** The language the toolbar shows: the person's choice, else the project's or workspace's default, else English */
export function resolveToolbarLanguage(preference: unknown, info: Partial<Pick<ToolbarLanguageInfo, 'default'>> | undefined): ToolbarLanguage {
    return readToolbarLanguage(preference) ?? readToolbarLanguage(info?.default) ?? defaultToolbarLanguage;
}

/** A received language info, checked: anything unknown falls back to English with no preference */
export function readToolbarLanguageInfo(value: unknown): ToolbarLanguageInfo | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const info = value as Record<string, unknown>;
    const language = readToolbarLanguage(info.default);
    // An unknown language is English, which then comes from no setting
    const source = language && (info.source === 'project' || info.source === 'workspace') ? info.source : 'default';
    return {
        default: language ?? defaultToolbarLanguage,
        source,
        ...('preference' in info ? { preference: readToolbarLanguage(info.preference) ?? null } : {})
    };
}
