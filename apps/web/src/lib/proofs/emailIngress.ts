import { randomBytes, timingSafeEqual } from 'node:crypto';
import { apiErrors } from '../comments/http';
import { sha256Hex } from '../app/tokens';
import { isProjectId } from '../app/projects';
import { getAppStore } from '../app/store';
import { authorizeProof, proofProject, type ProofAuthorization } from './access';
import { requireProofMemberById } from './sourceAccess';
import { readProofBytes } from './sourceBytes';
import { mutateProof, proofConflict, proofEpoch, proofNotFound, proofStore, proofPk, type DbProofAsset, type DbProofVersion } from './store';
import { beginAuthorizedProofUpload, finalizeAuthorizedProofUpload, stageAuthorizedProofSource } from './uploads';

export const maxInboundProofBytes = 4 * 1024 * 1024;
const tokenPattern = /^[a-f0-9]{40}$/;

function configuration() {
    const alias = process.env.UIER_PROOF_EMAIL_ALIAS?.trim().toLowerCase();
    const secret = process.env.UIER_PROOF_EMAIL_SECRET?.trim();
    if (!alias || !secret || secret.length < 32 || alias.length > 90
        || !/^[a-z0-9][a-z0-9._-]{0,22}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(alias)
        || /^(?:contact|security|privacy)@uier\.io$/.test(alias)) return;
    const [local, domain] = alias.split('@') as [string, string];
    return { alias, local, domain, secret };
}

export async function proofEmailAddress(request: Request, projectId: string, assetId: string, action?: 'rotate' | 'disable') {
    const { project, asset } = await authorizeProof(request, { projectId, assetId }, 'manage');
    if (!asset) throw proofNotFound();
    const configured = configuration();
    if (!action) {
        const epoch = proofEpoch((await proofStore(project.id).guard())?.doc);
        return { available: Boolean(configured), active: Boolean(configured && asset.emailIngressHash && asset.emailIngress?.epoch === epoch && asset.emailIngress.alias === configured.alias) };
    }
    if (action === 'rotate' && !configured) throw apiErrors.unavailable('Test email delivery requires a configured ingress alias and secret.');
    const token = randomBytes(20).toString('hex');
    return mutateProof<{ available: boolean; active: boolean; address?: string }>(project, async (proofs, guard) => {
        const { actor } = await authorizeProof(request, { projectId, assetId }, 'manage');
        const saved = await proofs.asset(assetId);
        if (!saved || actor.kind !== 'member') throw proofNotFound();
        if (action === 'rotate' && !(guard.formats ?? ['image']).includes('email')) throw apiErrors.forbidden('Email uploads are paused for this project.');
        const { emailIngress: _, emailIngressHash: _hash, ...asset } = saved.doc;
        const enabled = action === 'rotate';
        const doc = enabled ? { ...asset, emailIngressHash: sha256Hex(token), emailIngress: { ownerId: actor.userId, alias: configured!.alias,
            epoch: proofEpoch(guard), createdAt: new Date().toISOString() } } : asset;
        return { value: { available: Boolean(configured), active: enabled,
            ...(enabled && configured ? { address: `${configured.local}+${token}@${configured.domain}` } : {}) },
        operations: [{ kind: 'replace', doc, etag: saved.etag }] };
    });
}

function verifyIngress(request: Request) {
    const config = configuration();
    if (!config) throw apiErrors.unavailable('Test email delivery is not configured.');
    const supplied = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${config.secret}`;
    if (supplied.length > 512 || !timingSafeEqual(Buffer.from(sha256Hex(supplied)), Buffer.from(sha256Hex(expected)))) throw proofNotFound();
    const envelopeTo = request.headers.get('x-uier-envelope-to') ?? '';
    const [local, domain, extra] = envelopeTo.toLowerCase().split('@');
    const [alias, token, suffix] = (local ?? '').split('+');
    if (alias !== config.local || domain !== config.domain || extra !== undefined || suffix !== undefined || !tokenPattern.test(token ?? ''))
        throw proofNotFound();
    return { addressHash: sha256Hex(token!), alias: config.alias };
}

function digestMessage(bytes: Buffer) {
    const data = bytes.toString('latin1');
    const split = /\r?\n\r?\n/.exec(data);
    const headers = split && split.index <= 128 * 1024 ? data.slice(0, split.index) : '';
    const stable = headers.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)
        .filter(line => !/^(received|return-path|authentication-results|arc-(?:seal|message-signature|authentication-results)|delivered-to|x-received):/i.test(line));
    const messageId = stable.find(line => /^message-id:/i.test(line))?.slice(11).trim();
    const digest = sha256Hex(stable.join('\n') + (split ? data.slice(split.index) : data));
    return { digest, stableId: messageId || digest };
}

export async function receiveProofEmail(request: Request) {
    const { addressHash, alias } = verifyIngress(request);
    // The token carries no project or asset identifiers. The app's indexed equality lookup is available only to the relay.
    const matches = await getAppStore().query<DbProofAsset>({ type: 'proof-asset', where: { emailIngressHash: addressHash }, limit: 2 });
    const located = matches.length === 1 ? matches[0] : undefined;
    const projectId = located?.pk.slice('proof:'.length);
    if (!located || !projectId || !isProjectId(projectId) || located.pk !== proofPk(projectId) || located.deleted) throw proofNotFound();
    const assetId = located.id;
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'message/rfc822')
        throw apiErrors.invalidRequest('Send the raw RFC 822 message.');
    const authorize = async (): Promise<ProofAuthorization> => {
        const project = await proofProject(projectId);
        const proofs = proofStore(project.id);
        const [asset, guard] = await Promise.all([proofs.asset(assetId), proofs.guard()]);
        const ingress = asset?.doc.emailIngress;
        if (!asset || asset.doc.deleted || !guard || guard.doc.deleted || !ingress
            || ingress.alias !== alias || ingress.epoch !== proofEpoch(guard.doc) || asset.doc.emailIngressHash !== addressHash) throw proofNotFound();
        const actor = await requireProofMemberById(project, ingress.ownerId);
        return { project, actor, asset: asset.doc, version: null };
    };
    const { project, asset } = await authorize();
    if (!asset) throw proofNotFound();
    if (Number(request.headers.get('content-length')) > maxInboundProofBytes) throw apiErrors.tooLarge(maxInboundProofBytes);
    const bytes = await readProofBytes(request.body, maxInboundProofBytes);
    const { digest, stableId } = digestMessage(bytes);
    const key = sha256Hex(JSON.stringify([addressHash, stableId]));
    const proofs = proofStore(project.id);
    const records = await proofs.store.query<DbProofVersion>({ type: 'proof-version', pk: proofs.pk,
        where: { assetId, emailDeliveryKey: key }, limit: 24 });
    if (records.some(item => item.emailDelivery?.sourceDigest !== digest)) throw proofConflict('That message ID was already delivered with different content.');
    const previous = records.find(item => item.status === 'published' || (item.status === 'failed' && item.failureKind === 'input'))
        ?? records.find(item => (item.status === 'processing' || item.status === 'pending') && item.expectedVersionId === asset.currentVersionId);
    if (previous && previous.status !== 'pending') {
        const version = await finalizeAuthorizedProofUpload(projectId, assetId, previous.id, authorize);
        return { versionId: version.id, duplicate: true };
    }
    const expectedVersionId = previous?.expectedVersionId ?? asset.currentVersionId;
    const requestId = sha256Hex(JSON.stringify([key, expectedVersionId]));
    const grant = await beginAuthorizedProofUpload(projectId, assetId, {
        requestId, expectedVersionId, filename: 'test-email.eml', contentType: 'message/rfc822', size: previous?.size ?? bytes.length
    }, authorize, { emailDelivery: { key, addressHash, sourceDigest: digest } });
    if (grant.version.status === 'pending' && !await proofSourceExists(proofs, grant.version.id))
        await stageAuthorizedProofSource(assetId, grant.version.id, bytes, authorize);
    const version = await finalizeAuthorizedProofUpload(projectId, assetId, grant.version.id, authorize);
    return { versionId: version.id, duplicate: Boolean(previous) };
}

async function proofSourceExists(proofs: ReturnType<typeof proofStore>, id: string) {
    const version = (await proofs.version(id))?.doc;
    if (!version) return false;
    const { getProofBlobs, proofStagedBlob } = await import('./blobs');
    return getProofBlobs().hasStaged(proofStagedBlob(version));
}
