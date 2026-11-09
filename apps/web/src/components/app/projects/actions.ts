'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { KnownPageLinks } from '../../../knownPages';
import { actionResult, UserFacingError, type ActionState } from '../../../lib/app/actionResult';
import { appContextOrThrow } from '../../../lib/app/context';
import { pageStatePolicy } from '@uier/toolbar/page-state';
import {
    createProject,
    defaultProjectName,
    getProject,
    getVisibleProject,
    normalizeSiteUrl,
    projectAccessModes,
    projectClientNameSchema,
    projectBriefSchema,
    projectNameSchema,
    projectPageStateSchema,
    projectUrlsSchema,
    updateProject,
    type ProjectUpdate
} from '../../../lib/app/projects';
import type { ProjectAccess, ProjectStatus } from '../../../lib/app/model';
import { loadClients, projectClient, setProjectClient } from '../../../lib/app/clients';
import { MAX_PROJECT_URLS } from '../../../lib/app/limits';
import { parseActionInput } from '../../../lib/app/validation';
import { appActor } from '../../../lib/app/projectComments';
import { assertMutableProject } from '../../../lib/comments/publicProjectPolicy';
import { ApiError } from '../../../lib/comments/http';
import { setProjectMuted } from '../../../lib/notifications/preferences';
import { deleteProjectActionSchema, projectEmailsActionSchema, projectStatusActionSchema, transferProjectActionSchema } from './actionSchemas';
import { deleteProject } from '../../../lib/app/projectDeletion';
import { transferProject } from '../../../lib/app/projectTransfer';
import { selectWorkspace } from '../../../lib/app/workspaceCookie';
import { projectAiTitleMode, projectAiTitleModes } from '../../../lib/titles/settings';

/** One origin's environment: a label, and the group of addresses it shares feedback with */
const environmentSchema = z.array(z.object({
    origin: z.string().max(512),
    label: z.string().trim().max(60),
    group: z.string().trim().max(60).regex(/^[\p{L}\p{N} ._-]*$/u, 'Use letters, numbers, spaces, dots, dashes or underscores for a shared group.')
})).max(20);

/** The rows of the site addresses table: the address as typed, its label and its shared group */
const siteRowsSchema = z.array(z.object({
    url: z.string().max(4096),
    label: z.string().max(4096),
    group: z.string().max(4096)
})).max(MAX_PROJECT_URLS * 2);

/** A project of the current workspace, for its admins */
async function adminProject(projectId: unknown) {
    const context = await appContextOrThrow({ admin: true });
    const project = typeof projectId === 'string' ? await getProject(context.workspace.id, projectId) : null;
    if (!project)
        throw new UserFacingError('This project no longer exists.');
    return { context, project };
}

async function saveProject(projectId: unknown, update: ProjectUpdate) {
    const { context, project } = await adminProject(projectId);
    await updateProject(context.workspace.id, project.id, update);
    revalidatePath('/app', 'layout');
}

/** Every non-empty `url` field of the form */
function formUrls(formData: FormData) {
    return formData.getAll('url')
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

export async function createProjectAction(_: ActionState, formData: FormData): Promise<ActionState> {
    const result = await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        const urls = projectUrlsSchema.parse(formUrls(formData));
        const nameInput = String(formData.get('name') ?? '').trim();
        const name = projectNameSchema.parse(nameInput || defaultProjectName(urls[0]!));
        const clientName = projectClientNameSchema.parse(formData.get('clientName') ?? '');
        return await createProject(context, { name, urls, clientName });
    });
    if (!result?.ok)
        return result;

    revalidatePath('/app', 'layout');
    redirect(KnownPageLinks.projectInstall(result.data.id, { onboarding: true }));
}

/** General: the name, the client and AI thread titles, one save. All are checked before any is written. */
export async function updateProjectGeneralAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const name = projectNameSchema.parse(formData.get('name') ?? '');
        const clientName = projectClientNameSchema.parse(formData.get('clientName') ?? '');
        // Older forms send no choice: keep the project's
        const aiTitles = formData.has('aiTitles') ? aiTitlesSchema.parse(formData.get('aiTitles')) : undefined;
        const { context, project } = await adminProject(formData.get('projectId'));
        assertMutableProject(context.workspace.id, project.id);
        const update: ProjectUpdate = {};
        if (name !== project.name)
            update.name = name;
        if (aiTitles !== undefined && aiTitles !== projectAiTitleMode(project))
            update.aiTitles = aiTitles === 'workspace' ? undefined : aiTitles;
        if (Object.keys(update).length > 0)
            await updateProject(context.workspace.id, project.id, update);
        if (clientName !== projectClient(project, await loadClients(context.workspace.id))?.name)
            await setProjectClient(context, project.id, clientName);
        revalidatePath('/app', 'layout');
    }, 'Saved.');
}

const accessSchema = z.enum(projectAccessModes as [ProjectAccess, ...ProjectAccess[]], 'Choose who can comment.');
const aiTitlesSchema = z.enum(projectAiTitleModes, 'Choose whether threads get titles.');

/** Review: who can comment, the brief and the page state, one save; only what changed is written */
export async function updateProjectReviewAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const access = accessSchema.parse(formData.get('access'));
        const brief = projectBriefSchema.parse(formData.get('brief') ?? '');
        const pageState = projectPageStateSchema.parse({
            queryParameters: String(formData.get('queryParameters') ?? '').split(/[,\s]+/).filter(Boolean),
            hashRouting: formData.get('hashRouting') === 'true'
        });
        const { context, project } = await adminProject(formData.get('projectId'));
        assertMutableProject(context.workspace.id, project.id);
        const update: ProjectUpdate = {};
        if (access !== project.access)
            update.access = access;
        if (brief !== (project.brief || undefined))
            update.brief = brief;
        if (JSON.stringify(pageState) !== JSON.stringify(pageStatePolicy(project.pageState)))
            update.pageState = pageState;
        if (Object.keys(update).length > 0)
            await updateProject(context.workspace.id, project.id, update);
        revalidatePath('/app', 'layout');
    }, 'Saved. The toolbar uses the new settings on its next page load.');
}

/**
 * Environments: the site addresses with each origin's label and the addresses it shares feedback
 * with, one save. Addresses on the same origin share its label and group (the first row's).
 */
export async function updateProjectSitesAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const rows = siteRowsSchema.parse(JSON.parse(String(formData.get('sites') ?? '[]')))
            .filter(row => row.url.trim().length > 0);
        const urls = projectUrlsSchema.parse(rows.map(row => row.url));
        const byOrigin = new Map<string, { origin: string; label: string; group: string }>();
        for (const row of rows) {
            const origin = new URL(normalizeSiteUrl(row.url)!).origin;
            if (!byOrigin.has(origin))
                byOrigin.set(origin, { origin, label: row.label, group: row.group });
        }
        const environments = environmentSchema.parse([...byOrigin.values()]);
        await saveProject(formData.get('projectId'), {
            urls,
            environments: environments.map(item => ({ ...item, label: item.label || item.origin, group: item.group || undefined }))
        });
    }, 'Saved.');
}

export async function setProjectStatusAction(projectId: string, status: ProjectStatus): Promise<ActionState> {
    return await actionResult(async () => {
        const input = parseActionInput(projectStatusActionSchema, { projectId, status });
        await saveProject(input.projectId, { status: input.status });
    });
}

/** Admins only; the client goes to the projects list after a success. */
export async function deleteProjectAction(projectId: string, confirmation: string): Promise<ActionState> {
    const result = await actionResult(async () => {
        const input = parseActionInput(deleteProjectActionSchema, { projectId, confirmation });
        await deleteProject(await appContextOrThrow({ admin: true }), input.projectId, input.confirmation);
    });
    if (result?.ok)
        revalidatePath('/app', 'layout');
    return result;
}

/**
 * Admins of both workspaces. After a success the app opens the new workspace, where the client goes
 * to the project: its id and links stay the same.
 */
export async function transferProjectAction(projectId: string, workspaceId: string, confirmation: string): Promise<ActionState> {
    const result = await actionResult(async () => {
        const input = parseActionInput(transferProjectActionSchema, { projectId, workspaceId, confirmation });
        await transferProject(await appContextOrThrow({ admin: true }), input.projectId, input.workspaceId, input.confirmation);
        await selectWorkspace(input.workspaceId);
    });
    if (result?.ok)
        revalidatePath('/app', 'layout');
    return result;
}

export async function updateProjectEmailExcerptsAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const enabled = z.enum(['true', 'false']).parse(formData.get('emailCommentExcerpts')) === 'true';
        await saveProject(formData.get('projectId'), { emailCommentExcerpts: enabled });
    }, 'The email setting is saved.');
}

/** A person's own emails from a project (everyone who can see it): muting stops all of them */
export async function setProjectEmailsMutedAction(projectId: string, muted: boolean): Promise<ActionState> {
    return await actionResult(async () => {
        const input = parseActionInput(projectEmailsActionSchema, { projectId, muted });
        const context = await appContextOrThrow();
        const project = await getVisibleProject(context, input.projectId);
        if (!project)
            throw new UserFacingError('This project no longer exists.');
        try {
            await setProjectMuted(project, appActor(context), input.muted);
        } catch (error) {
            if (error instanceof ApiError)
                throw new UserFacingError(error.message);
            throw error;
        }
        revalidatePath('/app', 'layout');
    });
}
