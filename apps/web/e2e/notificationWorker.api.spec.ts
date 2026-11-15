import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

const execute = promisify(execFile);
let directory: string;
let worker: string;
let nativeWorker: string;

test.beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'uier-worker-test-'));
    worker = join(directory, 'worker.mjs');
    nativeWorker = join(directory, 'scheduled-worker.mjs');
    const modules: Record<string, string> = {
        '../src/lib/app/store': `const docs = new Map(); let version = 0;
            const store = { async get(pk,id) { return docs.get(pk+":"+id) ?? null; },
                async create(doc) { const key=doc.pk+":"+doc.id; if(docs.has(key)) return false; docs.set(key,{doc,etag:String(++version)}); return true; },
                async replace(doc,etag) { const key=doc.pk+":"+doc.id; if(docs.get(key)?.etag!==etag) return "conflict"; docs.set(key,{doc,etag:String(++version)}); return "ok"; } };
            export function getAppStore() { return store; }`,
        '../src/lib/repo/commentsStore': 'export function getCommentsStore() { return { async migrateScreenshots() { console.log("CALL migrate production"); return {migrated:0,failed:0}; } }; }',
        '../src/lib/repo/cosmosCommentsStore': 'export function createCosmosCommentsStore() { return { async migrateScreenshots() { console.log("CALL migrate preview"); return {migrated:0,failed:0}; }, async sweepScreenshotBlobs() { console.log("CALL blobs"); return {removed:0,failed:0}; } }; }',
        "../src/lib/db/client": `function item() { return { async read() { console.log("PROBE cosmos"); if (process.env.UIER_WORKER_TEST_ACCESS_FAILURE === "1") throw new Error("isolated access denied"); throw {code:404}; } }; }
            export function cosmosDataContainerComments() { return {item,database:{container(){return {item};}}}; }
            export function cosmosDataContainerApp() { return {item}; }`,
        '../src/lib/screenshots/blobStore': 'export function getScreenshotBlobStore() { return {async listBefore(){ console.log("PROBE blobs"); return {items:[]}; }}; }',
        '../src/lib/recordings/blobStore': 'export function getRecordingBlobs() { return {}; }',
        '../src/lib/recordings/service': 'export async function sweepRecordings(_store, _blobs, environment) { console.log("CALL recordings " + environment); return {removed:0,failed:process.env.UIER_WORKER_TEST_RECORDING_FAILURE === "1" ? 1 : 0}; }',
        '../src/lib/comments/cleanup': 'export async function sweepCommentCleanup() { console.log("CALL cleanup"); return {removed:0,failed:0}; }',
        '../src/lib/app/projectDeletion': 'export async function sweepProjectDeletions() { console.log("CALL deletions"); return {failed:0}; }',
        '../src/lib/app/projectTransfer': 'export async function sweepProjectTransfers() { console.log("CALL transfers"); return {failed:0}; }',
        '../src/lib/notifications/delivery': 'export async function retryNotificationDelivery() { console.log("CALL retry"); } export async function runNotificationWorker() { console.log("CALL email"); return JSON.parse(process.env.UIER_WORKER_TEST_DELIVERY || \'{"checked":0,"failed":0,"blocked":0,"review":[]}\'); }',
        '../src/lib/app/deployment': 'export function configuredAppBaseUrl() { return "https://uier.io"; }',
        '../src/lib/integrations/worker': 'export async function runIntegrationWorker() { console.log("CALL integrations"); return {discovered:{checked:0,deferred:0},providers:[],blocked:0}; }',
        '../src/lib/mcp/events/delivery': 'export async function runMcpEventWorker() { console.log("CALL mcp-events"); if (process.env.UIER_WORKER_TEST_EVENTS_FAILURE === "1") throw new TypeError("isolated event endpoint detail"); return {projects:1,discovered:2,delivered:1,retrying:1,failed:0,skipped:0,terminated:0,deferred:0}; }'
    };
    const resolvedModules = new Map(Object.entries(modules).map(([path, contents]) => [resolve('scripts', path), { path, contents }]));
    await build({ entryPoints: [resolve('scripts/notifications-worker.ts')], outfile: worker, bundle: true,
        platform: 'node', format: 'esm', plugins: [{ name: 'isolated-transports', setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => {
                const mock = args.path.startsWith('.') ? resolvedModules.get(resolve(args.resolveDir, args.path)) : undefined;
                return mock ? { path: mock.path, namespace: 'worker-test' } : undefined;
            });
            builder.onLoad({ filter: /.*/, namespace: 'worker-test' }, args => ({ contents: modules[args.path], loader: 'js' }));
        } }] });
    await build({ entryPoints: [resolve('scripts/scheduled-worker.ts')], outfile: nativeWorker, bundle: true,
        platform: 'node', format: 'esm',
        banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
        plugins: [{ name: 'native-runner', setup(builder) {
            builder.onResolve({ filter: /worker\/run$/ }, args => args.importer.endsWith('/scripts/scheduled-worker.ts')
                ? { path: 'runner', namespace: 'native-test' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'native-test' }, () => ({ loader: 'js', resolveDir: resolve('.'), contents:
                `export {assertWorkerEnvironment} from ${JSON.stringify(resolve('src/lib/worker/run.ts'))};
                export async function runScheduledWorker(options) { console.log("NATIVE RUN " + JSON.stringify(options ?? {}));
                    if (process.env.UIER_WORKER_TEST_RUN_FAILURE === "1") throw new Error("fixture-private-provider-detail");
                    return {status:"completed",failed:0,phases:[]}; }` }));
        } }] });
});
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

async function run(integrationsOnly: boolean, retry = '', overrides: Record<string, string> = {}) {
    return execute(process.execPath, [worker], { env: { ...process.env, UIER_DEPLOYMENT_ENV: 'production',
        GITHUB_ACTIONS: 'true', UIER_AZURE_AUTH_MODE: 'github-actions',
        COSMOSDB_ENDPOINT: 'https://isolated-test.documents.azure.com/',
        COSMOSDB_CONNECTION_STRING: '', AZURE_SCREENSHOTS_CONNECTION_STRING: '', UIER_WORKER_VERIFY_ONLY: '0', UIER_COMMENTS_SECRET: 'isolated-test-signing-key-with-32-characters',
        ACS_CONNECTION_STRING: 'isolated-test', UIER_EMAIL_SENDER: 'donotreply@isolated.test',
        UIER_INTEGRATIONS_ONLY: integrationsOnly ? '1' : '0', UIER_NOTIFICATION_RETRY_DELIVERY: retry, ...overrides } });
}

test('integration-only runs do not invoke email discovery, sending or retry', async () => {
    const result = await run(true);
    expect(result.stdout).toContain('CALL integrations');
    // MCP event webhooks are not email: they are delivered on integration-only runs too.
    expect(result.stdout).toContain('CALL mcp-events');
    expect(result.stdout).not.toMatch(/CALL email|CALL retry|CALL cleanup|CALL deletions|CALL transfers|CALL migrate|CALL blobs|CALL recordings/);
});

test('normal scheduled runs retain email retries and integration delivery', async () => {
    const result = await run(false, 'isolated-delivery');
    expect(result.stdout).toContain('CALL migrate production');
    expect(result.stdout).toContain('CALL migrate preview');
    expect(result.stdout).toContain('CALL blobs');
    expect(result.stdout).toContain('CALL recordings preview');
    expect(result.stdout).toContain('CALL recordings production');
    // Project deletions queue thread cleanups that the comment sweep then completes
    expect(result.stdout).toMatch(/CALL deletions[\s\S]*CALL transfers[\s\S]*CALL cleanup/);
    expect(result.stdout).toContain('CALL retry');
    expect(result.stdout).toContain('CALL email');
    // Events imported by integrations this run are delivered in the same run.
    expect(result.stdout).toMatch(/CALL integrations[\s\S]*CALL mcp-events/);
    expect(result.stdout).toContain('[mcp-events] 1 projects: 2 new deliveries, 1 delivered, 1 retrying, 0 failed, 0 skipped, 0 subscriptions ended; 0 projects deferred.');
});

test('a failed recording cleanup fails the scheduled run while keeping delivery work', async () => {
    await expect(run(false, '', { UIER_WORKER_TEST_RECORDING_FAILURE: '1' })).rejects.toMatchObject({
        code: 1,
        stdout: expect.stringMatching(/CALL recordings preview[\s\S]*CALL recordings production[\s\S]*CALL email[\s\S]*CALL integrations/)
    });
});

test('a failing MCP event sweep fails the run after the other work, logging only the error class', async () => {
    await expect(run(false, '', { UIER_WORKER_TEST_EVENTS_FAILURE: '1' })).rejects.toMatchObject({ code: 1,
        stdout: expect.stringMatching(/CALL email[\s\S]*CALL integrations[\s\S]*CALL mcp-events/),
        stderr: expect.stringContaining('[mcp-events] Event delivery needs retry (TypeError).') });
    await expect(run(false, '', { UIER_WORKER_TEST_EVENTS_FAILURE: '1' })).rejects.toMatchObject({ stderr: expect.not.stringContaining('isolated event endpoint detail') });
});

test('a run without email settings leaves deliveries untouched, keeps other work and fails', async () => {
    try {
        await run(false, 'isolated-delivery', { ACS_CONNECTION_STRING: '' });
        throw new Error('Expected the worker to fail without email settings');
    } catch (error) {
        const result = error as Error & { stdout?: string; stderr?: string };
        expect(result.stderr).toContain('Email is not configured (ACS_CONNECTION_STRING, UIER_EMAIL_SENDER); delivery skipped.');
        expect(result.stdout).not.toMatch(/CALL email|CALL retry/);
        expect(result.stdout).toContain('CALL cleanup');
        expect(result.stdout).toContain('CALL integrations');
    }
});

test('ledgers waiting for review are named for retry_delivery without failing every later run', async () => {
    const id = `delivery_${'1'.repeat(64)}`;
    const result = await run(false, '', { UIER_WORKER_TEST_DELIVERY: JSON.stringify({ checked: 3, failed: 0, blocked: 2,
        review: [{ id, status: 'failed', lastCode: 'EmailNotConfiguredError' }, { id: `delivery_${'a'.repeat(64)}`, status: 'ambiguous', lastCode: 'operation_unknown' }] }) });
    expect(result.stdout).toContain('[notifications] Checked 3 delivery ledgers; 0 attempts failed; 2 require review.');
    expect(result.stdout).toContain(`::warning title=Notification delivery needs review::${id} is failed (EmailNotConfiguredError). After fixing the cause, run this workflow with retry_delivery set to this id.`);
    expect(result.stdout).toContain(`delivery_${'a'.repeat(64)} is ambiguous (operation_unknown)`);
    expect(result.stdout).toContain('CALL integrations');
});

test('a failed delivery attempt in this run fails the run after the remaining work', async () => {
    await expect(run(false, '', { UIER_WORKER_TEST_DELIVERY: JSON.stringify({ checked: 2, failed: 1, blocked: 0, review: [] }) }))
        .rejects.toMatchObject({ code: 1, stdout: expect.stringMatching(/1 attempts failed; 0 require review\.[\s\S]*CALL integrations/) });
});

test('an integration-only run with an email retry fails before any work', async () => {
    try {
        await run(true, 'isolated-delivery');
        throw new Error('Expected the worker to reject incompatible options');
    } catch (error) {
        const result = error as Error & { stdout?: string; stderr?: string };
        expect(result.stderr).toContain('An integration-only run cannot retry an email delivery.');
        expect(result.stdout).not.toContain('CALL ');
    }
});

test('verification-only validates every data scope without invoking delivery, cleanup or integrations', async () => {
    const result = await run(false, '', { UIER_WORKER_VERIFY_ONLY: '1' });
    expect(result.stdout.match(/PROBE cosmos/g)).toHaveLength(3);
    expect(result.stdout.match(/PROBE blobs/g)).toHaveLength(2);
    expect(result.stdout).toContain('Azure OIDC data access verified');
    expect(result.stdout).not.toContain('CALL ');
});

test('a failed data probe stops the worker before any mutation or transport', async () => {
    await expect(run(false, '', { UIER_WORKER_TEST_ACCESS_FAILURE: '1' })).rejects.toMatchObject({
        stderr: expect.stringContaining('isolated access denied'),
        stdout: expect.not.stringContaining('CALL '),
    });
});

test('account keys and non-Actions contexts are refused before probing or processing', async () => {
    const cases: Record<string, string>[] = [{ COSMOSDB_CONNECTION_STRING: 'forbidden-account-key' },
        { AZURE_SCREENSHOTS_CONNECTION_STRING: 'forbidden-account-key' }, { GITHUB_ACTIONS: 'false' }];
    for (const overrides of cases) {
        await expect(run(false, '', overrides)).rejects.toMatchObject({
            stderr: expect.stringContaining('requires the production deployment configuration'),
            stdout: expect.not.stringContaining('PROBE '),
        });
    }
});

test('private native CloudEvents accept only the fixed static production schedule and ignore recovery payloads', async () => {
    const headers = { 'ce-specversion': '1.0', 'ce-type': 'com.vercel.schedule.v1beta', 'ce-source': '/fixture',
        'ce-id': 'fixture-execution', 'ce-vssscheduleid': 'fixture-schedule', 'ce-vssschedulename': 'review-notifications',
        'ce-vssnamespace': 'default', 'ce-vssscheduledat': '2026-11-15T12:00:00Z', 'ce-vssschedulesource': 'static',
        'ce-vssexpression': '*/5 * * * *' };
    const env: NodeJS.ProcessEnv = { ...process.env, UIER_DEPLOYMENT_ENV: 'production', VERCEL_ENV: '', GITHUB_ACTIONS: '', UIER_AZURE_AUTH_MODE: '',
        COSMOSDB_ENDPOINT: 'https://isolated-test.documents.azure.com/', COSMOSDB_CONNECTION_STRING: '',
        UIER_COMMENTS_SECRET: 'fixture', AZURE_TENANT_ID: 'fixture-tenant', AZURE_CLIENT_ID: 'fixture-client',
        COSMOSDB_APP_CONTAINER: 'app', COSMOSDB_COMMENTS_CONTAINER: 'comments', AZURE_SCREENSHOTS_CONTAINER: 'screenshots' };
    const invoke = (extra: Record<string, string> = {}, config = env) => execute(process.execPath, ['--input-type=module', '-e',
        `import handler from ${JSON.stringify(pathToFileURL(nativeWorker).href)};
         const response = await handler.fetch(new Request('https://private.invalid/?previewMaintenance=true', {
           method:'POST', headers:${JSON.stringify({ ...headers, ...extra })},
           body:JSON.stringify({previewMaintenance:true, retryDelivery:'not-authorized', integrationsOnly:true}) }));
         console.log('HTTP '+response.status);`], { env: config });
    const valid = await invoke();
    expect(valid.stdout).toContain('NATIVE RUN {}');
    expect(valid.stdout).toContain('HTTP 200');
    const refusedMetadata: Record<string, string>[] = [{ 'ce-vssnamespace': 'production' },
        { 'ce-vssschedulename': 'unexpected' }, { 'ce-vssschedulesource': 'dynamic' }];
    for (const extra of refusedMetadata)
        await expect(invoke(extra)).rejects.toMatchObject({ stdout: expect.not.stringContaining('NATIVE RUN'),
            stderr: expect.stringContaining('Unexpected worker schedule') });
    const malformed = await invoke({ 'ce-type': 'wrong' });
    expect(malformed.stdout).toContain('HTTP 400');
    expect(malformed.stdout).not.toContain('NATIVE RUN');
    await expect(invoke({}, { ...env, UIER_DEPLOYMENT_ENV: 'preview' })).rejects.toMatchObject({
        stdout: expect.not.stringContaining('NATIVE RUN'), stderr: expect.stringContaining('production deployment configuration') });
    const failure = await invoke({}, { ...env, UIER_WORKER_TEST_RUN_FAILURE: '1' }).catch(error => error as { stdout: string; stderr: string });
    expect(failure.stderr).toContain('The scheduled worker needs retry.');
    expect(failure.stdout + failure.stderr).not.toContain('fixture-private-provider-detail');
    expect(failure.stderr).toContain('"errorClass":"Error"');
});
