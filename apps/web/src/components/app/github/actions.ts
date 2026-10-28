'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { KnownPageLinks } from '@/src/knownPages';
import { actionResult, UserFacingError, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { IntegrationAccessError, requireIntegrationAdmin, setIntegrationEnabled } from '@/src/lib/integrations/connection';
import { startIntegrationBackfill } from '@/src/lib/integrations/backfill';
import { disconnectGitHub, getGitHubSettings, GitHubError, listGitHubRepositories, saveGitHubRepository } from '@/src/lib/integrations/github';

type Settings = Awaited<ReturnType<typeof getGitHubSettings>>;
type Repositories = Awaited<ReturnType<typeof listGitHubRepositories>>;

/** Provider responses and credentials never become action errors or client data. */
async function githubResult<T>(run: () => Promise<T>, message?: string) {
    return actionResult(async () => {
        try { return await run(); }
        catch (error) {
            if (error instanceof IntegrationAccessError) throw new UserFacingError('Only a current workspace admin can manage GitHub.');
            if (error instanceof GitHubError) {
                const messages: Record<string, string> = {
                    admin_required: 'Only a current workspace admin can manage GitHub.',
                    setup_expired: 'This GitHub authorization has expired. Connect GitHub again.',
                    setup_stale: 'The GitHub connection changed. Reload settings and connect again.',
                    rate_limited: 'GitHub is waiting for its request limit to reset. Try again later.',
                    unauthorized: 'Reconnect GitHub, then try again.',
                    repository_not_authorized: 'Choose an available repository you administer and confirm public access when needed.',
                    installation_not_authorized: 'This GitHub installation is unavailable to your account. Connect again.',
                    installation_unavailable: 'This GitHub installation is unavailable. Check its access in GitHub and reconnect.',
                    not_configured: 'GitHub is unavailable on this deployment.',
                    connection_changed: 'The GitHub connection changed. Reload settings and try again.',
                    installation_changed: 'The GitHub installation changed. Connect again.'
                };
                throw new UserFacingError(messages[error.code] ?? 'GitHub could not complete this change. Reconnect or try again.');
            }
            throw error;
        }
    }, message);
}

async function admin(form: FormData) {
    const context = await appContextOrThrow({ admin: true });
    const projectId = z.string().min(1).max(200).parse(form.get('projectId'));
    const project = await requireIntegrationAdmin(context, projectId);
    return { context, project, actor: { userId: context.user.id, workspaceId: project.workspaceId, projectId: project.id } };
}
const receipt = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Connect GitHub again to choose a repository.');

export async function loadGitHubRepositoriesAction(_: ActionState<Repositories>, form: FormData) {
    return githubResult(async () => {
        const { actor } = await admin(form);
        return listGitHubRepositories({ ...actor, setupReceipt: receipt.parse(form.get('setupReceipt')) });
    });
}

export async function saveGitHubRepositoryAction(_: ActionState<Settings>, form: FormData) {
    return githubResult(async () => {
        const { actor, project, context } = await admin(form);
        if ((await getGitHubSettings(project, context.user.id)).connection && form.get('confirmSwitch') !== 'true')
            throw new UserFacingError('Confirm that existing GitHub copies will remain before saving.');
        const input = z.object({ setupReceipt: receipt, repositoryId: z.string().regex(/^[1-9][0-9]{0,18}$/, 'Choose an available repository.'), confirmPublic: z.boolean() })
            .parse({ setupReceipt: form.get('setupReceipt'), repositoryId: form.get('repositoryId'), confirmPublic: form.get('confirmPublic') === 'true' });
        await saveGitHubRepository({ ...actor, ...input });
        revalidatePath(KnownPageLinks.projectSettings(project.id));
        return getGitHubSettings(project, context.user.id);
    }, 'GitHub is connected. Sync is on for new shared feedback.');
}

export async function manageGitHubAction(_: ActionState<{ message: string }>, form: FormData) {
    return githubResult(async () => {
        const { actor, project, context } = await admin(form);
        const operation = z.enum(['enable', 'disable', 'disconnect', 'backfill']).parse(form.get('operation'));
        let message: string;
        if (operation === 'disconnect') {
            await disconnectGitHub(actor);
            message = 'GitHub is disconnected from this project.';
        } else if (operation === 'backfill') {
            const result = await startIntegrationBackfill(project, 'github', context.user.id);
            message = result.total ? `A backfill of ${result.total} selected threads is queued. Delivery continues in the background.`
                : 'There are no eligible threads to backfill.';
        } else {
            await setIntegrationEnabled(project, 'github', context.user.id, operation === 'enable');
            message = operation === 'enable' ? 'GitHub sync is on.' : 'GitHub sync is off.';
        }
        revalidatePath(KnownPageLinks.projectSettings(project.id));
        return { message };
    });
}
