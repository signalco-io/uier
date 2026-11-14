import type { AppDoc } from '../../../app/model';
import type { NotionConnection, NotionSchema } from '../model';

// OAuth and grant encryption keep their existing project-bound shape with a distinct workspace scope.
export const urlPropertyTypes = ['url', 'rich_text', 'title', 'multi_select'];
export const statusPropertyTypes = ['status', 'select', 'rich_text', 'checkbox'];
export const NOTION_PROJECTS_SCOPE = 'workspace-projects';
export const notionProjectsConnectionId = 'notion_projects';
export const notionProjectsGrantId = 'notion_projects_grant';
export type NotionProjectMapping = { urls: string[]; name?: string; status: string; done: string[] };
export type NotionProjectsConnection = Omit<NotionConnection, 'type' | 'config'> & {
    type: 'notion-projects-connection';
    config: { notionWorkspaceId?: string; notionWorkspaceName?: string; dataSourceId?: string; databaseId?: string;
        dataSourceName?: string; schema?: NotionSchema; mapping?: NotionProjectMapping };
    nextAttemptAt: string;
    cursor?: string;
    lease?: { id: string; until: string };
    failures?: number;
    skippedRows?: number;
};
/** Identifier-only receipt. Retained after manual override, deletion and transfer to prevent recreation. */
export type NotionProjectRow = AppDoc & { type: 'notion-project-row'; workspaceId: string; connectionId: string;
    dataSourceId: string; rowId: string; projectId: string };
export type NotionProjectsView = Pick<NotionProjectsConnection, 'enabled' | 'status' | 'statusCode' | 'lastSyncedAt' | 'skippedRows'> & {
    configured: boolean; connected: boolean; config: NotionProjectsConnection['config'];
};
