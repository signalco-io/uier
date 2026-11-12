import type { DbProject, DbWorkspace } from './model';
import { defaultStatusWorkflow } from './statusWorkflow';
import { statusWorkflowSchema, projectStatusWorkflowSchema } from './statusWorkflowSchema';
import { getWorkspace } from './workspaces';
export function workspaceStatusWorkflow(workspace: Pick<DbWorkspace, 'statusWorkflow'> | null | undefined) {
    const parsed = statusWorkflowSchema.safeParse(workspace?.statusWorkflow);
    return parsed.success ? parsed.data : defaultStatusWorkflow;
}
export function effectiveStatusWorkflow(workspace: Pick<DbWorkspace, 'statusWorkflow'> | null | undefined, project: Pick<DbProject, 'statusWorkflow' | 'verificationEnabled'>) {
    const parsed = projectStatusWorkflowSchema.safeParse(project.statusWorkflow);
    return { ...(parsed.success ? parsed.data.value : workspaceStatusWorkflow(workspace)), verificationEnabled: project.verificationEnabled === true };
}
export async function loadStatusWorkflow(project: DbProject) {
    return effectiveStatusWorkflow(await getWorkspace(project.workspaceId), project);
}
