import { apiErrors } from '../comments/http';
import { mcpProject, type McpIdentity } from '../mcp/credentials';
import { proofProject, type ProofAuthorization } from './access';
import { requireProofMemberById } from './sourceAccess';
import { proofAsset } from './assets';
import { proofUploadTypes } from './model';
import { proofNotFound, proofStore } from './store';

// Resolve the grant again before each upload mutation or readback. The MCP bearer never becomes an app cookie.
export function agentProofAuthorizer(identity: McpIdentity, projectId: string, assetId?: string, reauthenticate?: () => Promise<McpIdentity>) {
    return async (): Promise<ProofAuthorization> => {
        const fresh = reauthenticate ? await reauthenticate() : identity;
        if (fresh.proofAssetIds && (!assetId || !fresh.proofAssetIds.includes(assetId))) throw proofNotFound();
        const { project: granted, user } = await mcpProject(fresh, projectId, 'proofs:upload');
        const project = await proofProject(projectId);
        if (project.workspaceId !== granted.workspaceId) throw proofNotFound();
        const actor = await requireProofMemberById(project, user.id);
        const proofs = proofStore(project.id);
        const [guard, saved] = await Promise.all([proofs.guard(), assetId ? proofs.asset(assetId) : null]);
        const asset = saved?.doc ?? null;
        if (guard?.doc.deleted || (assetId && (!asset || asset.deleted))) throw proofNotFound();
        return { project, actor, asset, version: null };
    };
}

export async function agentProofFiles(identity: McpIdentity, projectId: string, afterId?: string) {
    const canUpload = identity.scopes.includes('proofs:upload');
    const { project } = await mcpProject(identity, projectId, canUpload ? 'proofs:upload' : 'proofs:read');
    const live = await proofProject(projectId);
    if (live.workspaceId !== project.workspaceId) throw proofNotFound();
    const proofs = proofStore(project.id);
    const guard = await proofs.guard();
    if (guard?.doc.deleted) throw proofNotFound();
    const list = identity.proofAssetIds
        ? (await Promise.all([...identity.proofAssetIds].sort().filter(id => !afterId || id > afterId).map(id => proofs.asset(id))))
            .flatMap(saved => saved ? [saved.doc] : [])
        : await proofs.store.query<Awaited<ReturnType<typeof proofs.assets>>[number]>({ type: 'proof-asset', pk: proofs.pk,
            limit: 51, orderBy: 'id', afterId });
    const formats = canUpload ? guard?.doc.formats ?? ['image'] : [];
    return { items: list.slice(0, 50).filter(item => !item.deleted && (canUpload || item.currentVersionId)).map(proofAsset),
        next: list.length > 50 ? list[49]?.id : null, contentTypes: formats.flatMap(format => proofUploadTypes[format]) };
}

export function assertAgentUploadType(contentType: string) {
    if (!Object.values(proofUploadTypes).some(types => types.includes(contentType)))
        throw apiErrors.invalidRequest('Choose a supported file type. Figma frames require the source-authorized member import.');
}
