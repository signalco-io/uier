import type { DbProject, DbWorkspace } from '../app/model';

/** A project's choice: the workspace's setting, or its own */
export const projectAiTitleModes = ['workspace', 'on', 'off'] as const;
export type ProjectAiTitleMode = typeof projectAiTitleModes[number];

/** AI thread titles in a workspace: on unless an admin turned them off (missing means on) */
export function workspaceAiTitles(workspace: Pick<DbWorkspace, 'aiTitles'> | null | undefined) {
    return workspace?.aiTitles !== false;
}

/** What a project chose; anything but `on` or `off` (missing, older documents) follows the workspace */
export function projectAiTitleMode(project: Pick<DbProject, 'aiTitles'>): ProjectAiTitleMode {
    return project.aiTitles === 'on' || project.aiTitles === 'off' ? project.aiTitles : 'workspace';
}

/**
 * Whether a project's threads get AI titles: its own setting, else its workspace's. Off means none
 * are made and stored ones are not shown (the first line shows, as before).
 */
export function aiTitlesEnabled(workspace: Pick<DbWorkspace, 'aiTitles'> | null | undefined, project: Pick<DbProject, 'aiTitles'>) {
    const mode = projectAiTitleMode(project);
    return mode === 'workspace' ? workspaceAiTitles(workspace) : mode === 'on';
}
