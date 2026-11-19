import { defaultTreeAdapter as tree, html, parse, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import { apiErrors, ApiError } from '../comments/http';
import { signToken, verifyToken } from '../app/tokens';
import { authorizeProof, liveProofShare, proofAllowsGuest, proofProject, scopeIncludesAsset } from './access';
import { requireProofMemberById } from './sourceAccess';
import { validPrototypePath } from './adapters/html';
import { getProofBlobs, proofAttemptPrefix } from './blobs';
import { readProofBytes } from './sourceBytes';
import { proofPreviewOrigin } from './previewOrigin';
import { prototypeBridge, prototypeBridgeName } from './prototypeBridge';
import { proofEpoch, proofNotFound, proofStore } from './store';

const purpose = 'proof-prototype';
const grantAge = 30 * 60;
type PreviewGrant = { p: string; a: string; v: string; e: string; parent: string } & ({ member: string } | { share: string });
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;

export async function openPrototype(request: Request, projectId: string, assetId: string, versionId: string, appBase: string) {
    const { project, actor, version } = await authorizeProof(request, { projectId, assetId, versionId });
    const document = version?.manifest?.html;
    const surface = new URL(request.url).searchParams.get('surface');
    const entry = surface && document?.pages && Object.hasOwn(document.pages, surface) ? document.pages[surface] : document?.entry;
    if (!entry || !version?.resources?.[entry]) throw proofNotFound();
    const origin = proofPreviewOrigin();
    const app = new URL(appBase);
    if (!origin || origin.hostname === app.hostname) throw apiErrors.unavailable('The separate prototype preview host is not configured.');
    const epoch = proofEpoch((await proofStore(project.id).guard())?.doc);
    const token = signToken<PreviewGrant>(purpose, { p: project.id, a: assetId, v: versionId, e: epoch, parent: app.origin,
        ...(actor.kind === 'member' ? { member: actor.userId } : { share: actor.shareId }) }, grantAge);
    const url = new URL(`/proof-preview/${token}/${entry.split('/').map(encodeURIComponent).join('/')}`, origin);
    return { url: url.href, expiresAt: new Date(Date.now() + grantAge * 1000).toISOString() };
}

async function previewVersion(token: string) {
    const grant = verifyToken<PreviewGrant>(purpose, token);
    if (!grant) throw proofNotFound();
    const project = await proofProject(grant.p);
    const proofs = proofStore(project.id);
    const [guard, savedAsset, savedVersion] = await Promise.all([proofs.guard(), proofs.asset(grant.a), proofs.version(grant.v)]);
    const asset = savedAsset?.doc;
    const version = savedVersion?.doc;
    if (!guard || guard.doc.deleted || grant.e !== proofEpoch(guard.doc) || !asset || asset.deleted || !version?.publishedAttemptId
        || version.assetId !== asset.id || version.status !== 'published' || !version.manifest?.html || !version.resources) throw proofNotFound();
    if ('member' in grant) await requireProofMemberById(project, grant.member);
    else {
        const share = (await proofs.share(grant.share))?.doc;
        if (!proofAllowsGuest(project) || !liveProofShare(share, project, grant.e) || !scopeIncludesAsset(share.scope, asset)) throw proofNotFound();
    }
    return { grant, version, resources: version.resources };
}

const baseHeaders = {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=()',
    // Opaque sandbox requests for modules and fetch can read resources of this same scoped bundle.
    'Access-Control-Allow-Origin': 'null', 'Cross-Origin-Resource-Policy': 'cross-origin'
};

function injectPreview(htmlSource: string, root: string, parent: string) {
    const document = parse(htmlSource);
    const page = tree.getChildNodes(document).find(child => tree.isElementNode(child) && child.tagName === 'html') as Element;
    const head = tree.getChildNodes(page).find(child => tree.isElementNode(child) && child.tagName === 'head') as Element;
    const pending: ParentNode[] = [document];
    while (pending.length) {
        const node = pending.pop()!;
        for (const child of [...tree.getChildNodes(node)]) {
            if (!tree.isElementNode(child)) continue;
            if (['base', 'iframe', 'frame', 'object', 'embed', 'portal'].includes(child.tagName)
                || (child.tagName === 'meta' && child.attrs.some(attribute => attribute.name === 'http-equiv'))
                || (child.tagName === 'link' && child.attrs.some(attribute => attribute.name === 'rel' && /\b(?:preconnect|dns-prefetch|prefetch|prerender)\b/i.test(attribute.value)))) {
                tree.detachNode(child);
                continue;
            }
            child.attrs = child.attrs.filter(attribute => attribute.name !== 'ping' && attribute.name !== 'target');
            for (const attribute of child.attrs) {
                if (!['href', 'src', 'poster', 'action', 'formaction', 'data'].includes(attribute.name)) continue;
                const value = attribute.value.trim();
                if (value.startsWith('/') && !value.startsWith('//')) attribute.value = root + value.slice(1);
                else if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) && !/^(?:data:image\/|data:font\/)/i.test(value)) attribute.value = '#';
            }
            pending.push(child);
        }
    }
    const bridge = tree.createElement('script', html.NS.HTML, [
        { name: 'src', value: root + prototypeBridgeName }, { name: 'data-uier-parent', value: parent }
    ]);
    const first = head.childNodes[0];
    if (first) tree.insertBefore(head, bridge, first);
    else tree.appendChild(head, bridge);
    const charset = tree.createElement('meta', html.NS.HTML, [{ name: 'charset', value: 'utf-8' }]);
    tree.insertBefore(head, charset, bridge);
    return serialize(document);
}

export async function serveProofPrototype(request: Request, token: string, parts: string[]) {
    try {
        const origin = proofPreviewOrigin();
        if (!origin || request.headers.get('host') !== origin.host) throw proofNotFound();
        const path = parts.join('/');
        if (!validPrototypePath(path) || request.headers.get('sec-fetch-dest') === 'document') throw proofNotFound();
        const { grant, version, resources } = await previewVersion(token);
        const root = `/proof-preview/${token}/`;
        const allowed = origin.origin + root;
        // The browser makes every bundle document opaque.
        const csp = `default-src 'none'; sandbox allow-scripts; script-src 'unsafe-inline' ${allowed}; style-src 'unsafe-inline' ${allowed}; img-src data: blob: ${allowed}; font-src data: ${allowed}; media-src blob: ${allowed}; connect-src ${allowed}; base-uri 'none'; form-action 'none'; frame-ancestors ${grant.parent}`;
        const headers = new Headers({ ...baseHeaders, 'Content-Security-Policy': csp });
        if (path === prototypeBridgeName) {
            headers.set('Content-Type', 'text/javascript; charset=utf-8');
            return new Response(request.method === 'HEAD' ? null : prototypeBridge, { headers });
        }
        const id = Object.hasOwn(resources, path) ? resources[path] : undefined;
        const artifact = version.artifacts.find(item => item.id === id);
        if (!artifact) throw proofNotFound();
        headers.set('Content-Type', artifact.contentType + (artifact.contentType.startsWith('text/') ? '; charset=utf-8' : ''));
        const body = request.method === 'HEAD' ? null : await getProofBlobs().open(
            `${proofAttemptPrefix(version, version.publishedAttemptId!)}media/${artifact.id}`, undefined, request.signal);
        if (body && artifact.contentType === 'text/html') {
            const htmlSource = (await readProofBytes(body, 4 * 1024 * 1024)).toString('utf8');
            return new Response(injectPreview(htmlSource, root, grant.parent), { headers });
        }
        return new Response(body, { headers });
    } catch (error) {
        const status = error instanceof ApiError ? error.status : 500;
        return new Response(null, { status, headers: { ...baseHeaders, 'Content-Security-Policy': "default-src 'none'; sandbox" } });
    }
}
