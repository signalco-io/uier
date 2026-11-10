import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { createProject } from '../src/lib/app/projects';
import { deleteProject } from '../src/lib/app/projectDeletion';
import { memberId, type DbMember, type DbProject } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { randomToken, signToken } from '../src/lib/app/tokens';
import { consume } from '../src/lib/comments/rateLimits';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { projectPartition } from '../src/lib/review/comments';
import { POST, OPTIONS } from '../app/api/review/[projectId]/page-checks/route';
import { listPageChecks, pageCheckId, savePageCheck } from '../src/lib/pageChecks/store';
import { PAGE_CHECKS_PER_MEMBER_PER_HOUR, PAGE_CHECKS_PER_PROJECT_PER_DAY, projectPageChecksLimit } from '../src/lib/pageChecks/limits';
import { PAGE_CHECKS_MAX_PAGES, PAGE_CHECKS_TTL_SECONDS, pageChecksPk, pageCheckRow, type PageCheckRow } from '../src/lib/pageChecks/model';
import { filterPageChecks, isPageCheckFilter, pageCheckChange, pageCheckFilters, pageCheckInsights, sortPageChecks } from '../src/lib/pageChecks/insights';
import { pathTree, type PathNode } from '../src/lib/pageChecks/pathTree';

// `POST /api/review/<code>/page-checks` and the store behind the app's Page checks view
// (apps/web/docs/page-checks.md): members only, strict validation, the latest summary per page with
// the previous counts, a cap per project, rate limits and deletion with the project.

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

const site = 'https://site.example';

async function fixture(access: DbProject['access'] = 'guests') {
    const admin = await findOrCreateUser(`page-checks-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(admin);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context: AppContext = { user: admin, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
    const created = await createProject(context, { name: `Checked ${randomUUID().slice(0, 8)}`, urls: [site, 'https://staging.site.example'] });
    const project = (await updateDoc<DbProject>(created.pk, created.id, doc => ({ ...doc, access })))!;
    const reviewer = await findOrCreateUser(`page-checks-reviewer-${randomUUID()}@example.com`);
    await getAppStore().create<DbMember>({ ...member, id: memberId(reviewer.id), userId: reviewer.id, email: reviewer.email, role: 'commenter', projects: [project.id] });
    const token = (userId: string) => signToken('review', { uid: userId, pid: project.id }, 3600);
    return { context, project, admin, reviewer, adminToken: token(admin.id), reviewerToken: token(reviewer.id) };
}

const summary = (overrides: Record<string, unknown> = {}) => ({
    path: '/pricing',
    title: 'Pricing',
    description: 'Plans and prices.',
    noindex: false,
    accessibility: { critical: 1, serious: 2, moderate: 0, minor: 3 },
    seo: { warn: 3, pass: 9 },
    checks: { 'seo:title': 'pass', 'seo:canonical': 'warn', 'accessibility:image-alt': 'warn' },
    vitals: { lcp: 1800, cls: 0.02, inp: 96 },
    ...overrides
});

function post(project: DbProject, body: unknown, headers: Record<string, string> = {}) {
    const request = new Request(`http://127.0.0.1/api/review/${project.id}/page-checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    return POST(request, { params: Promise.resolve({ projectId: project.id }) });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function stored(project: DbProject) {
    return (await listPageChecks(project.id)).sort((a, b) => a.path < b.path ? -1 : 1);
}

test('only project members save page checks: guests, public viewers and other sites are refused', async () => {
    const f = await fixture('guests');
    // A guest of a guest-link project and a public viewer
    const guest = await post(f.project, summary(), { 'X-Uier-Visitor': randomToken() });
    expect(guest.status).toBe(403);
    expect(await guest.json()).toMatchObject({ error: 'forbidden' });
    expect((await post(f.project, summary())).status).toBe(403);
    // A token of another project is no one
    const foreign = signToken('review', { uid: f.reviewer.id, pid: 'otherproject' }, 3600);
    expect((await post(f.project, summary(), bearer(foreign))).status).toBe(403);
    expect(await stored(f.project)).toEqual([]);

    // A member, from uier's own origin (BotID directly)
    expect((await post(f.project, summary(), bearer(f.reviewerToken))).status).toBe(204);
    // From the project's site: CORS for that site and its verification proof
    const fromSite = { ...bearer(f.reviewerToken), Origin: 'https://staging.site.example' };
    const unverified = await post(f.project, summary({ path: '/plans' }), fromSite);
    expect(unverified.status).toBe(403);
    expect(await unverified.json()).toMatchObject({ error: 'bot_detected' });
    const proof = signToken('review-verification', { projectId: f.project.id, origin: 'https://staging.site.example', authorId: `user:${f.reviewer.id}` }, 300);
    const verified = await post(f.project, summary({ path: '/plans' }), { ...fromSite, 'X-Uier-Verification': proof });
    expect(verified.status).toBe(204);
    expect(verified.headers.get('Access-Control-Allow-Origin')).toBe('https://staging.site.example');
    // Another site is refused before anything else
    expect((await post(f.project, summary(), { ...bearer(f.reviewerToken), Origin: 'https://elsewhere.example' })).status).toBe(403);
    const preflight = await OPTIONS(new Request(`http://127.0.0.1/api/review/${f.project.id}/page-checks`, { method: 'OPTIONS', headers: { Origin: site } }),
        { params: Promise.resolve({ projectId: f.project.id }) });
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('POST');

    // Keyed like comments: the environment the request came from and the canonical page
    const pages = await stored(f.project);
    expect(pages.map(page => [page.origin, page.path])).toEqual([['https://staging.site.example', '/plans'], [site, '/pricing']]);
    expect(pages[1]).toMatchObject({ title: 'Pricing', noindex: false, seo: { warn: 3, pass: 9 }, accessibility: { critical: 1, serious: 2, moderate: 0, minor: 3 },
        checks: { 'seo:title': 'pass', 'seo:canonical': 'warn', 'accessibility:image-alt': 'warn' }, vitals: { lcp: 1800, cls: 0.02, inp: 96 } });
    expect(pages[1]!.previous).toBeUndefined();
    // No reviewer in the document
    const doc = (await getAppStore().get(pageChecksPk(f.project.id), pages[1]!.id))!.doc;
    expect(JSON.stringify(doc)).not.toContain(f.reviewer.id);
    expect(doc.ttl).toBe(PAGE_CHECKS_TTL_SECONDS);

    // A project for invited people: anyone but a member must sign in
    const invited = await fixture('invited');
    const anonymous = await post(invited.project, summary());
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: 'sign_in_required' });
    expect((await post(invited.project, summary(), bearer(invited.adminToken))).status).toBe(204);
});

test('summaries are validated strictly: known fields and check ids, bounded numbers, strings and maps', async () => {
    const f = await fixture();
    const refused = async (body: unknown, status = 400, headers: Record<string, string> = {}) => {
        const response = await post(f.project, body, { ...bearer(f.reviewerToken), ...headers });
        expect(response.status, JSON.stringify(body).slice(0, 120)).toBe(status);
    };
    await refused(summary({ selector: '#hero' }));
    await refused(summary({ seo: { warn: 1, pass: 1, total: 2 } }));
    await refused(summary({ accessibility: { critical: 1, serious: 0, moderate: 0 } }));
    await refused(summary({ seo: { warn: -1, pass: 0 } }));
    await refused(summary({ seo: { warn: 1.5, pass: 0 } }));
    await refused(summary({ seo: { warn: 100_001, pass: 0 } }));
    await refused(summary({ checks: { 'seo:Title': 'pass' } }));
    await refused(summary({ checks: { 'title': 'pass' } }));
    await refused(summary({ checks: { 'crawler:robots-txt': 'pass' } }));
    await refused(summary({ checks: { 'seo:title': 'fail' } }));
    await refused(summary({ checks: Object.fromEntries(Array.from({ length: 151 }, (_, i) => [`seo:check-${i}`, 'pass'])) }));
    await refused(summary({ title: 'x'.repeat(201) }));
    await refused(summary({ title: 'Line one\nline two' }));
    await refused(summary({ description: 'd'.repeat(301) }));
    await refused(summary({ vitals: { lcp: -1 } }));
    await refused(summary({ vitals: { cls: 101 } }));
    await refused(summary({ vitals: { fid: 10 } }));
    await refused(summary({ path: 'https://site.example/pricing' }));
    await refused(summary({ path: '//elsewhere.example/pricing' }));
    await refused(summary({ noindex: 'no' }));
    await refused('{', 400);
    await refused(JSON.stringify(summary({ description: 'd'.repeat(300), checks: {} })) + ' '.repeat(17 * 1024), 413);
    await refused(summary(), 415, { 'Content-Type': 'text/plain' });
    expect(await stored(f.project)).toEqual([]);

    // The largest summary allowed fits
    const largest = summary({ title: 't'.repeat(200), description: 'd'.repeat(300),
        checks: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`accessibility:${'r'.repeat(50)}-${i}`, 'warn'])) });
    expect((await post(f.project, largest, bearer(f.reviewerToken))).status).toBe(204);
});

test('the latest summary replaces the page\'s previous one and keeps its counts; the page state applies', async () => {
    const f = await fixture();
    expect((await post(f.project, summary(), bearer(f.reviewerToken))).status).toBe(204);
    const first = (await stored(f.project))[0]!;
    // The same page, with its trailing slash and a query the project does not keep, from another member
    const later = summary({ path: '/pricing/', sourcePath: '/pricing/', accessibility: { critical: 0, serious: 1, moderate: 0, minor: 3 }, seo: { warn: 1, pass: 11 }, title: 'Pricing plans' });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect((await post(f.project, later, bearer(f.adminToken))).status).toBe(204);
    const pages = await stored(f.project);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ id: first.id, path: '/pricing', sourcePath: '/pricing/', title: 'Pricing plans', seo: { warn: 1, pass: 11 },
        previous: { checkedAt: first.checkedAt, seo: { warn: 3, pass: 9 }, accessibility: { critical: 1, serious: 2, moderate: 0, minor: 3 } } });
    expect(pages[0]!.checkedAt > first.checkedAt).toBe(true);
    expect(pageCheckChange(pages[0]!)).toEqual({ accessibility: -2, seo: -2 });
    // A summary without the audit keeps the previous audit's counts only as `previous`
    expect((await post(f.project, summary({ accessibility: undefined, seo: { warn: 1, pass: 11 } }), bearer(f.reviewerToken))).status).toBe(204);
    const third = (await stored(f.project))[0]!;
    expect(third.accessibility).toBeUndefined();
    expect(third.previous?.accessibility).toEqual({ critical: 0, serious: 1, moderate: 0, minor: 3 });
    expect(pageCheckChange(third)).toEqual({ seo: 0 });
    // The id is the environment's origin and the canonical page
    expect(third.id).toBe(pageCheckId(site, '/pricing'));
});

test('page checks keep only content-changing query parameters (uier #254)', async () => {
    const f = await fixture();
    for (const query of ['', '?lang=', '?lang=sq-AL&ignored=value']) {
        expect((await post(f.project, summary({ path: `/cms/products${query}`, sourcePath: `/cms/products/${query}` }), bearer(f.reviewerToken))).status).toBe(204);
    }
    expect(await stored(f.project)).toMatchObject([{ path: '/cms/products', sourcePath: '/cms/products/' }]);
    expect(await stored(f.project)).toHaveLength(1);
    await updateDoc<DbProject>(f.project.pk, f.project.id, doc => ({ ...doc, pageState: { queryParameters: ['lang'], hashRouting: false } }));
    for (const query of ['?lang=', '?lang=sq-AL&ignored=value']) {
        expect((await post(f.project, summary({ path: `/cms/products${query}`, sourcePath: `/cms/products/${query}` }), bearer(f.reviewerToken))).status).toBe(204);
    }
    expect((await stored(f.project)).map(page => page.path)).toEqual(['/cms/products', '/cms/products?lang=', '/cms/products?lang=sq-AL']);
    // Recorded keys remain usable after settings change; reading never silently merges their reports.
    await updateDoc<DbProject>(f.project.pk, f.project.id, doc => ({ ...doc, pageState: { queryParameters: [], hashRouting: false } }));
    expect((await stored(f.project)).map(page => page.path)).toEqual(['/cms/products', '/cms/products?lang=', '/cms/products?lang=sq-AL']);
});

test('a project keeps its most recently checked pages up to the cap', async () => {
    const f = await fixture();
    const start = Date.parse('2026-11-01T00:00:00Z');
    const page = (i: number) => ({ path: `/page-${String(i).padStart(3, '0')}`, origin: site, noindex: false, seo: { warn: 0, pass: 1 }, checks: {} });
    for (let i = 0; i < PAGE_CHECKS_MAX_PAGES; i++)
        await savePageCheck(f.project.id, page(i), { now: new Date(start + i * 1000) });
    // Checking a page that is there again replaces it, at the cap too
    await savePageCheck(f.project.id, page(0), { now: new Date(start + 500_000) });
    expect(await getAppStore().count({ type: 'page-check', pk: pageChecksPk(f.project.id) })).toBe(PAGE_CHECKS_MAX_PAGES);
    // A new page replaces the least recently checked one (page 1: page 0 was checked again)
    await savePageCheck(f.project.id, page(PAGE_CHECKS_MAX_PAGES), { now: new Date(start + 600_000) });
    const paths = (await listPageChecks(f.project.id)).map(item => item.path);
    expect(paths).toHaveLength(PAGE_CHECKS_MAX_PAGES);
    expect(paths).toContain('/page-000');
    expect(paths).not.toContain('/page-001');
    expect(paths).toContain(`/page-${PAGE_CHECKS_MAX_PAGES}`);
});

test('saving is rate limited per member and per project', async () => {
    const f = await fixture();
    for (let i = 0; i < PAGE_CHECKS_PER_MEMBER_PER_HOUR; i++)
        expect((await post(f.project, summary({ path: `/page-${i % 5}` }), bearer(f.reviewerToken))).status).toBe(204);
    const limited = await post(f.project, summary(), bearer(f.reviewerToken));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: 'rate_limited', reason: 'too_fast' });
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    // Another member still saves until the project's day is used up
    expect((await post(f.project, summary(), bearer(f.adminToken))).status).toBe(204);
    for (let i = PAGE_CHECKS_PER_MEMBER_PER_HOUR + 1; i < PAGE_CHECKS_PER_PROJECT_PER_DAY; i++)
        await consume(getCommentsStore(), projectPartition(f.project.id), projectPageChecksLimit);
    expect((await post(f.project, summary(), bearer(f.adminToken))).status).toBe(429);
    // An invalid summary is refused before it counts
    const other = await fixture();
    for (let i = 0; i < PAGE_CHECKS_PER_MEMBER_PER_HOUR + 5; i++)
        expect((await post(other.project, summary({ seo: { warn: -1, pass: 0 } }), bearer(other.reviewerToken))).status).toBe(400);
    expect((await post(other.project, summary(), bearer(other.reviewerToken))).status).toBe(204);
});

test('deleting the project deletes its page checks', async () => {
    const f = await fixture();
    const kept = await fixture();
    for (const project of [f.project, kept.project])
        expect((await post(project, summary(), bearer(project === f.project ? f.reviewerToken : kept.reviewerToken))).status).toBe(204);
    await deleteProject(f.context, f.project.id, f.project.name);
    expect(await getAppStore().count({ type: 'page-check', pk: pageChecksPk(f.project.id) })).toBe(0);
    expect(await listPageChecks(kept.project.id)).toHaveLength(1);
});

test('across pages: shared titles and descriptions per site address, pages without a description, noindex pages; most attention first', async () => {
    const row = (path: string, overrides: Partial<PageCheckRow> = {}): PageCheckRow => ({
        id: `${overrides.origin ?? site}${path}`, origin: site, path, title: 'Home', description: 'About us.', noindex: false,
        seo: { warn: 0, pass: 5 }, checkedAt: '2026-11-01T00:00:00.000Z', ...overrides
    });
    const pages = [
        row('/a', { accessibility: { critical: 0, serious: 3, moderate: 0, minor: 0 }, seo: { warn: 4, pass: 1 } }),
        row('/b', { title: '  home ', accessibility: { critical: 1, serious: 0, moderate: 0, minor: 0 } }),
        row('/c', { title: 'Contact', description: undefined, seo: { warn: 2, pass: 3 }, checkedAt: '2026-11-03T00:00:00.000Z' }),
        row('/a', { origin: 'https://staging.site.example', title: 'Home', description: 'Staging.' }),
        row('/hidden', { noindex: true, description: undefined }),
        row('/d', { title: 'Docs', description: undefined, vitals: { lcp: 4000 } })
    ];
    const insights = pageCheckInsights(pages);
    // Case and spacing aside, on one site address; a noindex page doesn't count
    expect(insights.sharedTitles.map(group => group.pages.map(page => page.path))).toEqual([['/a', '/b']]);
    expect(insights.sharedDescriptions.map(group => [group.text, group.pages.map(page => page.path)])).toEqual([['About us.', ['/a', '/b']]]);
    expect(insights.withoutDescription.map(page => page.path)).toEqual(['/c', '/d']);
    expect(insights.noindex.map(page => page.path)).toEqual(['/hidden']);
    // Critical, then serious, then all issues, then SEO, then Core Web Vitals over target
    expect(sortPageChecks(pages, 'attention').map(page => `${page.origin === site ? '' : 'staging:'}${page.path}`))
        .toEqual(['/b', '/a', '/c', '/d', 'staging:/a', '/hidden']);
    expect(sortPageChecks(pages, 'checked')[0]!.path).toBe('/c');
    expect(sortPageChecks(pages, 'seo').map(page => page.path).slice(0, 2)).toEqual(['/a', '/c']);
    // The view never receives the check states
    const full = { ...pages[0]!, checks: { 'seo:title': 'pass' as const } };
    expect(pageCheckRow(full)).not.toHaveProperty('checks');
});

test('across pages: addresses as a hierarchy of path segments, a query under its path, empty single levels merged (uier #219)', async () => {
    const paths = ['/', '/cms', '/cms/articles', '/cms/articles/new', '/cms/destinations/coolinarika/daily-menus',
        '/cms/products?lang=', '/cms/products?lang=sq-AL', '/cms/users', '/?preview=1', 'not-a-path'];
    const tree = pathTree(paths, path => path);
    type Shown = { label: string; page: boolean; children?: Shown[] };
    const shown = (nodes: PathNode<string>[]): Shown[] => nodes.map(node => ({
        label: node.path.slice(node.base.length), page: node.item !== undefined,
        ...(node.children.length ? { children: shown(node.children) } : {})
    }));
    expect(shown(tree)).toEqual([
        { label: '/', page: true, children: [{ label: '?preview=1', page: true }] },
        { label: '/cms', page: true, children: [
            { label: '/articles', page: true, children: [{ label: '/new', page: true }] },
            // No page at /cms/destinations or /cms/destinations/coolinarika: one line
            { label: '/destinations/coolinarika/daily-menus', page: true },
            // No page at /cms/products: a level with its two queries
            { label: '/products', page: false, children: [{ label: '?lang=', page: true }, { label: '?lang=sq-AL', page: true }] },
            { label: '/users', page: true }
        ] },
        { label: 'not-a-path', page: true }
    ]);
    // Every level's address starts with the one above it
    const bases = (nodes: PathNode<string>[]): boolean => nodes.every(node => node.path.startsWith(node.base) && bases(node.children));
    expect(bases(tree)).toBe(true);
    // Distinct empty path segments and query variants retain every page link
    const unusual = ['/a/b', '/a//b', '/a//b?q=1', '//a/b', '/a/b/'];
    const leaves = (nodes: PathNode<string>[]): string[] => nodes.flatMap(node => [...(node.item === undefined ? [] : [node.item]), ...leaves(node.children)]);
    expect(leaves(pathTree(unusual, path => path)).sort()).toEqual([...unusual].sort());
    // A flat list stays flat
    expect(shown(pathTree(['/a', '/b'], path => path))).toEqual([{ label: '/a', page: true }, { label: '/b', page: true }]);
});

test('a finding links checked ancestors outside its own pages, keeping unchecked groups as text (uier #254)', () => {
    const paths = ['/cms/products?lang=', '/cms/products?lang=sq-AL', '/cms/users/a', '/cms/users/b'];
    const tree = pathTree(paths, path => path, [...paths, '/cms', '/cms/products', '/unrelated']);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ path: '/cms', item: '/cms' });
    expect(tree[0]!.children[0]).toMatchObject({ path: '/cms/products', item: '/cms/products',
        children: [{ item: '/cms/products?lang=' }, { item: '/cms/products?lang=sq-AL' }] });
    expect(tree[0]!.children[1]).toMatchObject({ path: '/cms/users', children: [{ item: '/cms/users/a' }, { item: '/cms/users/b' }] });
    expect(tree[0]!.children[1]!.item).toBeUndefined();
    // An unchecked ancestor with only one child still collapses.
    expect(pathTree(['/cms/products'], path => path, ['/cms/products'])[0]!.path).toBe('/cms/products');
});

test('the pages a filter shows: needing attention in any check or in one, passing all categories or incomplete (uier #221)', async () => {
    const row = (path: string, overrides: Partial<PageCheckRow> = {}): PageCheckRow => ({
        id: path, origin: site, path, noindex: false, seo: { warn: 0, pass: 5 }, checkedAt: '2026-11-01T00:00:00.000Z',
        accessibility: { critical: 0, serious: 0, moderate: 0, minor: 0 }, ...overrides
    });
    const pages = [
        row('/a11y', { accessibility: { critical: 0, serious: 0, moderate: 0, minor: 1 } }),
        row('/seo', { seo: { warn: 2, pass: 3 } }),
        row('/slow', { vitals: { lcp: 4000, cls: 0.01 } }),
        row('/clean', { vitals: { lcp: 900, cls: 0.01, inp: 40 } }),
        // Missing results cannot establish that all checks passed
        row('/unaudited', { accessibility: undefined, vitals: { lcp: 900, cls: 0.01, inp: 40 } }),
        row('/no-vitals'),
        row('/partial-vitals', { vitals: { lcp: 900, cls: 0.01 } }),
        row('/no-seo', { seo: { pass: 0, warn: 0 }, vitals: { lcp: 900, cls: 0.01, inp: 40 } })
    ];
    const shown = (filter: typeof pageCheckFilters[number]) => filterPageChecks(pages, filter).map(page => page.path);
    expect(shown('all')).toEqual(pages.map(page => page.path));
    expect(shown('attention')).toEqual(['/a11y', '/seo', '/slow']);
    expect(shown('accessibility')).toEqual(['/a11y']);
    expect(shown('seo')).toEqual(['/seo']);
    expect(shown('vitals')).toEqual(['/slow']);
    expect(shown('passing')).toEqual(['/clean']);
    expect(shown('incomplete')).toEqual(['/a11y', '/seo', '/slow', '/unaudited', '/no-vitals', '/partial-vitals', '/no-seo']);
    expect(pageCheckFilters.every(isPageCheckFilter)).toBe(true);
    expect(isPageCheckFilter('everything')).toBe(false);
});
