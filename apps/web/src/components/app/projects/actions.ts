'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { KnownPageLinks } from '../../../knownPages';
import { actionResult, UserFacingError, type ActionState } from '../../../lib/app/actionResult';
import { appContextOrThrow } from '../../../lib/app/context';
import {
    createProject,
    defaultProjectName,
    getProject,
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
import { configuredEnvironments } from '../../../lib/app/environments';
import { parseActionInput } from '../../../lib/app/validation';
import { projectStatusActionSchema } from './actionSchemas';

const environmentSchema = z.array(z.object({
    origin: z.string().max(512),
    label: z.string().trim().max(60),
    group: z.string().trim().max(60).regex(/^[\p{L}\p{N} ._-]*$/u, 'Use letters, numbers, spaces, dots, dashes or underscores for an alias group.')
})).max(20);

export async function updateProjectEnvironmentsAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return actionResult(async () => {
        const { context, project } = await adminProject(formData.get('projectId'));
        const input = environmentSchema.parse(JSON.parse(String(formData.get('environments') ?? '[]')));
        const origins = configuredEnvironments(project).map(item => item.origin);
        if (input.length !== origins.length || new Set(input.map(item => item.origin)).size !== origins.length || input.some(item => !origins.includes(item.origin)))
            throw new UserFacingError('The site addresses changed. Reload settings before saving environments.');
        await updateProject(context.workspace.id, project.id, { environments: input.map(item => ({ ...item, label: item.label || item.origin, group: item.group || undefined })) });
        revalidatePath('/app', 'layout');
    }, 'The environments are saved.');
}

/** Every non-empty `url` field of the form */
function formUrls(formData: FormData) {
    return formData.getAll('url')
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

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

export async function updateProjectNameAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        await saveProject(formData.get('projectId'), { name: projectNameSchema.parse(formData.get('name') ?? '') });
    }, 'The name is saved.');
}

export async function updateProjectClientNameAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        await saveProject(formData.get('projectId'), { clientName: projectClientNameSchema.parse(formData.get('clientName') ?? '') });
    }, 'The client name is saved.');
}

export async function updateProjectBriefAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        await saveProject(formData.get('projectId'), { brief: projectBriefSchema.parse(formData.get('brief') ?? '') });
    }, 'The review brief is saved.');
}

export async function updateProjectUrlsAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        await saveProject(formData.get('projectId'), { urls: projectUrlsSchema.parse(formUrls(formData)) });
    }, 'The addresses are saved.');
}

const accessSchema = z.enum(projectAccessModes as [ProjectAccess, ...ProjectAccess[]], 'Choose who can comment.');

export async function updateProjectAccessAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        await saveProject(formData.get('projectId'), { access: accessSchema.parse(formData.get('access')) });
    }, 'Saved. The toolbar follows the new setting on the next page load.');
}

export async function setProjectStatusAction(projectId: string, status: ProjectStatus): Promise<ActionState> {
    return await actionResult(async () => {
        const input = parseActionInput(projectStatusActionSchema, { projectId, status });
        await saveProject(input.projectId, { status: input.status });
    });
}

export async function updateProjectPageStateAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const pageState = projectPageStateSchema.parse({
            queryParameters: String(formData.get('queryParameters') ?? '').split(/[,\s]+/).filter(Boolean),
            hashRouting: formData.get('hashRouting') === 'true'
        });
        await saveProject(formData.get('projectId'), { pageState });
    }, 'Saved. New reviews use these page fields on the next page load.');
}

export async function updateProjectEmailExcerptsAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const enabled = z.enum(['true', 'false']).parse(formData.get('emailCommentExcerpts')) === 'true';
        await saveProject(formData.get('projectId'), { emailCommentExcerpts: enabled });
    }, 'The email setting is saved.');
}
