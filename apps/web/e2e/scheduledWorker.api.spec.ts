import { expect, test } from '@playwright/test';
import { createMemoryAppStore } from '../src/lib/app/store';
import { acquireWorkerLease, releaseWorkerLease, WORKER_BUDGET_MS, WORKER_LEASE_MS } from '../src/lib/worker/lease';
import { assertWorkerEnvironment, runScheduledWorker } from '../src/lib/worker/run';
import { vercelAzureAssertion, withWorkerRequest } from '../src/lib/worker/oidc';

test.beforeEach(async () => { await createMemoryAppStore().delete('worker:review-notifications', 'review-notifications'); });

const baseEnvironment = { UIER_DEPLOYMENT_ENV: 'production', COSMOSDB_ENDPOINT: 'https://fixture.documents.azure.com/',
    UIER_COMMENTS_SECRET: 'fixture', AZURE_TENANT_ID: 'fixture-tenant', AZURE_CLIENT_ID: 'fixture-client',
    COSMOSDB_APP_CONTAINER: 'app', COSMOSDB_COMMENTS_CONTAINER: 'comments', AZURE_SCREENSHOTS_CONTAINER: 'screenshots' };

test('native scheduled worker accepts only the production configuration without expanding preview permissions', () => {
    expect(() => assertWorkerEnvironment('vercel', baseEnvironment)).not.toThrow();
    expect(() => assertWorkerEnvironment('vercel', { ...baseEnvironment, AZURE_SCREENSHOTS_CONNECTION_STRING: 'existing-app-key' })).not.toThrow();
    for (const extra of [{ UIER_DEPLOYMENT_ENV: 'preview' }, { VERCEL_ENV: 'preview' }, { COSMOSDB_COMMENTS_CONTAINER: 'comments-preview' },
        { COSMOSDB_APP_CONTAINER: 'app-preview' }, { AZURE_SCREENSHOTS_CONTAINER: 'screenshots-preview' },
        { GITHUB_ACTIONS: 'true' }, { UIER_AZURE_AUTH_MODE: 'github-actions' },
        { COSMOSDB_CONNECTION_STRING: 'forbidden' }, { AZURE_CLIENT_ID: '' }])
        expect(() => assertWorkerEnvironment('vercel', { ...baseEnvironment, ...extra })).toThrow('production deployment configuration');
    expect(() => assertWorkerEnvironment('github-actions', { ...baseEnvironment, GITHUB_ACTIONS: 'true', UIER_AZURE_AUTH_MODE: 'github-actions' })).not.toThrow();
    expect(() => assertWorkerEnvironment('github-actions', { ...baseEnvironment, GITHUB_ACTIONS: 'true', UIER_AZURE_AUTH_MODE: 'github-actions',
        AZURE_SCREENSHOTS_CONNECTION_STRING: 'forbidden' })).toThrow('production deployment configuration');
});

test('overlapping hosts acquire one lease and an expired owner cannot clear its successor', async () => {
    const store = createMemoryAppStore(), now = Date.now();
    const attempts = await Promise.all(Array.from({ length: 12 }, () => acquireWorkerLease(store, now)));
    const held = attempts.filter(value => value !== null);
    expect(held).toHaveLength(1);
    const old = held[0]!;
    expect(old.until).toBe(now + WORKER_LEASE_MS);
    expect(await acquireWorkerLease(store, now + WORKER_LEASE_MS - 1)).toBeNull();
    const successor = (await acquireWorkerLease(store, now + WORKER_LEASE_MS))!;
    expect(successor.owner).not.toBe(old.owner);
    await releaseWorkerLease(old.owner, store, now + WORKER_LEASE_MS + 1);
    expect(await acquireWorkerLease(store, now + WORKER_LEASE_MS + 2)).toBeNull();
    await releaseWorkerLease(successor.owner, store, now + WORKER_LEASE_MS + 3);
    expect(await acquireWorkerLease(store, now + WORKER_LEASE_MS + 4)).not.toBeNull();
});

test('worker verification is read-only and a busy run never starts a mutation phase', async () => {
    const before = process.env.UIER_BASE_URL;
    process.env.UIER_BASE_URL = 'https://uier.io';
    try {
        const store = createMemoryAppStore(), calls: string[] = [];
        const dependencies = { store, verify: async (preview: boolean) => { calls.push(preview ? 'verify-preview' : 'verify-production'); },
            phases: [{ name: 'write', run: async () => { calls.push('write'); } }] };
        expect((await runScheduledWorker({ verifyOnly: true }, dependencies)).status).toBe('verified');
        expect(calls).toEqual(['verify-production']);
        // Verification did not create a lease or invoke any mutation.
        expect(await store.query({ type: 'worker-lease' })).toEqual([]);
        await acquireWorkerLease(store);
        expect((await runScheduledWorker({}, dependencies)).status).toBe('busy');
        expect(calls).toEqual(['verify-production', 'verify-production']);
        await expect(runScheduledWorker({ integrationsOnly: true, retryDelivery: 'delivery' }, dependencies)).rejects.toThrow('cannot retry');
        expect(calls).toHaveLength(2);
    } finally { if (before === undefined) delete process.env.UIER_BASE_URL; else process.env.UIER_BASE_URL = before; }
});

test('worker awaits failures, preserves lease while a phase is in flight and defers later work at its deadline', async () => {
    const before = process.env.UIER_BASE_URL;
    process.env.UIER_BASE_URL = 'https://uier.io';
    try {
        const store = createMemoryAppStore();
        let now = Date.now(), release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const phases: string[] = [];
        const running = runScheduledWorker({}, { store, now: () => now, verify: async () => {}, phases: [
            { name: 'first', run: async deadline => { phases.push('first'); expect(deadline).toBe(now + WORKER_BUDGET_MS); await pending; now += WORKER_BUDGET_MS; throw new Error('never logged content'); } },
            { name: 'later', run: async () => { phases.push('later'); } }
        ] });
        await new Promise(resolve => setImmediate(resolve));
        expect(await acquireWorkerLease(store, now + 5 * 60_000)).toBeNull();
        release();
        const result = await running;
        expect(result).toEqual({ status: 'deferred', failed: 1, phases: ['first'] });
        expect(phases).toEqual(['first']);
        expect(await acquireWorkerLease(store, now + 1)).not.toBeNull();
    } finally { if (before === undefined) delete process.env.UIER_BASE_URL; else process.env.UIER_BASE_URL = before; }
});

test('concurrent private invocations retain their own Azure assertions without mutating process environment', async () => {
    const original = process.env.VERCEL_OIDC_TOKEN;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const first = withWorkerRequest(new Request('https://private.invalid/', { headers: { 'x-vercel-oidc-token': 'first-fixture-assertion' } }), async () => {
        await pending;
        return vercelAzureAssertion();
    });
    const second = withWorkerRequest(new Request('https://private.invalid/', { headers: { 'x-vercel-oidc-token': 'second-fixture-assertion' } }), async () => {
        release();
        await new Promise(resolve => setImmediate(resolve));
        return vercelAzureAssertion();
    });
    expect(await Promise.all([first, second])).toEqual(['first-fixture-assertion', 'second-fixture-assertion']);
    expect(process.env.VERCEL_OIDC_TOKEN).toBe(original);
});
