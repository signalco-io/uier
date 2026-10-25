import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import { isMeaningfulQueryKey, pageStatePolicy, type PageStatePolicy } from '@uier/toolbar/page-state';
import { getAppStore, updateDoc } from './store';
import { projectRefPk, workspacePk, type DbProject, type DbProjectRef, type ProjectAccess, type ProjectStatus } from './model';
import { memberCanAccessProject } from './workspaces';
import type { AppContext } from './context';
import { MAX_CLIENT_NAME_LENGTH, MAX_PROJECT_NAME_LENGTH, MAX_PROJECT_URLS } from './limits';
import { ensurePublicProject, PUBLIC_PROJECT_ID } from '../comments/publicProject';

const MAX_URL_LENGTH = 512;

/** 12 lowercase letters and digits: short enough to read, about 62 bits of entropy */
const newProjectId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const projectIdPattern = /^[0-9a-z]{12}$/;

export function isProjectId(value: unknown): value is string {
    return typeof value === 'string' && projectIdPattern.test(value);
}

export const projectAccessModes: readonly ProjectAccess[] = ['invited', 'guests', 'disabled'];

export const projectPageStateSchema = z.object({
    queryParameters: z.array(z.string().refine(isMeaningfulQueryKey, 'Choose route fields, not tracking, identity or credential parameters.')).max(12),
    hashRouting: z.boolean()
}).transform(pageStatePolicy);

/**
 * A site URL as typed by a person: `example.com`, `https://staging.example.com/app/`. Returns the
 * normalized URL (origin plus path, no query, hash or trailing slash) or `null` when it is not a
 * web address.
 */
export function normalizeSiteUrl(input: string) {
    const trimmed = input.trim();
    if (!trimmed || trimmed.length > MAX_URL_LENGTH)
        return null;

    let url: URL;
    try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return null;
    if (url.username || url.password || !url.hostname)
        return null;
    // A host name with a dot (example.com), localhost, or an IP address
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('['))
        return null;

    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}`;
}

const siteUrlSchema = z.string().transform((value, context) => {
    const url = normalizeSiteUrl(value);
    if (!url) {
        context.addIssue({ code: 'custom', message: `"${value.trim().slice(0, 80)}" is not a website address.` });
        return z.NEVER;
    }
    return url;
});

export const projectUrlsSchema = z.array(siteUrlSchema)
    .min(1, 'Enter the address of your site.')
    .max(MAX_PROJECT_URLS, `A project can have up to ${MAX_PROJECT_URLS} addresses.`)
    .transform(urls => [...new Set(urls)]);

export const projectNameSchema = z.string().trim()
    .min(1, 'Enter a project name.')
    .max(MAX_PROJECT_NAME_LENGTH, `Use at most ${MAX_PROJECT_NAME_LENGTH} characters.`);

/** Blank input clears the optional label; repeated whitespace is not part of a client name. */
export const projectClientNameSchema = z.string()
    .transform(value => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(MAX_CLIENT_NAME_LENGTH, `Use at most ${MAX_CLIENT_NAME_LENGTH} characters for the client name.`))
    .transform(value => value || undefined);

/** `https://www.example.com/app` -> `example.com` */
export function defaultProjectName(url: string) {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '').slice(0, MAX_PROJECT_NAME_LENGTH);
}

/** Origins the project's sites run on; the review API accepts requests only from these */
export function projectOrigins(project: Pick<DbProject, 'urls'>) {
    return [...new Set(project.urls.map(url => new URL(url).origin))];
}

/** Same-origin embeds have no cross-origin context; retain their configured API origin too. */
export function projectReviewOrigin(project: Pick<DbProject, 'urls'>, request: Request, siteOrigin?: string) {
    const origins = projectOrigins(project);
    if (siteOrigin && origins.includes(siteOrigin)) return siteOrigin;
    const requestUrl = new URL(request.url);
    let own = requestUrl.origin;
    // Next can use an internal hostname in request.url. Match the browser-facing host,
    // with the same protocol handling as review CORS, against configured origins only.
    const host = request.headers.get('host');
    if (host) {
        const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || requestUrl.protocol.slice(0, -1);
        try {
            const candidate = new URL(`${protocol}://${host}`);
            if (!candidate.username && !candidate.password) own = candidate.origin;
        } catch { /* Invalid hosts cannot add a project origin. */ }
    }
    return origins.includes(own) ? own : origins[0];
}

/** The toolbar's review link parameter (packages/toolbar/src/review.ts) */
export const TOOLBAR_CODE_PARAM = 'toolbar-code';

/** A review link: the site URL with the toolbar turned on for the project (`?toolbar-code=<code>`) */
export function reviewUrl(siteUrl: string, projectId: string) {
    const url = new URL(siteUrl);
    url.searchParams.set(TOOLBAR_CODE_PARAM, projectId);
    return url.toString();
}

export async function listProjects(workspaceId: string) {
    const projects = await getAppStore().query<DbProject>({ type: 'project', pk: workspacePk(workspaceId) });
    return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Projects of the current workspace the member may see */
export async function listVisibleProjects(context: AppContext) {
    const projects = await listProjects(context.workspace.id);
    return projects.filter(project => memberCanAccessProject(context.member, project.id));
}

export async function getProject(workspaceId: string, projectId: string) {
    if (!isProjectId(projectId))
        return null;
    return (await getAppStore().get<DbProject>(workspacePk(workspaceId), projectId))?.doc ?? null;
}

/** A project by its public code (any workspace) */
export async function findProject(projectId: string) {
    if (!isProjectId(projectId))
        return null;
    if (projectId === PUBLIC_PROJECT_ID)
        await ensurePublicProject();
    const ref = (await getAppStore().get<DbProjectRef>(projectRefPk(projectId), projectId))?.doc;
    return ref ? await getProject(ref.workspaceId, projectId) : null;
}

/** A project of the current workspace the member may see, or `null` */
export async function getVisibleProject(context: AppContext, projectId: string) {
    const project = await getProject(context.workspace.id, projectId);
    return project && memberCanAccessProject(context.member, project.id) ? project : null;
}

export async function createProject(context: AppContext, { name, urls, clientName }: { name: string; urls: string[]; clientName?: string }) {
    const store = getAppStore();
    const now = new Date().toISOString();
    for (let attempt = 0; attempt < 3; attempt++) {
        const id = newProjectId();
        // The code is unique across workspaces: claim it first
        if (!await store.create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId: context.workspace.id }))
            continue;

        const project: DbProject = {
            type: 'project',
            id,
            pk: workspacePk(context.workspace.id),
            workspaceId: context.workspace.id,
            name,
            ...(clientName ? { clientName } : {}),
            urls,
            status: 'active',
            access: 'invited',
            createdBy: context.user.id,
            createdAt: now,
            updatedAt: now
        };
        await store.create(project);
        return project;
    }
    throw new Error('Could not create a unique project code');
}

export type ProjectUpdate = Partial<{
    pageState: PageStatePolicy;
    environments: import('./environments').ProjectEnvironment[];
    name: string;
    clientName: string | undefined;
    urls: string[];
    status: ProjectStatus;
    access: ProjectAccess;
}>;

export async function updateProject(workspaceId: string, projectId: string, update: ProjectUpdate) {
    return await updateDoc<DbProject>(workspacePk(workspaceId), projectId, project => ({
        ...project,
        ...update,
        updatedAt: new Date().toISOString()
    }));
}
