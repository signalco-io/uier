// Opt-in live Cosmos measurements. Never runs as part of the in-memory test suite.
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { CosmosClient } from '@azure/cosmos';
import { AzureCliCredential } from '@azure/identity';

const mode = process.argv[2];
const [resourceGroup, account] = process.argv.slice(3);
if (!['production-read-only', 'preview-synthetic', 'preview-idle'].includes(mode) || !resourceGroup || !account)
    throw new Error('Usage: node scripts/cosmos-query-profile.mjs production-read-only|preview-synthetic|preview-idle <resource-group> <account>');
const az = (...args) => {
    try { return JSON.parse(execFileSync('az', [...args, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch { throw new Error('Azure CLI access failed; raw output suppressed.'); }
};
const { documentEndpoint: endpoint } = az('cosmosdb', 'show', '-g', resourceGroup, '-n', account);
// Use the signed-in operator's scoped Entra data roles; never retrieve account keys.
const { tenantId } = az('account', 'show');
const client = new CosmosClient({ endpoint, aadCredentials: new AzureCliCredential({ tenantId }),
    connectionPolicy: { enableEndpointDiscovery: false, requestTimeout: 15_000, retryOptions: { maxRetryAttemptCount: 2 } } });
const db = client.database('uierdata');
const app = db.container(mode === 'production-read-only' ? 'app' : 'app-preview');
const comments = db.container(mode === 'production-read-only' ? 'comments' : 'comments-preview');
const started = Date.now();
let totalRu = 0, requests = 0;
const results = [];
let phase = 'initialization';
function budget() {
    const production = mode === 'production-read-only';
    if (totalRu > (production ? 1000 : 80_000) || requests >= (production ? 500 : 12_000) || Date.now() - started > (production ? 2 : 10) * 60_000) throw new Error('Profile safety budget exhausted');
}
function accountResponse(response) { totalRu += Number(response.requestCharge ?? response.headers?.['x-ms-request-charge'] ?? 0); requests++; }
async function query(container, operation, sql, parameters = [], pk, onPage) {
    phase = operation;
    budget();
    const begin = performance.now();
    const iterator = container.items.query({ query: sql, parameters }, { partitionKey: pk, maxItemCount: 100, populateQueryMetrics: true });
    let ru = 0, pages = 0, rows = 0, retries = 0, throttles = 0, retrieved = 0, indexHits = 0;
    const resources = [];
    while (iterator.hasMoreResults()) {
        budget();
        if (pages >= (mode === 'production-read-only' ? 20 : 50) || rows >= (mode === 'production-read-only' ? 2000 : 5000)) throw new Error('Profile page/row budget exhausted');
        const page = await iterator.fetchNext();
        accountResponse(page); ru += page.requestCharge; if (page.resources !== undefined || page.requestCharge) pages++; rows += (page.resources ?? []).length;
        resources.push(...(page.resources ?? []));
        if (onPage) await onPage(pages);
        const attempts = page.diagnostics?.clientSideRequestStatistics?.retryDiagnostics?.failedAttempts ?? [];
        retries += attempts.length; throttles += attempts.filter(a => a.statusCode === 429).length;
        for (const metrics of Object.values(page.queryMetrics ?? {})) {
            // SDK 4.x returns a map of QueryMetrics, with no customer fields needed here.
            if (metrics && typeof metrics === 'object') { retrieved += metrics.retrievedDocumentCount || 0; indexHits += metrics.indexHitDocumentCount || 0; }
        }
    }
    results.push({ operation, container: container.id, partition: pk ? 'single' : 'cross', ru, ms: Math.round(performance.now() - begin), rows, pages, queries: 1, retries, throttles, retrieved, indexHits });
    return resources;
}
const p = (name, value) => ({ name: `@${name}`, value });
const now = new Date().toISOString();
try {
    if (mode === 'production-read-only') {
        // Exact read shapes of an idle scheduled turn. Do not invoke workers (they write).
        for (const [name, sql, params, pk] of [
            ['cleanup', 'SELECT * FROM c WHERE c.type = @type', [p('type', 'thread-cleanup')]],
            ['project-deletions', 'SELECT * FROM c WHERE c.type = @type AND c.pk = @pk', [p('type', 'project-deletion'), p('pk', 'project-deletion')], 'project-deletion'],
            ...['accepted', 'suppressed'].map(status => [`notification-adopt-${status}`, 'SELECT TOP 100 * FROM c WHERE c.type = @type AND c.active = false AND c.status = @status AND NOT IS_DEFINED(c.ttl)', [p('type', 'notification-delivery'), p('status', status)]]),
            ['notification-due-after', 'SELECT * FROM c WHERE c.type = @type AND c.active = true AND c.nextAttemptAt <= @now', [p('type', 'notification-delivery'), p('now', now)]],
            ['notification-active', 'SELECT * FROM c WHERE c.type = @type AND c.active = true', [p('type', 'notification-delivery')]],
            ...['failed', 'ambiguous'].map(status => [`notification-blocked-${status}`, 'SELECT * FROM c WHERE c.type = @type AND c.active = false AND c.status = @status', [p('type', 'notification-delivery'), p('status', status)]]),
            ...['github', 'linear', 'notion', 'slack', 'azure-devops'].flatMap(provider => [
                [`${provider}-backfill`, 'SELECT TOP 100 * FROM c WHERE c.type = @type AND c.backfillPending = true AND c.enabled = true AND c.status = \'connected\' ORDER BY c.id ASC', [p('type', `${provider}-connection`)]],
                [`${provider}-due`, 'SELECT TOP 100 * FROM c WHERE c.type = @type AND c.active = true AND c.nextAttemptAt <= @now ORDER BY c.nextAttemptAt ASC', [p('type', `${provider}-sync`), p('now', now)]],
                ...['failed', 'ambiguous'].map(status => [`${provider}-blocked-${status}`, 'SELECT TOP 1000 * FROM c WHERE c.type = @type AND c.active = false AND c.status = @status', [p('type', `${provider}-sync`), p('status', status)]])
            ])
        ]) await query(app, name, sql, params, pk);
        for (const type of ['notification-delivery', ...['github', 'linear', 'notion', 'slack', 'azure-devops'].map(p => `${p}-sync`)])
            for (const status of ['failed', 'ambiguous'])
                await query(app, `${type}-count-${status}-after`, 'SELECT VALUE COUNT(1) FROM c WHERE c.type = @type AND c.active = false AND c.status = @status', [p('type', type), p('status', status)]);
        await query(comments, 'notification-pending', 'SELECT * FROM c WHERE c.notificationPending = true AND IS_DEFINED(c.projectId) AND IS_DEFINED(c.path)');
        await query(comments, 'sync-pending', "SELECT TOP 100 * FROM c WHERE c.syncPending = true AND IS_DEFINED(c.projectId) AND IS_STRING(c.syncKey) AND (IS_DEFINED(c.path) OR c.type = 'tombstone') ORDER BY c.syncKey ASC");
        for (const c of [comments, db.container('comments-preview')])
            await query(c, 'legacy-images', "SELECT TOP 20 * FROM c WHERE c.type = 'screenshot' AND IS_STRING(c.data)");
        // Representative read-only interactive path. Keep identifiers/documents only in memory.
        const [member] = await query(app, 'sample-member', 'SELECT TOP 1 c.userId, c.workspaceId, c.id, c.pk FROM c WHERE c.type = \'member\' AND c.role = \'admin\'');
        if (member) {
            const point = async (operation, pk, id) => {
                budget(); const begin = performance.now();
                const response = await app.item(id, pk).read(); accountResponse(response);
                results.push({ operation, container: app.id, partition: 'single', ru: response.requestCharge, ms: Math.round(performance.now() - begin), rows: response.resource ? 1 : 0, pages: 0, queries: 0, pointOperations: 1 });
            };
            await point('interactive-user', `user:${member.userId}`, member.userId);
            await point('interactive-workspace', member.pk, member.workspaceId);
            await point('interactive-membership', member.pk, member.id);
            const [project] = await query(app, 'interactive-project-sample', "SELECT TOP 1 c.id FROM c WHERE c.type = 'project' AND c.pk = @pk", [p('pk', member.pk)], member.pk);
            if (project) {
                await point('interactive-project-reference', `project:${project.id}`, project.id);
                await point('interactive-project', member.pk, project.id);
                const domain = `project:${project.id}`;
                await query(comments, 'interactive-feedback', "SELECT TOP 1000 * FROM c WHERE c.domain = @domain AND IS_DEFINED(c.path) ORDER BY c.createdAt DESC", [p('domain', domain)], domain);
                const hash = value => createHash('sha256').update(value).digest('hex');
                const pk = `review-read:${hash(domain)}:${hash(`user:${member.userId}`)}`;
                await query(app, 'interactive-read-cursors', "SELECT * FROM c WHERE c.type = 'review-read' AND c.pk = @pk", [p('pk', pk)], pk);
            }
            await query(app, 'interactive-memberships', 'SELECT * FROM c WHERE c.type = \'member\' AND c.userId = @uid', [p('uid', member.userId)]);
            for (const type of ['project', 'member', 'team'])
                await query(app, `interactive-${type}-list`, 'SELECT * FROM c WHERE c.type = @type AND c.pk = @pk', [p('type', type), p('pk', member.pk)], member.pk);
        }
    } else if (mode === 'preview-idle') {
        const { build } = await import('esbuild');
        const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
        const cache = join(root, 'apps/web/node_modules/.cache');
        await mkdir(cache, { recursive: true });
        const temp = await mkdtemp(join(cache, 'cosmos-idle-'));
        try {
            for (const variant of ['before', 'after']) {
                phase = `idle-${variant}-build`;
                const outfile = join(temp, `${variant}.cjs`);
                await build({ entryPoints: [join(root, 'apps/web/scripts/cosmos-idle-profile.ts')], outfile, bundle: true,
                    platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'workspace-packages', setup(builder) {
                        builder.onResolve({ filter: /^@uier\// }, args => ({ path: createRequire(import.meta.url).resolve(args.path) }));
                    } }, ...(variant === 'before' ? [{ name: 'baseline-workers', setup(builder) {
                        builder.onLoad({ filter: /src\/lib\/(notifications\/delivery|integrations\/worker)\.ts$/ }, args => ({ loader: 'ts',
                            contents: execFileSync('git', ['show', `b1a89f6a9aa387868bb7645867ca14a228209925:${args.path.slice(root.length + 1)}`], { cwd: root, encoding: 'utf8' }) }));
                    } }] : [])] });
                phase = `idle-${variant}-load`;
                const { profileIdle } = createRequire(import.meta.url)(outfile);
                for (let repeat = 0; repeat < 3; repeat++) {
                    phase = `idle-${variant}-run`;
                    const measured = await profileIdle(app, `profile279:${randomUUID()}`);
                    const ru = measured.measurements.reduce((sum, m) => sum + m.requestCharge, 0);
                    totalRu += ru; requests += measured.measurements.length;
                    results.push({ operation: `idle-${variant}`, ru, ms: measured.durationMs,
                        queries: measured.measurements.filter(m => /app\.(query|count)\./.test(m.operation)).length,
                        pages: measured.measurements.reduce((sum, m) => sum + m.pages, 0),
                        rows: measured.measurements.reduce((sum, m) => sum + m.rows, 0),
                        retries: measured.measurements.reduce((sum, m) => sum + m.retries, 0),
                        throttles: measured.measurements.reduce((sum, m) => sum + m.throttles, 0),
                        measurements: measured.measurements });
                }
            }
        } finally { await rm(temp, { recursive: true, force: true }); }
    } else {
        const run = `profile279:${randomUUID()}`;
        const created = [];
        const add = async doc => {
            budget();
            if (app.id !== 'app-preview' || !doc.pk.startsWith(run)) throw new Error('Synthetic write guard rejected');
            // Register before the request: cleanup also handles an uncertain write result.
            created.push({ pk: doc.pk, id: doc.id });
            accountResponse(await app.items.create({ ...doc, profileRun: run, ttl: 3600 }));
        };
        try {
            for (let index = 0; index < 8; index++) await add({ type: 'workspace', pk: `${run}:workspace:${index}`, id: `workspace:${index}`, name: 'Synthetic workspace' });
            for (let index = 0; index < 12; index++) await add({ type: 'project', pk: `${run}:workspace:${index % 8}`, id: `project:${index}`, workspaceId: `workspace:${index % 8}`, name: 'Synthetic project' });
            for (let index = 0; index < 64; index++) await add({ type: 'profile-unrelated', pk: `${run}:workspace:${index}`, id: 'same-id', payload: 'x'.repeat(1024) });
            for (const size of [20, 1200]) {
                for (let index = size === 20 ? 0 : 20; index < size; index++) {
                    // Duplicate ids across different project partitions are intentional.
                    await add({ type: 'notification-delivery', pk: `${run}:notifications:${index % 12}`, id: `delivery:${Math.floor(index / 12)}`,
                        projectId: `synthetic:${index % 12}`, active: true, nextAttemptAt: index % 20 === 0 ? '2026-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z', payload: 'x'.repeat(2048) });
                    await add({ type: 'github-sync', pk: `${run}:github:${index % 12}`, id: `ledger:${Math.floor(index / 12)}`,
                        active: false, status: 'failed', payload: 'x'.repeat(2048) });
                }
                for (let repeat = 0; repeat < 3; repeat++) {
                    const filter = 'c.profileRun = @run'; const params = [p('run', run)];
                    const active = await query(app, `size-${size}.notification-before`, `SELECT * FROM c WHERE c.type = 'notification-delivery' AND c.active = true AND ${filter}`, params);
                    const due = await query(app, `size-${size}.notification-after`, `SELECT * FROM c WHERE c.type = 'notification-delivery' AND c.active = true AND c.nextAttemptAt <= @now AND ${filter}`, [...params, p('now', now)]);
                    if (due.length !== active.filter(d => d.nextAttemptAt <= now).length) throw new Error('Due filter mismatch');
                    await query(app, `size-${size}.blocked-before`, `SELECT TOP 1000 * FROM c WHERE c.type = 'github-sync' AND c.active = false AND c.status = 'failed' AND ${filter}`, params);
                    const count = await query(app, `size-${size}.blocked-after`, `SELECT VALUE COUNT(1) FROM c WHERE c.type = 'github-sync' AND c.active = false AND c.status = 'failed' AND ${filter}`, params);
                    if (count[0] !== size) throw new Error('Complete count mismatch');
                    for (const [name, pk] of [['cross', undefined], ['partition', `${run}:workspace:0`]])
                        await query(app, `size-${size}.known-${name}`, 'SELECT * FROM c WHERE c.type = \'profile-unrelated\' AND c.pk = @pk', [p('pk', `${run}:workspace:0`)], pk);
                }
            }
            let changed = false;
            await query(app, 'boundary-complete-list', "SELECT * FROM c WHERE c.type = 'notification-delivery' AND c.profileRun = @run", [p('run', run)], undefined, async page => {
                if (page !== 1 || changed) return;
                changed = true;
                // Delete a later row and make another future row due at a page boundary.
                accountResponse(await app.item('delivery:99', `${run}:notifications:11`).delete());
                accountResponse(await app.item('delivery:99', `${run}:notifications:10`).patch([{ op: 'replace', path: '/nextAttemptAt', value: now }]));
            });
            const nextTurn = await query(app, 'boundary-next-due-turn', "SELECT * FROM c WHERE c.type = 'notification-delivery' AND c.active = true AND c.nextAttemptAt <= @now AND c.profileRun = @run", [p('run', run), p('now', now)]);
            if (!changed || nextTurn.length !== 61 || !nextTurn.some(d => d.pk === `${run}:notifications:10` && d.id === 'delivery:99')
                || nextTurn.some(d => d.pk === `${run}:notifications:11` && d.id === 'delivery:99')) throw new Error('Boundary progress failed');
        } finally {
            // Only exact identities registered by this run. No global delete query.
            let failures = 0;
            for (const doc of created) {
                try { accountResponse(await app.item(doc.id, doc.pk).delete()); }
                catch (error) { accountResponse(error); if (error.code !== 404) failures++; }
            }
            if (failures) throw new Error(`Synthetic cleanup incomplete (${failures}); one-hour TTL remains`);
            const remaining = await query(app, 'cleanup-remaining', 'SELECT VALUE COUNT(1) FROM c WHERE c.profileRun = @run', [p('run', run)]);
            if (remaining[0] !== 0) throw new Error('Synthetic cleanup verification failed');
        }
    }
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(), mode, sdk: '4.10.1', totalRu, requests, results }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ phase, code: typeof error.code === 'number' || /^[A-Z_]{1,60}$/.test(error.code ?? '') ? error.code : undefined, error: error.constructor?.name, frames: error.stack?.split('\n').slice(1, 4).map(frame => frame.match(/(?:cosmos-idle-profile.ts|before.cjs|after.cjs|cosmos-query-profile.mjs):[0-9]+:[0-9]+/)?.[0]), totalRu, requests }));
    // SDK/CLI errors may contain credentials, SQL values or documents. Never dump them.
    console.error('Cosmos profile failed; inspect access/budgets without logging raw diagnostics.');
    process.exitCode = 1;
} finally { client.dispose(); }
