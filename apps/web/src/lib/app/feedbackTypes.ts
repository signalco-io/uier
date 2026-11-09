import { defaultFeedbackTypes, isFeedbackTypeId, type FeedbackType } from '@uier/toolbar/feedback-types';
import type { DbProject, DbWorkspace } from './model';
import { resolveProjectSetting } from './inheritedSettings';
import { getWorkspace } from './workspaces';
import { apiErrors } from '../comments/http';

export function workspaceFeedbackTypes(workspace: Pick<DbWorkspace, 'feedbackTypes'> | null | undefined): FeedbackType[] {
    return workspace?.feedbackTypes ?? defaultFeedbackTypes.map(type => ({ ...type }));
}
export function effectiveFeedbackTypes(workspace: Pick<DbWorkspace, 'feedbackTypes'> | null | undefined, project: Pick<DbProject, 'feedbackTypes'>): FeedbackType[] {
    return resolveProjectSetting(workspaceFeedbackTypes(workspace), project.feedbackTypes, (_workspace, own) => own);
}
export async function loadFeedbackTypes(project: DbProject) {
    if (project.feedbackTypes?.mode === 'replace') return effectiveFeedbackTypes(undefined, project);
    return effectiveFeedbackTypes(await getWorkspace(project.workspaceId), project);
}

/** Only currently enabled, project-scoped types may create new page feedback. Existing threads never resolve through settings. */
export async function feedbackTypeForSubmission(project: DbProject | undefined, kind: string) {
    if (!isFeedbackTypeId(kind)) return undefined;
    const types = project ? await loadFeedbackTypes(project) : defaultFeedbackTypes;
    const type = types.find(type => type.id === kind && type.enabled);
    if (!type) throw apiErrors.invalidRequest('This feedback type is no longer available. Reload the page and choose another type.');
    return kind.startsWith('custom_') ? { id: type.id, label: type.label, icon: type.icon } : undefined;
}
