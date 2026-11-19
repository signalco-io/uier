import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { createProject, updateProject } from '../src/lib/app/projects';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { findOrCreateUser } from '../src/lib/app/users';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { proofApi } from '../src/lib/proofs/routes';
import { receiveProofEmail } from '../src/lib/proofs/emailIngress';
import { serveProofPrototype } from '../src/lib/proofs/prototype';
import { proofApiPath, type ProofAsset, type ProofAssetDetail, type ProofUploadGrant, type ProofVersion } from '../src/lib/proofs/model';
import { POST as mailEndpoint } from '../app/api/proof-mail/route';

const base = 'http://localhost:4693';
const isolation = 'http://127.0.0.1:4693';
const mailAlias = 'proofs@review.uier.io';
const mailSecret = 'local-fixture-proof-mail-secret-for-tests';
const sourceFixtures = process.env.UIER_PROOF_FIXTURE_DIR;
const png = () => sharp({ create: { width: 8, height: 6, channels: 3, background: 'blue' } }).png().toBuffer();

function request(path: string, method = 'GET', body?: Buffer | object, cookies?: string, extra?: HeadersInit) {
    const url = new URL(path, base);
    const headers = new Headers({ host: url.host, origin: base });
    if (cookies) headers.set('cookie', cookies);
    if (body && !Buffer.isBuffer(body)) headers.set('content-type', 'application/json');
    new Headers(extra).forEach((value, key) => headers.set(key, value));
    return new Request(url, { method, headers, body: body ? Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) : undefined });
}
async function proof(request: Request) {
    const [projectId, ...proofPath] = new URL(request.url).pathname.split('/').slice(3);
    return proofApi(request, { params: Promise.resolve({ projectId: projectId!, proofPath }) }, async () => base);
}
async function json<T>(response: Response, status = 200) {
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json() as Promise<T>;
}
async function fixture() {
    process.env.UIER_LOCAL = '1';
    process.env.NEXT_PUBLIC_UIER_PROOF_HTML_ORIGIN = isolation;
    process.env.UIER_PROOF_EMAIL_ALIAS = mailAlias;
    process.env.UIER_PROOF_EMAIL_SECRET = mailSecret;
    const user = await findOrCreateUser(`source-${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context = { user, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
    const project = await createProject(context, { name: 'Source acceptance', mode: 'files', urls: [] });
    await updateProject(workspace.id, project.id, { access: 'guests' });
    const root = proofApiPath(project.publicId);
    const owner = `${cookieName(cookieNames.session)}=${sessionToken(user.id).token}`;
    const api = (path: string, method = 'GET', body?: Buffer | object) => proof(request(root + path, method, body, owner));
    await json(await api('/settings', 'PATCH', { formats: ['image', 'pdf', 'figma', 'video', 'email', 'html'] }));
    const asset = async (name: string) => (await json<{ asset: ProofAsset }>(await api('/assets', 'POST', { name }), 201)).asset;
    async function upload(asset: ProofAsset, name: string, contentType: string, bytes: Buffer, expectedVersionId: string | null = null, want = 200) {
        const path = '/assets/' + asset.id + '/uploads';
        const grant = await json<ProofUploadGrant>(await api(path, 'POST', { requestId: randomUUID(), filename: name, contentType, size: bytes.length, expectedVersionId }));
        expect((await proof(request(grant.uploadUrl!, 'PUT', bytes, undefined, grant.headers))).status).toBe(204);
        return json<{ version: ProofVersion }>(await api(path + '/' + grant.version.id + '/finalize', 'POST'), want).then(body => body.version);
    }
    async function guest(asset: ProofAsset, downloadOriginal: boolean) {
        const share = await json<{ url: string; share: { id: string } }>(await api('/shares', 'POST', { scope: { kind: 'asset', id: asset.id }, permission: 'view', downloadOriginal }), 201);
        const token = new URLSearchParams(new URL(share.url).hash.slice(1)).get('share');
        const exchanged = await proof(request(root + '/exchange', 'POST', { token }));
        expect(exchanged.status).toBe(200);
        const cookie = exchanged.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
        return { cookie, share: share.share, detail: () => proof(request(root + '/assets/' + asset.id, 'GET', undefined, cookie)) };
    }
    return { api, asset, upload, guest, root, owner, project, context };
}

function archive(entries: Record<string, string>) {
    return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([path, value]) => [path, Buffer.from(value)]))));
}

function relevantText(file: ProofVersion) { return file.artifacts.find(artifact => artifact.id === file.manifest?.pdf?.textArtifactId)!; }

const privateToken = 'PRIVATE-ORIGINAL-XYZ-978123';
async function privatePdf() {
    const pdf = await PDFDocument.create();
    pdf.setTitle(privateToken);
    pdf.setSubject(privateToken);
    await pdf.attach(Buffer.from(privateToken), privateToken + '.txt');
    pdf.addJavaScript('private-script', `this.getField('${privateToken}')`);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([420, 500]);
    page.drawText('Garden menu', { x: 56, y: 400, size: 30, font });
    page.drawText('Find rosemary and thyme', { x: 56, y: 340, size: 22, font });
    page.drawText(privateToken, { x: 58, y: 300, size: 14, font, opacity: 0 });
    page.drawText(privateToken, { x: 58, y: -200, size: 14, font });
    pdf.addPage([300, 400]).drawText('Dessert menu', { x: 42, y: 300, size: 28, font });
    return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

test('PDF preview exposes page pixels and search evidence while restricting every original byte', async () => {
    const f = await fixture();
    const asset = await f.asset('Private PDF');
    const source = await privatePdf();
    const version = await f.upload(asset, 'menu.pdf', 'application/pdf', source);
    expect(version.manifest?.pdf?.rendition).toBe('raster-ocr-v1');
    expect(version.manifest?.surfaces).toHaveLength(2);
    const restricted = await f.guest(asset, false);
    const exposed = (await json<ProofAssetDetail>(await restricted.detail())).version!;
    expect(exposed.originalUrl).toBeUndefined();
    expect(exposed.artifacts).toHaveLength(2);
    const originalPath = version.originalUrl!;
    expect((await proof(request(originalPath, 'GET', undefined, restricted.cookie))).status).toBe(403);
    for (const artifact of exposed.artifacts) {
        const response = await proof(request(artifact.url, 'GET', undefined, restricted.cookie));
        expect(response.status).toBe(200);
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(bytes.includes(Buffer.from(privateToken))).toBe(false);
        expect(bytes.equals(source)).toBe(false);
        if (artifact.contentType === 'application/pdf') {
            const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
            try {
                const display = await task.promise;
                expect(display.numPages).toBe(2);
                expect(await display.getAttachments()).toBeNull();
                expect(await display.getJSActions()).toBeNull();
                expect(JSON.stringify(await display.getMetadata())).not.toContain(privateToken);
                const items = (await (await display.getPage(1)).getTextContent()).items;
                const text = items.flatMap(item => 'str' in item ? item.str : []).join(' ').replace(/\s+/g, ' ');
                expect(text).toMatch(/Garden menu.*rosemary and thyme/i);
                expect(text).not.toContain(privateToken);
            } finally { await task.destroy(); }
        } else {
            const pages = JSON.parse(bytes.toString('utf8')) as { id: string; text: string }[];
            expect(pages.map(page => page.id)).toEqual(exposed.manifest?.surfaces.map(surface => surface.id));
            expect(pages[1]?.text).toContain('Dessert menu');
        }
    }
    const permitted = await f.guest(asset, true);
    const original = await proof(request(originalPath, 'GET', undefined, permitted.cookie));
    expect(original.status).toBe(200);
    expect(original.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(Buffer.from(await original.arrayBuffer()).equals(source)).toBe(true);
});

const eml = (subject: string, id: string) => Buffer.from([
    'From: Review <test@example.test>', 'To: anyone@example.test', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8',
    'Message-ID: <' + id + '@example.test>', 'Subject: ' + subject, 'X-Preheader: Fresh from the kitchen', '',
    '<p>See the <a href="https://example.test/menu">menu</a>.</p><script>alert(1)</script><img src="https://example.test/track.png">'
].join('\r\n'));

function inbound(address: string, bytes: Buffer, secret = mailSecret) {
    return request('/api/proof-mail', 'POST', bytes, undefined, { Authorization: 'Bearer ' + secret,
        'Content-Type': 'message/rfc822', 'X-Uier-Envelope-To': address });
}

test('test email intake verifies the provider, deduplicates delivery, and rotates the destination', async () => {
    const f = await fixture();
    const asset = await f.asset('Test emails');
    const path = '/assets/' + asset.id + '/email-address';
    const { address } = await json<{ address: string }>(await f.api(path, 'POST'));
    expect(address).toMatch(/^proofs\+[a-f0-9]{40}@review\.uier\.io$/);
    expect(address.split('@')[0]!.length).toBeLessThanOrEqual(64);
    expect(address).not.toContain(f.project.id);
    expect((await mailEndpoint(inbound(address, eml('First menu', 'v1'), 'wrong'))).status).toBe(404);
    // Provider routing must use the full SMTP recipient. MIME To points elsewhere in this fixture.
    expect((await mailEndpoint(inbound(mailAlias, eml('Missing detail', 'v0')))).status).toBe(404);
    const first = await receiveProofEmail(inbound(address, eml('First menu', 'v1')));
    const second = await receiveProofEmail(inbound(address, eml('Second menu', 'v2')));
    expect(second.versionId).not.toBe(first.versionId);
    expect(await receiveProofEmail(inbound(address, Buffer.concat([Buffer.from('Received: retransmission\r\n'), eml('First menu', 'v1')]))))
        .toEqual({ versionId: first.versionId, duplicate: true });
    expect((await mailEndpoint(inbound(address, eml('Different menu', 'v1')))).status).toBe(409);
    const version = (await json<ProofAssetDetail>(await f.api('/assets/' + asset.id))).version!;
    expect(version.manifest?.email).toMatchObject({ subject: 'Second menu', sender: 'Review <test@example.test>',
        preheader: 'Fresh from the kitchen', links: ['https://example.test/menu'] });
    const html = version.artifacts.find(item => item.id === 'email-html')!;
    const preview = await proof(request(html.url, 'GET', undefined, f.owner));
    expect(preview.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await preview.text()).not.toMatch(/script|track\.png/);
    const rotated = await json<{ address: string }>(await f.api(path, 'POST'));
    expect(rotated.address).not.toBe(address);
    expect((await mailEndpoint(inbound(address, eml('Retired', 'v3')))).status).toBe(404);
    expect((await mailEndpoint(inbound(rotated.address, eml('Third', 'v3')))).status).toBe(200);
    await json(await f.api(path, 'DELETE'));
    expect((await mailEndpoint(inbound(rotated.address, eml('Disabled', 'v4')))).status).toBe(404);
});

test('prototype resource grants serve only on the isolated host and stop on share revocation', async () => {
    const f = await fixture();
    const asset = await f.asset('Prototype');
    const version = await f.upload(asset, 'prototype.zip', 'application/zip', archive({
        'design/index.html': '<!doctype html><link rel="stylesheet" href="/menu.css"><button>Menu</button><script src="menu.js"></script><a href="details.html">Details</a>',
        'design/details.html': '<h1>Details</h1>', 'design/menu.js': 'window.proofMenu = true;', 'design/menu.css': 'button { display: block; }'
    }));
    expect(version.artifacts).toEqual([]);
    expect(version.manifest?.html?.pages).toEqual({ prototype: 'index.html', 'prototype-2': 'details.html' });
    expect((await proof(request(`${f.root}/assets/${asset.id}/versions/${version.id}/media/prototype-1`, 'GET', undefined, f.owner))).status).toBe(404);
    const guest = await f.guest(asset, false);
    const open = proof(request(`${f.root}/assets/${asset.id}/versions/${version.id}/prototype`, 'GET', undefined, guest.cookie));
    const grant = await json<{ url: string }>(await open);
    const url = new URL(grant.url);
    expect(url.origin).toBe(isolation);
    const token = url.pathname.split('/')[2]!;
    const isolated = (path: string) => serveProofPrototype(request(grant.url, 'GET', undefined, undefined), token, [path]);
    const page = await isolated('index.html');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
    expect(page.headers.get('content-security-policy')).not.toContain('allow-same-origin');
    expect(await page.text()).toContain('__uier_bridge.js');
    expect((await isolated('menu.js')).headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect((await serveProofPrototype(request(grant.url, 'GET', undefined, undefined, { 'Sec-Fetch-Dest': 'document' }), token, ['index.html'])).status).toBe(404);
    expect(await (await isolated('details.html')).text()).toContain('Details');
    expect((await serveProofPrototype(request('/proof-preview/' + token + '/index.html'), token, ['index.html'])).status).toBe(404);
    expect((await f.api('/shares/' + guest.share.id, 'DELETE')).status).toBe(204);
    expect((await isolated('menu.js')).status).toBe(404);
    await f.upload(asset, 'unsafe.zip', 'application/zip', archive({ 'index.html': '<p>okay</p>', '../danger.js': 'bad' }), version.id, 422);
    expect((await json<ProofAssetDetail>(await f.api('/assets/' + asset.id))).asset.currentVersionId).toBe(version.id);
    const single = await f.upload(asset, 'prototype.html', 'text/html', Buffer.from('<h1>Standalone HTML</h1>'), version.id);
    expect(single.manifest?.html?.pages).toEqual({ prototype: 'index.html' });
});

test('Figma imports and resyncs only authorized frame IDs, preserving history after access loss', async () => {
    const f = await fixture();
    const asset = await f.asset('Design');
    const image = await png();
    const token = 'synthetic_figma_token_123';
    const source = 'https://www.figma.com/design/AbCdEf123/design';
    let revision = 1;
    let allowed = true;
    const received: string[] = [];
    const server: Server = createServer((request, response) => {
        const url = new URL(request.url!, 'http://' + request.headers.host);
        if (url.pathname === '/frame.png') {
            if (request.headers['x-figma-token']) received.push('token-forwarded');
            response.writeHead(200, { 'Content-Type': 'image/png' }).end(image);
            return;
        }
        if (!allowed || request.headers['x-figma-token'] !== token) { response.writeHead(403).end(); return; }
        const first = { id: '1:2', name: revision === 1 ? 'Home' : 'New Home', type: 'FRAME' };
        const other = revision === 1 ? { id: '1:3', name: 'About', type: 'FRAME' } : { id: '1:4', name: 'New', type: 'FRAME' };
        response.setHeader('Content-Type', 'application/json');
        if (url.pathname.startsWith('/v1/files/')) response.end(JSON.stringify({ version: String(revision), name: 'Design', document: { id: '0:0', name: 'Document', type: 'DOCUMENT',
            children: [{ id: '0:1', type: 'CANVAS', name: 'Page 1', children: [first, other] }] } }));
        else {
            received.push(url.searchParams.get('version') ?? 'missing');
            response.end(JSON.stringify({ images: Object.fromEntries(url.searchParams.get('ids')!.split(',').map(id => [id, `${url.origin}/frame.png`])) }));
        }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    process.env.UIER_PROOF_FIGMA_TEST_ORIGIN = 'http://127.0.0.1:' + (typeof address === 'object' ? address?.port : 0);
    try {
        const discover = await json<{ frames: unknown[] }>(await f.api('/figma/frames', 'POST', { url: source, token }));
        expect(discover.frames).toMatchObject([{ id: '1:2', name: 'Home' }, { id: '1:3', name: 'About' }]);
        const path = '/assets/' + asset.id + '/figma';
        const first = { url: source, token, frameIds: ['1:2', '1:3'], expectedVersionId: null, requestId: randomUUID() };
        const v1 = (await json<{ version: ProofVersion }>(await f.api(path, 'POST', first))).version;
        expect((await json<{ version: ProofVersion }>(await f.api(path, 'POST', first))).version.id).toBe(v1.id);
        revision = 2;
        const second = { ...first, frameIds: ['1:2', '1:3', '1:4'], expectedVersionId: v1.id, requestId: randomUUID() };
        const v2 = (await json<{ version: ProofVersion }>(await f.api(path, 'POST', second))).version;
        expect(v2.manifest?.figma?.changes).toEqual({ added: ['1:4'], renamed: [{ id: '1:2', from: 'Home', to: 'New Home' }], removed: ['1:3'] });
        expect(v2.manifest?.surfaces[0]?.id).toBe(v1.manifest?.surfaces[0]?.id);
        expect(received).toEqual(['1', '2']);
        allowed = false;
        expect((await f.api(path, 'POST', { ...second, expectedVersionId: v2.id, requestId: randomUUID() })).status).toBe(403);
        const guest = await f.guest(asset, false);
        const detail = await json<ProofAssetDetail>(await guest.detail());
        expect(detail.versions.map(version => version.id)).toEqual([v2.id, v1.id]);
        expect(detail.version?.manifest?.figma).toBeUndefined();
        expect(detail.version?.manifest?.surfaces[0]?.sourceUrl).toBeUndefined();
    } finally {
        delete process.env.UIER_PROOF_FIGMA_TEST_ORIGIN;
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});

test('representative v1 and v2 files publish through all format adapters', async () => {
    test.skip(!sourceFixtures, 'Set UIER_PROOF_FIXTURE_DIR to the representative fixture directory.');
    test.setTimeout(120_000);
    const f = await fixture();
    for (const [prefix, extension, type, format] of [
        ['menu', 'png', 'image/png', 'image'], ['brochure', 'pdf', 'application/pdf', 'pdf'], ['film', 'mp4', 'video/mp4', 'video'],
        ['campaign', 'eml', 'message/rfc822', 'email'], ['prototype', 'zip', 'application/zip', 'html']
    ] as const) {
        const asset = await f.asset(prefix);
        let v1: ProofVersion | undefined;
        for (const number of [1, 2]) {
            const name = `${prefix}-v${number}.${extension}`;
            const version = await f.upload(asset, name, type, await readFile(join(sourceFixtures!, name)), v1?.id ?? null);
            expect(version.manifest?.format).toBe(format);
            expect(version.number).toBe(number);
            if (format === 'pdf') {
                expect(relevantText(version)).toBeDefined();
                if (v1) {
                    const before = v1.manifest!.surfaces.map(page => page.id);
                    const after = version.manifest!.surfaces.map(page => page.id);
                    expect(after[0]).not.toBe(before[0]);
                    expect(after).toContain(before[0]);
                }
            }
            if (number === 1) v1 = version;
        }
    }
});

test('SVG imports only self-contained markup and animated images retain decoded frames', async () => {
    const f = await fixture();
    const asset = await f.asset('Vectors');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="25" height="10"><rect width="25" height="10" fill="green"/></svg>');
    const version = await f.upload(asset, 'shape.svg', 'image/svg+xml', svg);
    expect(version.artifacts[0]?.contentType).toBe('image/webp');
    expect(version.manifest?.surfaces[0]).toMatchObject({ width: 25, height: 10 });
    await f.upload(asset, 'external.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/image"/></svg>'), version.id, 422);
    const gif = await sharp(Buffer.concat([Buffer.alloc(300, 45), Buffer.alloc(300, 220)]), { raw: { width: 10, height: 20, pageHeight: 10, channels: 3 } })
        .gif({ delay: [120, 240] }).toBuffer();
    const animated = await f.upload(asset, 'animation.gif', 'image/gif', gif, version.id);
    expect(animated.manifest?.durationMs).toBe(360);
    const bytes = await (await proof(request(animated.artifacts[0]!.url, 'GET', undefined, f.owner))).arrayBuffer();
    expect((await sharp(Buffer.from(bytes), { animated: true }).metadata()).pages).toBe(2);
});

test('MCP uploads require their own live scope and selected project', async () => {
    const { createMcpCredential, revokeMcpCredential } = await import('../src/lib/mcp/credentials');
    const { handleMcp } = await import('../src/lib/mcp/http');
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const f = await fixture();
    const asset = await f.asset('Agent file');
    const other = await createProject(f.context, { name: 'Excluded', mode: 'files', urls: [] });
    const read = await createMcpCredential(f.context, { name: 'Reader', projectIds: [f.project.id], scopes: ['feedback:read'], days: 7 });
    const writer = await createMcpCredential(f.context, { name: 'Uploader', projectIds: [f.project.id], scopes: ['feedback:read', 'proofs:upload'], days: 7 });
    async function connect(token: string) {
        const client = new Client({ name: 'Proof source regression', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', base), {
            requestInit: { headers: { Authorization: 'Bearer ' + token } },
            fetch: (input, init) => handleMcp(new Request(input, init), base, { emit: () => undefined })
        }));
        return client;
    }
    const readClient = await connect(read.token);
    const writerClient = await connect(writer.token);
    const data = await png();
    const args = { projectId: f.project.id, assetId: asset.id, size: data.length, filename: 'menu.png', contentType: 'image/png',
        requestId: randomUUID(), expectedVersionId: null };
    try {
        expect((await readClient.callTool({ name: 'begin_proof_upload', arguments: args })).isError).toBe(true);
        expect((await writerClient.callTool({ name: 'list_proof_files', arguments: { projectId: other.id } })).isError).toBe(true);
        const result = await writerClient.callTool({ name: 'begin_proof_upload', arguments: args });
        expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
        const grant = result.structuredContent as { versionId: string; uploadUrl: string; headers: Record<string, string> };
        expect((await proof(request(grant.uploadUrl, 'PUT', data, undefined, grant.headers))).status).toBe(204);
        const finalized = await writerClient.callTool({ name: 'finalize_proof_upload', arguments: { projectId: args.projectId, assetId: args.assetId, versionId: grant.versionId } });
        expect(finalized.isError, JSON.stringify(finalized.structuredContent)).not.toBe(true);
        expect(finalized.structuredContent).toMatchObject({ format: 'image', number: 1, url: expect.stringContaining('/proof/') });
        const next = await writerClient.callTool({ name: 'begin_proof_upload', arguments: { ...args, requestId: randomUUID(), expectedVersionId: grant.versionId } });
        const nextGrant = next.structuredContent as typeof grant;
        await revokeMcpCredential(f.context.user.id, writer.credential.id);
        expect((await proof(request(nextGrant.uploadUrl, 'PUT', data, undefined, nextGrant.headers))).status).toBe(404);
    } finally { await Promise.all([readClient.close(), writerClient.close()]); }
});

test('QuickTime remux, WebM playback and bounded QuickTime conversion produce seekable previews', async () => {
    const binary = process.env.UIER_PROOF_FFMPEG_PATH;
    test.skip(!binary, 'Set UIER_PROOF_FFMPEG_PATH to qualify video conversions.');
    const { execFile } = await import('node:child_process');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { promisify } = await import('node:util');
    const ffmpeg = promisify(execFile);
    const root = await mkdtemp(join(tmpdir(), 'proof-video-source-'));
    const f = await fixture();
    const asset = await f.asset('Film conversion');
    try {
        let expected: string | null = null;
        for (const [name, codec, inputType, outputType] of [
            ['portable.mov', 'libx264', 'video/quicktime', 'video/mp4'],
            ['portable.webm', 'libvpx-vp9', 'video/webm', 'video/webm'],
            ['convert.mov', 'prores_ks', 'video/quicktime', 'video/mp4']
        ]) {
            const path = join(root, name!);
            await ffmpeg(binary!, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=12:duration=1',
                '-threads', '1', '-an', '-c:v', codec!, path], { timeout: 12_000 });
            const version = await f.upload(asset, name!, inputType!, await readFile(path), expected);
            const playback = version.artifacts.find(item => item.id === version.manifest?.video?.artifactId)!;
            expect(playback.contentType).toBe(outputType);
            expect(version.manifest?.durationMs).toBeGreaterThanOrEqual(900);
            expect(version.artifacts.some(item => item.id === version.manifest?.video?.posterArtifactId)).toBe(true);
            const seek = await proof(request(playback.url, 'GET', undefined, f.owner, { Range: 'bytes=0-20' }));
            expect(seek.status).toBe(206);
            expect(await seek.arrayBuffer()).toHaveProperty('byteLength', 21);
            expected = version.id;
        }
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('Cloudflare relay forwards its complete envelope recipient and ignores the MIME recipient', async () => {
    const f = await fixture();
    const asset = await f.asset('SMTP envelope');
    const { address } = await json<{ address: string }>(await f.api('/assets/' + asset.id + '/email-address', 'POST'));
    const { default: worker } = await import('../../../.github/proofs/mail-worker.mjs');
    const originalFetch = globalThis.fetch;
    const reads: string[] = [];
    const rejects: string[] = [];
    globalThis.fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        reads.push(headers.get('X-Uier-Envelope-To') ?? '');
        return mailEndpoint(new Request(input, { method: 'POST', headers, body: await new Response(init?.body).arrayBuffer() }));
    };
    try {
        const raw = eml('Envelope recipient test', 'real-envelope');
        const env = { UIER_PROOF_EMAIL_ALIAS: mailAlias, UIER_PROOF_EMAIL_SECRET: mailSecret, UIER_PROOF_APP_ORIGIN: base };
        await worker.email({ to: address, rawSize: raw.length, raw: new Blob([new Uint8Array(raw)]).stream(),
            setReject: (reason: string) => rejects.push(reason) }, env);
        await worker.email({ to: mailAlias, rawSize: raw.length, raw: new Blob([new Uint8Array(raw)]).stream(),
            setReject: (reason: string) => rejects.push(reason) }, env);
        expect(reads).toEqual([address]);
        expect(rejects).toEqual(['Unknown test review address.']);
        const detail = await json<ProofAssetDetail>(await f.api('/assets/' + asset.id));
        expect(detail.version?.manifest?.email?.subject).toBe('Envelope recipient test');
        expect(detail.versions).toHaveLength(1);
    } finally { globalThis.fetch = originalFetch; }
});

test('Cloudflare setup reads back its literal Worker rule and preserves protected mail routes', async () => {
    const { verifyOrCreateMailRoute } = await import('../../../.github/proofs/cloudflare-mail-route.mjs');
    const priorFetch = globalThis.fetch;
    const priorToken = process.env.CLOUDFLARE_API_TOKEN;
    const priorZone = process.env.UIER_PROOF_EMAIL_ZONE_ID;
    const priorAlias = process.env.UIER_PROOF_EMAIL_ALIAS;
    process.env.CLOUDFLARE_API_TOKEN = 'synthetic-routing-test-bearer';
    process.env.UIER_PROOF_EMAIL_ZONE_ID = '0'.repeat(32);
    process.env.UIER_PROOF_EMAIL_ALIAS = mailAlias;
    const protectedRules = ['contact', 'security', 'privacy'].map(alias => ({ id: alias, enabled: true,
        actions: [{ type: 'forward', value: ['operator@example.test'] }],
        matchers: [{ type: 'literal', field: 'to', value: alias + '@uier.io' }] }));
    const writes: unknown[] = [];
    const reads: string[] = [];
    let rule: object | undefined;
    let supportsPlus = true;
    globalThis.fetch = async (input, init) => {
        const { pathname } = new URL(String(input));
        const path = pathname.split('/email/routing')[1] ?? '';
        if (init?.method === 'POST') {
            expect(path).toBe('/rules');
            const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
            writes.push(payload);
            rule = { ...payload, id: 'proof-rule', source: 'api' };
            return Response.json({ success: true, result: rule });
        }
        reads.push(path);
        const result = path === '/rules' ? [...protectedRules, ...(rule ? [rule] : [])]
            : path === '/rules/catch_all' ? { enabled: false, actions: [{ type: 'drop' }] }
                : path === '/rules/proof-rule' ? rule : { name: 'uier.io', enabled: true, status: 'ready', support_subaddress: supportsPlus };
        return Response.json({ success: true, result });
    };
    try {
        const lookupMx = async (host: string) => {
            expect(host).toBe('review.uier.io');
            return [{ exchange: 'route1.mx.cloudflare.net', priority: 10 }];
        };
        await verifyOrCreateMailRoute('preview', { apply: true, lookupMx });
        await verifyOrCreateMailRoute('preview', { apply: true, lookupMx });
        expect(writes).toEqual([{ name: 'uier test proof email (preview)', enabled: true,
            matchers: [{ type: 'literal', field: 'to', value: mailAlias }], actions: [{ type: 'worker', value: ['uier-proof-mail-preview'] }] }]);
        expect(reads).toContain('/rules/proof-rule');
        expect(reads.filter(path => path === '/rules/catch_all')).toHaveLength(3);
        supportsPlus = false;
        await expect(verifyOrCreateMailRoute('preview', { apply: true, lookupMx })).rejects.toThrow('Enable Email Routing and plus addressing');
        expect(writes).toHaveLength(1);
    } finally {
        globalThis.fetch = priorFetch;
        for (const [name, value] of Object.entries({ CLOUDFLARE_API_TOKEN: priorToken, UIER_PROOF_EMAIL_ZONE_ID: priorZone, UIER_PROOF_EMAIL_ALIAS: priorAlias })) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
});
