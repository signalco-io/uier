import { randomBytes, timingSafeEqual } from 'node:crypto';
import { apiErrors } from '../comments/http';
import { sha256Hex } from '../app/tokens';
import { authorizeProof, proofProject, type ProofAuthorization } from './access';
import { requireProofMemberById } from './sourceAccess';
import { readProofBytes } from './sourceBytes';
import { mutateProof, proofConflict, proofEpoch, proofNotFound, proofStore, type DbProofVersion } from './store';
import { beginAuthorizedProofUpload, finalizeAuthorizedProofUpload, stageAuthorizedProofSource } from './uploads';

export const maxInboundProofBytes = 4 * 1024 * 1024;
const alphabet = '0123456789abcdefghijklmnopqrstuv';
const addressPattern = /^([0-9a-z]{12})-([0-9a-v]{26})-([0-9a-f]{24})$/;

function configuration() {
    const domain = process.env.UIER_PROOF_EMAIL_DOMAIN?.trim().toLowerCase();
    const secret = process.env.UIER_PROOF_EMAIL_SECRET?.trim();
    if (!domain || !secret || secret.length < 32 || domain.length > 190 || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)
        || /(^|\.)uier\.io$/.test(domain)) return;
    return { domain, secret };
}

function assetCode(assetId: string) {
    return BigInt('0x' + assetId.replaceAll('-', '')).toString(32).padStart(26, '0');
}

function assetIdFromCode(code: string) {
    let value = 0n;
    for (const char of code) value = value * 32n + BigInt(alphabet.indexOf(char));
    const hex = value.toString(16).padStart(32, '0');
    return hex.replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/, '$1-$2-$3-$4-$5');
}

export async function proofEmailAddress(request: Request, projectId: string, assetId: string, action?: 'rotate' | 'disable') {
    const { project, asset } = await authorizeProof(request, { projectId, assetId }, 'manage');
    if (!asset) throw proofNotFound();
    const configured = configuration();
    if (!action) {
        const epoch = proofEpoch((await proofStore(project.id).guard())?.doc);
        return { available: Boolean(configured), active: asset.emailIngress?.epoch === epoch };
    }
    if (action === 'rotate' && !configured) throw apiErrors.unavailable('Test email delivery requires a dedicated ingress domain and secret.');
    const secretPart = randomBytes(12).toString('hex');
    return mutateProof<{ available: boolean; active: boolean; address?: string }>(project, async (proofs, guard) => {
        const { actor } = await authorizeProof(request, { projectId, assetId }, 'manage');
        const saved = await proofs.asset(assetId);
        if (!saved || actor.kind !== 'member') throw proofNotFound();
        if (action === 'rotate' && !(guard.formats ?? ['image']).includes('email')) throw apiErrors.forbidden('Email uploads are paused for this project.');
        const { emailIngress: _, ...asset } = saved.doc;
        const enabled = action === 'rotate';
        const doc = enabled ? { ...asset, emailIngress: { hash: sha256Hex(secretPart), ownerId: actor.userId,
            epoch: proofEpoch(guard), createdAt: new Date().toISOString() } } : asset;
        return { value: { available: Boolean(configured), active: enabled,
            ...(enabled && configured ? { address: `${project.id}-${assetCode(assetId)}-${secretPart}@${configured.domain}` } : {}) },
        operations: [{ kind: 'replace', doc, etag: saved.etag }] };
    });
}

function verifyIngress(request: Request) {
    const config = configuration();
    if (!config) throw apiErrors.unavailable('Test email delivery is not configured.');
    const supplied = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${config.secret}`;
    if (supplied.length > 512 || !timingSafeEqual(Buffer.from(sha256Hex(supplied)), Buffer.from(sha256Hex(expected)))) throw proofNotFound();
    const [local, domain, extra] = (request.headers.get('x-uier-envelope-to') ?? '').toLowerCase().split('@');
    const match = addressPattern.exec(local ?? '');
    if (!match || domain !== config.domain || extra !== undefined) throw proofNotFound();
    return { projectId: match[1]!, assetId: assetIdFromCode(match[2]!), addressHash: sha256Hex(match[3]!) };
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
    const { projectId, assetId, addressHash } = verifyIngress(request);
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'message/rfc822')
        throw apiErrors.invalidRequest('Send the raw RFC 822 message.');
    const authorize = async (): Promise<ProofAuthorization> => {
        const project = await proofProject(projectId);
        const proofs = proofStore(project.id);
        const [asset, guard] = await Promise.all([proofs.asset(assetId), proofs.guard()]);
        const ingress = asset?.doc.emailIngress;
        if (!asset || asset.doc.deleted || !guard || guard.doc.deleted || !ingress
            || ingress.epoch !== proofEpoch(guard.doc) || ingress.hash !== addressHash) throw proofNotFound();
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
