import type { DbProject } from './model';
import type { OriginFilter } from '../repo/originFilter';

export type ProjectEnvironment = { origin: string; label: string; group?: string };
export type EnvironmentOption = { id: string; label: string };
export type FeedbackSource = { environment: string; label: string; origin?: string; available: boolean };

export function configuredEnvironments(project: Pick<DbProject, 'urls' | 'environments'>) {
    return [...new Set(project.urls.map(url => new URL(url).origin))].map(origin => {
        const saved = project.environments?.find(item => item.origin === origin);
        return { origin, label: saved?.label || origin, group: saved?.group };
    });
}

function environmentId(item: ProjectEnvironment) {
    return item.group ? `group:${item.group}` : `origin:${item.origin}`;
}

export function environmentOptions(project: Pick<DbProject, 'urls' | 'environments'>): EnvironmentOption[] {
    const options = new Map<string, string>();
    for (const item of configuredEnvironments(project))
        options.set(environmentId(item), item.group ? `${item.group} (shared aliases)` : item.label);
    return [...options].map(([id, label]) => ({ id, label }));
}

export function environmentSelection(project: DbProject, input?: string | null, origin?: string) {
    if (input === 'all' || input === 'unknown' || input === 'removed') return input;
    const options = environmentOptions(project);
    if (options.some(option => option.id === input)) return input!;
    const current = configuredEnvironments(project).find(item => item.origin === origin);
    return current ? environmentId(current) : options[0]?.id ?? 'unknown';
}

export function environmentFilter(project: DbProject, selection: string): OriginFilter | undefined {
    const configured = configuredEnvironments(project);
    if (selection === 'all') return undefined;
    if (selection === 'unknown') return { origins: [], unknown: true };
    if (selection === 'removed') return { origins: configured.map(item => item.origin), exclude: true };
    return { origins: configured.filter(item => environmentId(item) === selection).map(item => item.origin) };
}

/** Never infer or rewrite an older comment's source from today's main address. */
export function feedbackSource(project: DbProject, origin?: string): FeedbackSource {
    if (!origin) return { environment: 'unknown', label: 'Source not recorded', available: false };
    const item = configuredEnvironments(project).find(item => item.origin === origin);
    if (item) return { environment: environmentId(item), label: item.label, origin, available: true };
    // Old/corrupt records must never become executable links.
    let safe: string | undefined;
    try {
        const url = new URL(origin);
        if (['http:', 'https:'].includes(url.protocol) && url.origin === origin) safe = origin;
    } catch { /* Source remains unavailable. */ }
    return { environment: 'removed', label: 'Removed address', origin: safe, available: false };
}
