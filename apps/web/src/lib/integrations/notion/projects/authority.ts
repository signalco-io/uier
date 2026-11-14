import { memberId, workspacePk, type DbMember, type DbWorkspace } from '../../../app/model';
import { getAppStore, type AppMutation, type AppStore } from '../../../app/store';
import { assertMutableWorkspace } from '../../../comments/publicProjectPolicy';
import { IntegrationAccessError } from '../../connection';

/** The workspace and member ETags fence commits against removal, demotion and workspace changes. */
export async function notionWorkspaceAuthority(workspaceId: string, userId: string, store: AppStore = getAppStore()) {
    assertMutableWorkspace(workspaceId);
    const workspace = await store.get<DbWorkspace>(workspacePk(workspaceId), workspaceId);
    const member = await store.get<DbMember>(workspacePk(workspaceId), memberId(userId));
    if (workspace?.doc.type !== 'workspace' || workspace.doc.id !== workspaceId || member?.doc.type !== 'member'
        || member.doc.workspaceId !== workspaceId || member.doc.userId !== userId || member.doc.role !== 'admin') throw new IntegrationAccessError();
    return [workspace, member].map(value => ({ kind: 'replace', doc: value.doc, etag: value.etag } satisfies AppMutation));
}
