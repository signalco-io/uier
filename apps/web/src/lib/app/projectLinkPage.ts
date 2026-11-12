import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AppContext } from './context';
import { getVisibleProject } from './projects';
import { projectLinkAccounts, projectLinkSwitchPath } from './projectLinkAccounts';

export async function offerProjectLinkSwitch() {
    const next = (await headers()).get('x-uier-project-link');
    if (next && (await projectLinkAccounts(await cookies(), next)).length)
        redirect(projectLinkSwitchPath(next));
}

export async function getVisibleProjectForPage(context: AppContext, projectId: string) {
    const project = await getVisibleProject(context, projectId);
    if (!project) await offerProjectLinkSwitch();
    return project;
}
