import { cp, lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { build } from 'esbuild';

const app = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(app, '../..');
const entry = join(app, '.next/notification-entry');
const output = join(app, '.next/notification-package');
await rm(entry, { recursive: true, force: true });
await rm(output, { recursive: true, force: true });
await mkdir(entry, { recursive: true });
await build({ entryPoints: [join(app, 'scripts/notifications-worker.ts')], outfile: join(entry, 'notifications-worker.mjs'),
    bundle: true, platform: 'node', format: 'esm', external: ['@azure/*', '@vercel/*', 'next/*', 'sharp'],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
for (const name of ['run-notifications.mjs', 'worker-settings.mjs']) await cp(join(app, 'scripts', name), join(entry, name));
const { nodeFileTrace } = createRequire(import.meta.url)('next/dist/compiled/@vercel/nft');
const { fileList, warnings } = await nodeFileTrace([join(entry, 'run-notifications.mjs')], { base: root, processCwd: app });
// sharp probes optional binaries for other platforms; nft also attempts to parse shell/native
// assets. Require the current platform's sharp below, and reject other unresolved dependencies.
const unexpected = [...warnings].filter(warning => !/^Failed to resolve dependency "@img\/sharp-/.test(warning.message)
    && !/^Failed to parse .*\/(?:open\/xdg-open|@img\/sharp-libvips-[^/]+\/lib\/[^/]+\.(?:dylib|so[^/]*)) as /.test(warning.message));
if (unexpected.length) throw new Error(`The worker dependency trace is incomplete: ${unexpected[0].message}`);
createRequire(import.meta.url)('sharp');
const links = [];
for (const name of fileList) {
    if (name.startsWith('../') || /(^|\/)\.env(?:\.|$)/.test(name)) throw new Error('Unexpected worker package path.');
    const source = join(root, name); const target = join(output, name);
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) { links.push([source, target]); continue; }
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
}
for (const [source, target] of links) {
    const link = await readlink(source);
    const destination = relative(root, resolve(dirname(source), link));
    if (destination.startsWith('../') || link.startsWith('/')) throw new Error('Worker dependency link leaves the package.');
    await mkdir(dirname(target), { recursive: true });
    await symlink(link, target);
}
console.info(`Worker package contains ${fileList.size} traced files.`);
// An isolated copy cannot accidentally resolve a missing dependency from the source checkout.
const isolated = await mkdtemp(join(tmpdir(), 'uier-worker-package-'));
try {
    await cp(output, isolated, { recursive: true, verbatimSymlinks: true });
    const settings = { COSMOSDB_ENDPOINT: 'https://fixture.documents.azure.com/',
        AZURE_SCREENSHOTS_ENDPOINT: 'https://fixture.blob.core.windows.net/', UIER_COMMENTS_SECRET: 'fixture',
        ACS_CONNECTION_STRING: 'fixture', UIER_EMAIL_SENDER: 'fixture@example.invalid' };
    const result = spawnSync(process.execPath, [join(isolated, relative(root, entry), 'run-notifications.mjs')],
        { cwd: isolated, env: { PATH: process.env.PATH, UIER_WORKER_SETTINGS: JSON.stringify(settings) }, encoding: 'utf8' });
    if (!result.stderr?.includes('The notification worker requires the production deployment configuration.'))
        throw new Error('The standalone worker package did not load its dependencies and enforce its context guard.');
} finally { await rm(isolated, { recursive: true, force: true }); }
