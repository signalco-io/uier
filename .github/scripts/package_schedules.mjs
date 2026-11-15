import { cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const workerFunction = '_uier/worker';
export const workerHandler = 'apps/web/.next/scheduled-entry/index.mjs';
export const workerSchedule = Object.freeze({ schedule: '*/5 * * * *', timezone: 'UTC', jitter: 1, function: workerFunction });
const scheduleName = 'review-notifications';

function dependencyPath(value) {
    if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\')
        || value.split('/').some(part => !part || part === '.' || part === '..' || part === '.env' || part.startsWith('.env.')))
        throw new Error('Invalid scheduled worker dependency path.');
    return value;
}

async function buildWorker(root) {
    const require = createRequire(join(root, 'apps/web/package.json'));
    const { build } = require('esbuild');
    const entry = join(root, workerHandler);
    await rm(dirname(entry), { recursive: true, force: true });
    await mkdir(dirname(entry), { recursive: true });
    await build({ entryPoints: [join(root, 'apps/web/scripts/scheduled-worker.ts')], outfile: entry,
        bundle: true, platform: 'node', format: 'esm', external: ['@azure/*', '@vercel/*', 'next/*', 'sharp'],
        banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
    const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft');
    const { fileList, warnings } = await nodeFileTrace([entry], { base: root, processCwd: join(root, 'apps/web') });
    // Match the standalone worker's native/optional binary handling. The current-platform sharp
    // package must load, and every other unresolved dependency remains a build error.
    const unexpected = [...warnings].filter(warning => !/^Failed to resolve dependency "@img\/sharp-/.test(warning.message)
        && !/^Failed to parse .*\/(?:open\/xdg-open|@img\/sharp-libvips-[^/]+\/lib\/[^/]+\.(?:dylib|so[^/]*)) as /.test(warning.message));
    if (unexpected.length) throw new Error(`The scheduled worker dependency trace is incomplete: ${unexpected[0].message}`);
    require('sharp');
    return [...fileList].map(dependencyPath);
}

// Framework output, not apps/web/vercel.json, is what the credential-free CI build uploads.
// The function has only a native schedule trigger: no public route, rewrite or cron secret.
export async function packageSchedules(directory, { production = false, build = buildWorker } = {}) {
    const root = resolve(directory);
    const output = join(root, '.vercel/output');
    const configFile = join(output, 'config.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    if (config.version !== 3) throw new Error('Schedules require Build Output API version 3.');
    const functionDirectory = join(output, 'functions', `${workerFunction}.func`);
    if (!production) {
        // A reused build directory must not leak a production worker into a preview deployment.
        await rm(functionDirectory, { recursive: true, force: true });
        if (config.schedules) {
            delete config.schedules[scheduleName];
            if (Object.keys(config.schedules).length) throw new Error('Preview output must not declare schedules.');
            delete config.schedules;
        }
        if (config.crons?.length) throw new Error('Preview output must not declare cron jobs.');
        await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
        return { production: false, files: 0 };
    }
    if (config.schedules?.[scheduleName] || config.crons?.length)
        throw new Error('The production worker schedule is already declared.');
    const files = await build(root);
    if (!files.includes(workerHandler)) throw new Error('The scheduled worker handler is missing from its trace.');
    // package_prebuilt.mjs moves this complete trace closure inside the artifact, just as it
    // does for Next functions. Preserve app-relative paths so pnpm symlinks keep resolving.
    const filePathMap = Object.fromEntries(files.map(name => [dependencyPath(name), dependencyPath(name)]));
    await mkdir(functionDirectory, { recursive: true });
    await writeFile(join(functionDirectory, '.vc-config.json'), `${JSON.stringify({
        runtime: 'nodejs26.x', handler: workerHandler, launcherType: 'Nodejs', maxDuration: 800,
        experimentalTriggers: [{ type: 'schedule/v1beta' }], filePathMap
    }, null, 2)}\n`);
    config.schedules = { ...config.schedules, [scheduleName]: workerSchedule };
    await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
    return { production: true, files: files.length };
}

// CI verifies the production closure even though PR deployments deliberately omit the worker.
// Import an isolated copy with no production environment and reject a non-schedule Request;
// this checks the SDK/runtime export without obtaining credentials or doing any worker work.
export async function verifyScheduledWorker(directory) {
    const root = resolve(directory);
    const files = await buildWorker(root);
    const isolated = await mkdtemp(join(tmpdir(), 'uier-scheduled-worker-'));
    try {
        const links = [];
        for (const name of files) {
            dependencyPath(name);
            const source = join(root, name), target = join(isolated, name);
            const resolved = relative(root, await realpath(source));
            if (isAbsolute(resolved) || resolved === '..' || resolved.startsWith('../'))
                throw new Error('Scheduled worker dependency leaves the checkout.');
            const stat = await lstat(source);
            if (stat.isSymbolicLink()) { links.push([source, target]); continue; }
            await mkdir(dirname(target), { recursive: true });
            await cp(source, target);
        }
        for (const [source, target] of links) {
            const link = await readlink(source);
            if (isAbsolute(link) || relative(root, resolve(dirname(source), link)).startsWith('..'))
                throw new Error('Scheduled worker link leaves the package.');
            await mkdir(dirname(target), { recursive: true });
            await symlink(link, target);
        }
        const result = spawnSync(process.execPath, ['--input-type=module', '-e',
            'const worker = await import(process.argv[1]); if (typeof worker.default?.fetch !== "function") process.exit(1); const response = await worker.default.fetch(new Request("https://worker.invalid/", {method:"POST"})); if (response.status !== 400) process.exit(1);',
            pathToFileURL(join(isolated, workerHandler)).href],
        { cwd: isolated, env: { PATH: process.env.PATH }, encoding: 'utf8' });
        if (result.status !== 0) throw new Error('The isolated scheduled worker did not load and reject a non-schedule request.');
        console.info(`Scheduled worker isolation verified (${files.length} traced paths).`);
    } finally { await rm(isolated, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const [mode, ...rest] = process.argv.slice(2);
    if (rest.length || !['--production', '--preview', '--verify'].includes(mode))
        throw new Error('Use --production, --preview or --verify.');
    if (mode === '--verify') await verifyScheduledWorker(root);
    else console.info(await packageSchedules(root, { production: mode === '--production' }));
}
