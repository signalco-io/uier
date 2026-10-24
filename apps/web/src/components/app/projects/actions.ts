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
    projectNameSchema,
    projectUrlsSchema,
    updateProject,
    type ProjectUpdate
} from '../../../lib/app/projects';
import type { ProjectAccess, ProjectStatus } from '../../../lib/app/model';

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
        return await createProject(context, { name, urls });
    });
    if (!result?.ok)
        return result;

    revalidatePath('/app', 'layout');
    redirect(KnownPageLinks.projectInstall(result.data.id));
}

export async function updateProjectNameAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        await saveProject(formData.get('projectId'), { name: projectNameSchema.parse(formData.get('name') ?? '') });
    }, 'The name is saved.');
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
        await saveProject(projectId, { status: status === 'done' ? 'done' : 'active' });
    });
}
