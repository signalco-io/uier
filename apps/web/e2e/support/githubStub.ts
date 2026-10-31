import { createServer, type IncomingMessage } from 'node:http';
import { createHash, createPublicKey, createVerify, randomUUID, type KeyObject } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { GitHubComment, GitHubIssue, GitHubRepository } from '../../src/lib/integrations/github/model';

type Body = { client_id?: string; client_secret?: string; code_verifier?: string; code?: string; repository_ids?: number[]; permissions?: { issues?: string; metadata?: string }; title?: string; body?: string; state?: string };

type Issue = GitHubIssue & { title: string; comments: GitHubComment[] };
export async function startGitHubStub(publicKey: KeyObject, options: { port?: number; browserAppBaseUrl?: string } = {}) {
    const app = options.browserAppBaseUrl ? new URL(options.browserAppBaseUrl) : undefined;
    if (app && (app.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(app.hostname)
        || !app.port || app.username || app.password || app.pathname !== '/' || app.search || app.hash)) throw new Error('The GitHub browser simulator requires a loopback app origin');
    const calls: { method: string; path: string; body: unknown }[] = [];
    const repositories: GitHubRepository[] = [201, 202].map((id, index) => ({ id, node_id: `R_${id}`, name: `repo-${index + 1}`,
        full_name: `acme/repo-${index + 1}`, owner: { login: 'acme' }, private: true, archived: false, disabled: false, has_issues: true, permissions: { admin: true } }));
    const issues = new Map<number, Issue[]>();
    repositories.forEach(repo => issues.set(repo.id, []));
    const tokens = new Map<string, number>();
    const usedCodes = new Set<string>();
    const browserCodes = new Map<string, string>();
    let nextIssue = 1000, nextComment = 5000, tokenNumber = 0;
    const faults = { loseIssueResponse: 0, loseCommentResponse: 0, rateLimit: 0, invalidToken: 0, installationUnavailable: false,
        adminRepository: true, userInstallation: true, challenge: '', oauthDenied: false, githubUserId: 7, makePublicAfterIssueUpdate: false };
    const read = async (request: IncomingMessage) => {
        const parts = []; for await (const part of request) parts.push(part);
        const text = Buffer.concat(parts).toString(); return text ? JSON.parse(text) as Body : undefined;
    };
    const bot = { id: 9, login: 'uier-test[bot]', type: 'Bot' };
    const html = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
    const server = createServer(async (request, response) => {
        const url = new URL(request.url!, 'http://localhost');
        const path = decodeURIComponent(url.pathname);
        const body = await read(request) ?? {};
        calls.push({ method: request.method!, path: `${path}${url.search}`, body: path === '/login/oauth/access_token'
            ? { client_id: body?.client_id, verifierPresent: Boolean(body?.code_verifier), secretPresent: Boolean(body?.client_secret) } : body });
        const answer = (status: number, value?: unknown, headers: Record<string, string> = {}) => {
            response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
            response.end(value === undefined ? '' : JSON.stringify(value));
        };
        const page = (title: string, action: string, fields: Record<string, string>, button: string,
            alternative?: { fields: Record<string, string>; button: string }) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${html(title)}</title><h1>${html(title)}</h1>${[{ fields, button }, ...(alternative ? [alternative] : [])].map(form => `<form action="${html(action)}" method="get">${Object.entries(form.fields).map(([key, value]) => `<input type="hidden" name="${html(key)}" value="${html(value)}">`).join('')}<button type="submit">${html(form.button)}</button></form>`).join('')}</html>`);
        };
        const redirect = (target: URL) => { response.writeHead(302, { Location: target.href, 'Cache-Control': 'no-store' }); response.end(); };
        if (path === '/' && request.method === 'GET') return answer(200, { ok: true });
        if (app && path === '/apps/uier-test/installations/new') {
            const state = url.searchParams.get('state') ?? '';
            if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return answer(400);
            return page('Install the uier test app', '/simulate/install', { state }, 'Install uier test app',
                { fields: { state, setup_action: 'request' }, button: 'Request organization approval' });
        }
        if (app && path === '/simulate/install') {
            const state = url.searchParams.get('state') ?? '';
            if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return answer(400);
            const target = new URL('/app/github/setup', app);
            target.search = new URLSearchParams(url.searchParams.get('setup_action') === 'request'
                ? { setup_action: 'request', state } : { installation_id: '101', setup_action: 'install', state }).toString();
            return redirect(target);
        }
        if (app && path === '/login/oauth/authorize') {
            const state = url.searchParams.get('state') ?? '', challenge = url.searchParams.get('code_challenge') ?? '';
            if (url.searchParams.get('client_id') !== 'Iv1.uier-test' || url.searchParams.get('redirect_uri') !== new URL('/app/github/callback', app).href
                || url.searchParams.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return answer(400);
            return page('Authorize the uier test app', '/simulate/authorize', { state, challenge }, 'Authorize uier test app');
        }
        if (app && path === '/simulate/authorize') {
            const state = url.searchParams.get('state') ?? '', challenge = url.searchParams.get('challenge') ?? '';
            if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return answer(400);
            const code = randomUUID(); browserCodes.set(code, challenge);
            const target = new URL('/app/github/callback', app);
            target.search = new URLSearchParams({ state, code }).toString();
            return redirect(target);
        }
        const bearer = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
        if (path === '/login/oauth/access_token') {
            const challenge = createHash('sha256').update(String(body?.code_verifier)).digest('base64url');
            if (faults.oauthDenied || usedCodes.has(body?.code ?? '') || body?.client_id !== 'Iv1.uier-test' || body?.client_secret !== 'test-client-secret'
                || challenge !== (browserCodes.get(body?.code ?? '') ?? (app ? undefined : faults.challenge))) return answer(200, { error: 'bad_verification_code' });
            usedCodes.add(body.code!);
            return answer(200, { access_token: 'user-token', token_type: 'bearer', expires_in: 8 * 3600, refresh_token: 'never-persist-refresh' });
        }
        if (request.headers['x-github-api-version'] !== '2026-03-10') return answer(400, { message: 'Version missing' });
        if (path === '/user/installations' && bearer === 'user-token') return answer(200, { installations: faults.userInstallation
            ? [{ id: 101, app_id: 999, account: { login: 'acme' }, permissions: { issues: 'write' }, suspended_at: null }] : [] });
        if (path === '/user' && bearer === 'user-token') return answer(200, { id: faults.githubUserId });
        if (path === '/users/uier-test[bot]' && bearer === 'user-token') return answer(200, bot);
        if (path === '/user/installations/101/repositories' && bearer === 'user-token') return answer(200, { total_count: repositories.length,
            repositories: repositories.map(repo => ({ ...repo, permissions: { admin: faults.adminRepository } })) });
        if (path.startsWith('/app/installations/101')) {
            let valid = false;
            try {
                const [header, payload, signature] = bearer.split('.');
                const verify = createVerify('RSA-SHA256'); verify.update(`${header}.${payload}`);
                const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as { iss: string; exp: number; iat: number };
                valid = verify.verify(publicKey, Buffer.from(signature!, 'base64url')) && claims.iss === 'Iv1.uier-test'
                    && claims.exp > Date.now() / 1000 && claims.exp - claims.iat <= 600;
            } catch { /* Invalid test JWT. */ }
            if (!valid) return answer(401, { message: 'Invalid JWT' });
            if (faults.installationUnavailable) return answer(404, { message: 'Missing installation' });
            if (path.endsWith('/access_tokens')) {
                if (request.method !== 'POST' || body?.repository_ids?.length !== 1 || !issues.has(body.repository_ids[0]!)
                    || body.permissions?.issues !== 'write' || body.permissions?.metadata !== 'read') return answer(422, { message: 'Scope missing' });
                const token = `installation-token-${++tokenNumber}`;
                tokens.set(token, body.repository_ids![0]!);
                return answer(201, { token, expires_at: new Date(Date.now() + 3600_000).toISOString(), permissions: { issues: 'write', metadata: 'read' }, repositories: [{ id: body.repository_ids[0] }] });
            }
            return answer(200, { id: 101, permissions: { issues: 'write' }, suspended_at: null });
        }
        const repoId = tokens.get(bearer);
        if (!repoId) return answer(401, { message: 'Token missing' });
        if (faults.invalidToken > 0) { faults.invalidToken--; return answer(401, { message: 'Expired token' }); }
        if (faults.rateLimit > 0) { faults.rateLimit--; return answer(429, { message: 'Rate limited' }, { 'Retry-After': '7' }); }
        const repo = repositories.find(repo => repo.id === repoId)!;
        const values = issues.get(repoId)!;
        if (path === '/installation/repositories') return answer(200, { repositories: [repo], total_count: 1 });
        const base = `/repos/${repo.owner.login}/${repo.name}`;
        if (!path.startsWith(base)) return answer(404, { message: 'Wrong repository scope' });
        const number = Number(path.slice(base.length).split('/')[2]);
        const issue = values.find(issue => issue.number === number);
        if (path === `${base}/issues` && request.method === 'GET') {
            const page = Number(url.searchParams.get('page') ?? 1);
            return answer(200, [...values].reverse().slice((page - 1) * 100, page * 100));
        }
        if (path === `${base}/issues` && request.method === 'POST') {
            const created: Issue = { id: ++nextIssue, number: values.length + 1, title: body.title ?? '', body: body.body ?? '', state: 'open', user: bot,
                created_at: new Date().toISOString(), html_url: `https://github.com/${repo.full_name}/issues/${values.length + 1}`, comments: [] };
            values.push(created);
            if (faults.loseIssueResponse > 0) { faults.loseIssueResponse--; return answer(500, { message: 'Lost after commit' }); }
            return answer(201, created);
        }
        if (/\/issues\/comments\/\d+$/.test(path)) {
            const id = Number(path.split('/').at(-1));
            const owner = values.find(issue => issue.comments.some(comment => comment.id === id));
            const comment = owner?.comments.find(comment => comment.id === id);
            if (!comment) return answer(404, { message: 'Missing comment' });
            if (request.method === 'PATCH') comment.body = body.body ?? '';
            if (request.method === 'DELETE') { owner!.comments = owner!.comments.filter(comment => comment.id !== id); return answer(204); }
            return answer(200, comment);
        }
        if (!issue) return answer(404, { message: 'Missing issue' });
        if (path.endsWith('/comments')) {
            if (request.method === 'GET') {
                const page = Number(url.searchParams.get('page') ?? 1);
                return answer(200, issue.comments.slice((page - 1) * 100, page * 100));
            }
            if (request.method === 'POST') {
                const comment: GitHubComment = { id: ++nextComment, body: body.body ?? '', issue_url: `https://api.github.com${base}/issues/${issue.number}`, user: bot };
                issue.comments.push(comment);
                if (faults.loseCommentResponse > 0) { faults.loseCommentResponse--; return answer(500, { message: 'Lost after commit' }); }
                return answer(201, comment);
            }
        }
        if (request.method === 'PATCH') {
            Object.assign(issue, body);
            if (faults.makePublicAfterIssueUpdate) { faults.makePublicAfterIssueUpdate = false; repo.private = false; }
        }
        return answer(200, issue);
    });
    if (app) repositories[1]!.private = false;
    await new Promise<void>(resolve => server.listen(options.port ?? 0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Stub address missing');
    return { url: `http://127.0.0.1:${address.port}`, calls, issues, repositories, faults,
        close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !process.env.UIER_GITHUB_PRIVATE_KEY || !process.env.UIER_GITHUB_STUB_APP_BASE_URL)
        throw new Error('Set a local GitHub stub PORT, test signing key and app origin');
    const stub = await startGitHubStub(createPublicKey(process.env.UIER_GITHUB_PRIVATE_KEY), { port, browserAppBaseUrl: process.env.UIER_GITHUB_STUB_APP_BASE_URL });
    process.on('SIGTERM', () => { void stub.close().then(() => process.exit(0)); });
    process.on('SIGINT', () => { void stub.close().then(() => process.exit(0)); });
}
