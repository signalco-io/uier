import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

const execute = promisify(execFile);
let directory: string;
let worker: string;

test.beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'uier-worker-test-'));
    worker = join(directory, 'worker.mjs');
    const modules: Record<string, string> = {
        '../src/lib/repo/commentsStore': 'export function getCommentsStore() { return { async migrateScreenshots() { console.log("CALL migrate production"); return {migrated:0,failed:0}; } }; }',
        '../src/lib/repo/cosmosCommentsStore': 'export function createCosmosCommentsStore() { return { async migrateScreenshots() { console.log("CALL migrate preview"); return {migrated:0,failed:0}; }, async sweepScreenshotBlobs() { console.log("CALL blobs"); return {removed:0,failed:0}; } }; }',
        '../src/lib/db/client': 'export function cosmosDataContainerComments() { return {database:{container(){return {};}}}; }',
        '../src/lib/screenshots/blobStore': 'export function getScreenshotBlobStore() { return {}; }',
        '../src/lib/comments/cleanup': 'export async function sweepCommentCleanup() { console.log("CALL cleanup"); return {removed:0,failed:0}; }',
        '../src/lib/app/projectDeletion': 'export async function sweepProjectDeletions() { console.log("CALL deletions"); return {failed:0}; }',
        '../src/lib/notifications/delivery': 'export async function retryNotificationDelivery() { console.log("CALL retry"); } export async function runNotificationWorker() { console.log("CALL email"); return {checked:0,blocked:0}; }',
        '../src/lib/app/deployment': 'export function configuredAppBaseUrl() { return "https://uier.io"; }',
        '../src/lib/integrations/worker': 'export async function runIntegrationWorker() { console.log("CALL integrations"); return {discovered:{checked:0,deferred:0},providers:[],blocked:0}; }'
    };
    await build({ entryPoints: [resolve('scripts/notifications-worker.ts')], outfile: worker, bundle: true,
        platform: 'node', format: 'esm', plugins: [{ name: 'isolated-transports', setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(modules, args.path)
                ? { path: args.path, namespace: 'worker-test' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'worker-test' }, args => ({ contents: modules[args.path], loader: 'js' }));
        } }] });
});
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

async function run(integrationsOnly: boolean, retry = '', overrides: Record<string, string> = {}) {
    return execute(process.execPath, [worker], { env: { ...process.env, UIER_DEPLOYMENT_ENV: 'production',
        COSMOSDB_CONNECTION_STRING: 'isolated-test', UIER_COMMENTS_SECRET: 'isolated-test-signing-key-with-32-characters',
        ACS_CONNECTION_STRING: 'isolated-test', UIER_EMAIL_SENDER: 'donotreply@isolated.test',
        UIER_INTEGRATIONS_ONLY: integrationsOnly ? '1' : '0', UIER_NOTIFICATION_RETRY_DELIVERY: retry, ...overrides } });
}

test('integration-only runs do not invoke email discovery, sending or retry', async () => {
    const result = await run(true);
    expect(result.stdout).toContain('CALL integrations');
    expect(result.stdout).not.toMatch(/CALL email|CALL retry|CALL cleanup|CALL deletions|CALL migrate|CALL blobs/);
});

test('normal scheduled runs retain email retries and integration delivery', async () => {
    const result = await run(false, 'isolated-delivery');
    expect(result.stdout).toContain('CALL migrate production');
    expect(result.stdout).toContain('CALL migrate preview');
    expect(result.stdout).toContain('CALL blobs');
    // Project deletions queue thread cleanups that the comment sweep then completes
    expect(result.stdout).toMatch(/CALL deletions[\s\S]*CALL cleanup/);
    expect(result.stdout).toContain('CALL retry');
    expect(result.stdout).toContain('CALL email');
    expect(result.stdout).toContain('CALL integrations');
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
