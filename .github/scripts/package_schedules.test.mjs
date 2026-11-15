import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packageSchedules, workerFunction, workerHandler, workerSchedule } from './package_schedules.mjs';
import { packagePrebuilt } from './package_prebuilt.mjs';

async function fixture(t, config = { version: 3, routes: [{ src: '/existing', dest: '/api/existing' }] }) {
    const root = await mkdtemp(join(tmpdir(), 'uier-schedules-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, '.vercel/output/functions'), { recursive: true });
    await writeFile(join(root, '.vercel/output/config.json'), JSON.stringify(config));
    return { root, config: async () => JSON.parse(await readFile(join(root, '.vercel/output/config.json'), 'utf8')),
        functionConfig: join(root, '.vercel/output/functions', `${workerFunction}.func/.vc-config.json`) };
}

test('production artifact declares one private native schedule and retains its complete dependency closure', async t => {
    const f = await fixture(t);
    const files = [workerHandler, 'apps/web/node_modules/fixture/index.js'];
    for (const file of files) {
        await mkdir(join(f.root, file, '..'), { recursive: true });
        await writeFile(join(f.root, file), 'export default {};');
    }
    const result = await packageSchedules(f.root, { production: true, build: async root => {
        assert.equal(root, f.root);
        return files;
    } });
    assert.deepEqual(result, { production: true, files: files.length });
    const config = await f.config();
    assert.deepEqual(config.routes, [{ src: '/existing', dest: '/api/existing' }]);
    assert.deepEqual(config.schedules, { 'review-notifications': workerSchedule });
    assert.equal(config.schedules['review-notifications'].schedule, '*/5 * * * *');
    assert.equal('path' in config.schedules['review-notifications'], false);
    const fn = JSON.parse(await readFile(f.functionConfig, 'utf8'));
    assert.deepEqual(fn.experimentalTriggers, [{ type: 'schedule/v1beta' }]);
    assert.equal(fn.runtime, 'nodejs26.x');
    assert.equal(fn.maxDuration, 800);
    assert.equal(fn.handler, workerHandler);
    assert.equal('environment' in fn, false);
    assert.deepEqual(fn.filePathMap, Object.fromEntries(files.map(file => [file, file])));
    // The common packager must keep this worker runnable after the checkout is discarded.
    await packagePrebuilt(f.root);
    for (const source of Object.values(JSON.parse(await readFile(f.functionConfig, 'utf8')).filePathMap))
        assert.equal(existsSync(join(f.root, source)), true);
});

test('preview packaging removes a cached production schedule and worker without building one', async t => {
    const f = await fixture(t, { version: 3, schedules: { 'review-notifications': workerSchedule } });
    await mkdir(join(f.functionConfig, '..'), { recursive: true });
    await writeFile(f.functionConfig, '{}');
    await packageSchedules(f.root, { production: false, build: () => { throw new Error('Preview must not build a worker.'); } });
    assert.equal('schedules' in await f.config(), false);
    assert.equal(existsSync(f.functionConfig), false);
});

test('preview rejects other schedule/cron definitions rather than activating background production work', async t => {
    for (const configuration of [
        { schedules: { unexpected: workerSchedule } },
        { crons: [{ path: '/api/legacy-worker', schedule: '*/5 * * * *' }] }
    ]) {
        const f = await fixture(t, { version: 3, ...configuration });
        await assert.rejects(packageSchedules(f.root), /Preview output must not declare/);
    }
});

test('production rejects duplicate schedules and legacy cron definitions', async t => {
    for (const configuration of [
        { schedules: { 'review-notifications': workerSchedule } },
        { crons: [{ path: '/api/legacy-worker', schedule: '*/5 * * * *' }] }
    ]) {
        const f = await fixture(t, { version: 3, ...configuration });
        await assert.rejects(packageSchedules(f.root, { production: true }), /already declared/);
    }
});

test('missing handlers, escaped paths and environment files cannot enter the scheduled artifact', async t => {
    for (const file of [null, '../secret', '/etc/passwd', 'apps/web/.env.local', 'apps/web/../secret', 'apps\\web\\secret']) {
        const f = await fixture(t);
        const files = file === null ? ['apps/web/something-else.mjs'] : [workerHandler, file];
        await assert.rejects(packageSchedules(f.root, { production: true, build: async () => files }),
            /handler is missing|Invalid scheduled worker dependency/);
        assert.equal(existsSync(f.functionConfig), false);
    }
});

test('worker cutover keeps manual recovery, bounded runtime, and credential-free schedule packaging', async () => {
    const notifications = await readFile(new URL('../workflows/notifications.yml', import.meta.url), 'utf8');
    assert.doesNotMatch(notifications, /^  schedule:/m);
    assert.match(notifications, /^  workflow_dispatch:/m);
    for (const input of ['retry_delivery', 'integrations_only', 'verify_only']) assert.match(notifications, new RegExp(`^      ${input}:`, 'm'));
    assert.match(notifications, /environment: production-worker/);
    assert.match(notifications, /timeout-minutes: 13/);
    const build = await readFile(new URL('../workflows/vercel-build_reusable.yml', import.meta.url), 'utf8');
    assert.match(build, /vercel" build --prod\n\s+node \.github\/scripts\/package_schedules\.mjs --production/);
    assert.match(build, /vercel" build\n\s+node \.github\/scripts\/package_schedules\.mjs --preview/);
    assert.ok(build.indexOf('package_schedules.mjs --production') < build.indexOf('package_prebuilt.mjs'));
    const deploy = await readFile(new URL('../workflows/vercel-deploy_reusable.yml', import.meta.url), 'utf8');
    assert.doesNotMatch(deploy, /package_schedules/);
});
