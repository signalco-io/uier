import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { proofProcessorExternals, usesProofPdf } from '../../apps/web/scripts/proof-processor-files.mjs';

const root = process.cwd();
const web = join(root, 'apps/web');
const functions = join(root, '.vercel/output/functions');
const configs = (await readdir(functions, { recursive: true })).filter(name => name.endsWith('/.vc-config.json'));
const require = createRequire(join(web, 'package.json'));
const { build } = require('esbuild');
const { outputFiles: [fixture] } = await build({
    entryPoints: [join(web, 'scripts/check-proof-pdf-runtime.ts')],
    platform: 'node', format: 'esm', bundle: true, write: false, external: proofProcessorExternals,
    plugins: [{ name: 'traced-sharp', setup(builder) {
        // Turbopack traces Sharp at its concrete pnpm path without the app's module alias.
        builder.onResolve({ filter: /^sharp$/ }, () => ({ path: relative(web, require.resolve('sharp')), external: true }));
    } }],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }
});

let verified = 0;
for (const name of configs) {
    const { filePathMap } = JSON.parse(await readFile(join(functions, name), 'utf8'));
    if (!filePathMap || !Object.values(filePathMap).some(usesProofPdf)) continue;
    const isolated = await mkdtemp(join(tmpdir(), 'uier-proof-pdf-prebuilt-'));
    try {
        const links = [];
        for (const [destination, source] of Object.entries(filePathMap)) {
            if (!source.startsWith('.vercel/output/runtime-files/') || isAbsolute(destination)
                || destination.split('/').includes('..')) throw new Error('Invalid packaged runtime path.');
            const from = resolve(root, source);
            const to = resolve(isolated, destination);
            const stat = await lstat(from);
            await mkdir(dirname(to), { recursive: true });
            if (stat.isSymbolicLink()) links.push([to, await readlink(from)]);
            else await copyFile(from, to);
        }
        for (const [path, target] of links) await symlink(target, path);
        // Run from the assembled function root, with no checkout dependencies in Node's lookup path.
        const entry = join(isolated, 'apps/web/check-proof-pdf-runtime.mjs');
        await mkdir(dirname(entry), { recursive: true });
        await writeFile(entry, fixture.contents);
        const result = spawnSync(process.execPath, [entry], { cwd: isolated, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 80_000 });
        if (result.status !== 0) throw new Error(`Packaged PDF processing failed for ${name}:\n${result.stderr || result.error || result.signal}`);
        verified++;
        console.info(`Verified PDF render, OCR, search and privacy in ${name.replace('/.vc-config.json', '')}.`);
    } finally {
        await rm(isolated, { recursive: true, force: true });
    }
}
if (!verified) throw new Error('No prebuilt PDF processor functions were found.');
