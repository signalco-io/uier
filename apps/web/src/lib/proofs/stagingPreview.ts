import { createHash } from 'node:crypto';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { z } from 'zod';
import type { AppDoc } from '../app/model';
import { assertAppOrigin } from '../app/avatarUpload';
import { requestSessionUser } from '../app/sessionIdentity';
import { cookieNames, readMigratingCookie } from '../cookieNames';
import { readReviewSsoSession } from '../app/reviewSsoCookie';
import { ApiError, errorResponse, parseJsonBody } from '../comments/http';
import { loadAppCatalog } from '../i18n/catalog';
import { browserAppLanguage, readAppLanguage } from '../i18n/languages';
import { createAppTranslator } from '../i18n/translate';
import { getProofBlobs, proofAttemptPrefix } from './blobs';
import { liveStagingPair, memberStagingPair, stagingPairingId } from './staging';
import { proofNotFound, proofStore } from './store';

const lifetime = 15 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const receiptId = (pair: string, challenge: string) => `staging-access:${pair}:${challenge}`;
const previewInput = z.strictObject({ verifier: stagingPairingId, check: z.boolean() });

type PreviewReceipt = AppDoc & {
    type: 'proof-staging-access';
    assetId: string;
    userId: string;
    epoch: string;
    expires: number;
    ttl: number;
};

const frameScript = `
const access = document.querySelector('a');
const notice = document.querySelector('main');
const image = document.querySelector('img');
const address = new URL(location.href);
const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
let imageUrl;
let retryUntil = 0;
let timer;
let busy = false;
function tellParent(ready) {
    if (parent !== window) parent.postMessage({ type: 'uier:staging-preview', ready }, document.body.dataset.parent);
}
async function read() {
    if (busy) return;
    busy = true;
    try {
        const response = await fetch(address, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ verifier, check: Boolean(imageUrl) })
        });
        if (!response.ok) throw new Error();
        if (!imageUrl) {
            imageUrl = URL.createObjectURL(await response.blob());
            image.src = imageUrl;
            await image.decode();
            image.hidden = false;
            notice.hidden = true;
            tellParent(true);
        }
        timer = setTimeout(read, 30000);
    } catch {
        const wasVisible = Boolean(imageUrl);
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrl = undefined;
        image.removeAttribute('src');
        image.hidden = true;
        notice.hidden = false;
        tellParent(false);
        if (wasVisible) retryUntil = 0;
        if (Date.now() < retryUntil) timer = setTimeout(read, 2000);
    } finally { busy = false; }
}
crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(buffer => {
    const challenge = Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
    access.href = document.body.dataset.authorize + '?' + new URLSearchParams({ challenge, lang: document.documentElement.lang });
    access.hidden = false;
    access.addEventListener('click', () => {
        clearTimeout(timer);
        retryUntil = Date.now() + 120000;
        timer = setTimeout(read, 750);
    });
    read();
});
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { clearTimeout(timer); read(); }
});
`;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

async function textFor(request: Request, url: URL) {
    const language = readAppLanguage(url.searchParams.get('lang')) ?? browserAppLanguage(request.headers.get('accept-language'));
    const translate = createAppTranslator(language === 'en' ? {} : await loadAppCatalog(language));
    return { language, t: (key: string) => escapeHtml(translate(key)) };
}

function html(language: string, title: string, body: string, ancestors: string, script?: string, attrs = '') {
    const scriptHash = script ? `'sha256-${createHash('sha256').update(script).digest('base64')}'` : "'none'";
    return new Response(`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:light dark;font:1rem system-ui;color:CanvasText}body{margin:0}
main{padding:1rem;background:Canvas;border:1px solid GrayText}button,a{min-height:44px;display:inline-flex;align-items:center}
img{display:block;width:100%;height:auto}[hidden]{display:none!important}
</style><body ${attrs}>${body}${script ? `<script>${script}</script>` : ''}</body></html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': `default-src 'none'; script-src ${scriptHash}; style-src 'unsafe-inline'; connect-src 'self'; img-src blob:; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'self'`
        }
    });
}

async function authorizedPreviewResponse(request: Request, projectId: string, pairingId: string) {
    assertAppOrigin(request);
    const { verifier, check } = await parseJsonBody(request, previewInput, 1024);
    const { project, pair } = await liveStagingPair(projectId, pairingId);
    const proofs = proofStore(project.id);
    const reader = { get: (name: string) => {
        const token = request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
        return token ? { value: token.slice(name.length + 1) } : undefined;
    } };
    // The app's HttpOnly first-party/SSO credentials stay on uier. The staging review token is
    // deliberately never accepted here. The receipt is a fallback when a browser blocks cookies in frames.
    const sso = readReviewSsoSession(readMigratingCookie(reader, cookieNames.reviewSso, true));
    const receipt = (await proofs.store.get<PreviewReceipt>(proofs.pk, receiptId(pairingId, digest(verifier))))?.doc;
    const receiptUser = receipt?.type === 'proof-staging-access' && receipt.epoch === pair.epoch && receipt.expires > Date.now() ? receipt.userId : undefined;
    const userId = (await requestSessionUser(request))?.id ?? sso?.uid ?? receiptUser;
    if (!userId) throw proofNotFound();
    const design = await memberStagingPair(projectId, pairingId, userId);
    if (check) return new Response(null, { status: 204 });
    return await previewBytes(request, design);
}

async function previewBytes(request: Request, { version, artifact, pdf, surface }: Awaited<ReturnType<typeof memberStagingPair>>) {
    const file = artifact ?? pdf;
    if (!file) throw proofNotFound();
    const stream = await getProofBlobs().open(`${proofAttemptPrefix(version, version.publishedAttemptId!)}media/${file.id}`, undefined, request.signal);
    if (artifact) return new Response(stream, { headers: { 'Content-Type': artifact.contentType } });
    // The certified PDF rendition contains exactly one JPEG per page and a separate OCR layer.
    // Read the chosen page's image directly, including for previously published certified PDFs.
    const bytes = await new Response(stream).arrayBuffer();
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const index = version.manifest!.surfaces.findIndex(item => item.id === surface.id);
    const images = document.getPage(index).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    const image = images?.entries().map(([, ref]) => document.context.lookup(ref)).find(item =>
        item instanceof PDFRawStream && item.dict.get(PDFName.of('Subtype'))?.toString() === '/Image'
        && item.dict.get(PDFName.of('Filter'))?.toString() === '/DCTDecode');
    if (!(image instanceof PDFRawStream)) throw proofNotFound();
    return new Response(Buffer.from(image.getContents()), { headers: { 'Content-Type': 'image/jpeg' } });
}

async function handle(request: Request, projectId: string, pairingId: string) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/app/staging-preview/')) {
        const challenge = url.searchParams.get('challenge');
        if (!stagingPairingId.safeParse(challenge).success || request.headers.get('sec-fetch-dest') === 'iframe') throw proofNotFound();
        const user = await requestSessionUser(request);
        const { language, t } = await textFor(request, url);
        if (!user) {
            if (request.method !== 'GET') throw proofNotFound();
            const next = url.pathname + url.search;
            return new Response(null, { status: 303, headers: { Location: `/app/sign-in?${new URLSearchParams({ next })}` } });
        }
        const { project, pair } = await memberStagingPair(projectId, pairingId, user.id);
        const title = t('Authorize the approved design preview');
        if (request.method === 'GET') {
            return html(language, title, `<main><h1>${title}</h1><p>${escapeHtml(pair.origin)}</p><form method="post"><button>${t('Allow design preview')}</button></form></main>`, "'none'");
        }
        assertAppOrigin(request);
        const proofs = proofStore(project.id);
        const doc: PreviewReceipt = {
            id: receiptId(pairingId, challenge!), pk: proofs.pk, type: 'proof-staging-access',
            userId: user.id, epoch: pair.epoch, assetId: pair.assetId, expires: Date.now() + lifetime * 1000, ttl: lifetime
        };
        // Each frame chooses its own verifier. A different account cannot replace its authorization.
        await proofs.store.create(doc);
        return html(language, title, `<main><p role="status">${t('Design preview authorized. Return to the staging tab.')}</p></main>`, "'none'");
    }
    if (request.method === 'POST') return await authorizedPreviewResponse(request, projectId, pairingId);
    if (request.headers.get('sec-fetch-dest') !== 'iframe') throw proofNotFound();
    const { pair } = await liveStagingPair(projectId, pairingId);
    const { language, t } = await textFor(request, url);
    const title = t('Approved design preview');
    return html(language, title, `<main><a hidden target="_blank" rel="noopener noreferrer">${t('Authorize design preview in uier')}</a></main><img hidden alt="${title}">`,
        pair.origin, frameScript, `data-parent="${escapeHtml(pair.origin)}" data-authorize="/app/staging-preview/${encodeURIComponent(projectId)}/${pairingId}"`);
}

export async function stagingPreview(request: Request, { params }: { params: Promise<{ projectId: string; pairingId: string }> }) {
    let response: Response;
    try {
        const { projectId, pairingId } = await params;
        response = await handle(request, projectId, pairingId);
    } catch (error) {
        if (!(error instanceof ApiError)) console.error('[staging preview] Request failed.');
        response = errorResponse(error instanceof ApiError ? error : new ApiError(500, 'server_error', 'The request could not be completed.'));
    }
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (request.method === 'POST' && !response.headers.get('Content-Security-Policy'))
        response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return response;
}
