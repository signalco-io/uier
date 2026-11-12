import type { DbProject, DbWorkspace } from './model';
import { projectThreadLabelsSchema, threadLabelsSchema } from './threadLabelSchema';
import { getWorkspace } from './workspaces';

export function workspaceThreadLabels(workspace: Pick<DbWorkspace, 'threadLabels'> | null | undefined) {
    const parsed = threadLabelsSchema.safeParse(workspace?.threadLabels);
    return parsed.success ? parsed.data : [];
}
/** The same live workspace/default-or-replacement model as configurable statuses. */
export function effectiveThreadLabels(workspace: Pick<DbWorkspace, 'threadLabels'> | null | undefined, project: Pick<DbProject, 'threadLabels'>) {
    const parsed = projectThreadLabelsSchema.safeParse(project.threadLabels);
    return parsed.success ? parsed.data.value : workspaceThreadLabels(workspace);
}
export async function loadThreadLabels(project: DbProject) {
    return effectiveThreadLabels(await getWorkspace(project.workspaceId), project);
}
