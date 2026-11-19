import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { proofProcessorExternals, traceProofProcessorRuntime } from '../../apps/web/scripts/proof-processor-files.mjs';
import { workerFunction } from './package_schedules.mjs';

const runtimePrefix = '.vercel/output/runtime-files/';
const proofFunctions = [
    'api/proofs/[projectId]/[[...proofPath]]', // Browser upload finalization.
    'api/mcp', // finalize_proof_upload over the MCP transport.
    'api/proof-mail', // The RFC 822 relay also uses the shared finalizer.
];

function moduleName(path) {
    const parts = `/${path}`.split('/node_modules/');
    return parts.length > 1 ? /^(?:@[^/]+\/)?[^/]+/.exec(parts.at(-1))?.[0] : undefined;
}

function safePath(path) {
    return typeof path === 'string' && !isAbsolute(path) && !path.includes('\\')
        && path.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.env' && !part.startsWith('.env.'));
}

function inside(root, path) {
    const name = relative(root, path);
    return !isAbsolute(name) && name !== '..' && !name.startsWith('../');
}

export async function verifyPdfFunctions(root, required, runFixture, { production = false } = {}) {
    const output = join(root, '.vercel/output');
    const runtimeRoot = await realpath(join(root, runtimePrefix));
    const { schedules } = JSON.parse(await readFile(join(output, 'config.json'), 'utf8'));
    const schedule = schedules?.['review-notifications'];
    const functions = [...proofFunctions];
    if (production || schedule) {
        if (schedule?.function !== workerFunction) throw new Error(`Missing PDF retry schedule for ${workerFunction}.`);
        functions.push(workerFunction);
    }

    const packages = new Set(required.map(moduleName).filter(Boolean));
    const closures = new Map();
    const nodeRuntime = `nodejs${process.versions.node.split('.')[0]}.x`;
    for (const name of functions) {
        const config = join(output, 'functions', `${name}.func/.vc-config.json`);
        const { filePathMap, runtime } = JSON.parse(await readFile(config, 'utf8'));
        if (runtime !== nodeRuntime) throw new Error(`${name} must use the fixture's Node.js runtime (${nodeRuntime}).`);
        if (!filePathMap || typeof filePathMap !== 'object' || Array.isArray(filePathMap))
            throw new Error(`Missing packaged Node.js dependency map for ${name}.`);
        for (const path of required) {
            if (!Object.hasOwn(filePathMap, path)) throw new Error(`${name} is missing PDF runtime file ${path}.`);
            if (filePathMap[path] !== runtimePrefix + path) throw new Error(`${name} maps PDF runtime file ${path} to the wrong source.`);
        }

        // Vercel groups Next outputs into shared functions. Compare the destination and source
        // paths of the processor packages, including any extra resolution paths in those packages.
        const entries = Object.keys(filePathMap).filter(path => packages.has(moduleName(path))).sort()
            .map(path => [path, filePathMap[path]]);
        const key = JSON.stringify(entries);
        const closure = closures.get(key) ?? { entries, names: [] };
        closure.names.push(name);
        closures.set(key, closure);
    }

    // Every required destination points to the same packaged source in all closures.
    // Check those bytes and links once, including assets the fixture may not exercise.
    for (const path of required) {
        const original = join(root, path);
        const packaged = join(root, runtimePrefix, path);
        const stat = await lstat(packaged);
        const expected = await lstat(original);
        const matches = expected.isSymbolicLink()
            ? stat.isSymbolicLink() && await readlink(packaged) === await readlink(original)
            : stat.isFile() && (await readFile(packaged)).equals(await readFile(original));
        if (!matches) throw new Error(`Packaged PDF runtime file ${path} differs from the build dependency.`);
    }

    for (const { entries, names } of closures.values()) {
        const isolated = await mkdtemp(join(tmpdir(), 'uier-proof-pdf-prebuilt-'));
        try {
            const links = [];
            for (const [destination, source] of entries) {
                if (!safePath(destination) || !safePath(source) || !source.startsWith(runtimePrefix))
                    throw new Error(`Invalid packaged PDF runtime path for ${names.join(', ')}.`);
                const from = join(root, source);
                const to = join(isolated, destination);
                if (!inside(runtimeRoot, await realpath(from)))
                    throw new Error(`Packaged PDF runtime file ${destination} escapes the runtime files.`);
                const stat = await lstat(from);
                await mkdir(dirname(to), { recursive: true });
                if (stat.isSymbolicLink()) links.push([to, await readlink(from)]);
                else await copyFile(from, to);
            }
            for (const [path, target] of links) {
                if (isAbsolute(target) || !inside(isolated, resolve(dirname(path), target)))
                    throw new Error('Invalid packaged PDF runtime link.');
                await symlink(target, path);
            }
            for (const [path] of links) await realpath(path);
            await runFixture(isolated, names);
        } finally {
            await rm(isolated, { recursive: true, force: true });
        }
    }
}

async function checkPrebuilt(root) {
    const web = join(root, 'apps/web');
    const require = createRequire(join(web, 'package.json'));
    const sharp = require.resolve('sharp');
    const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft');
    // Next already traces the module entry points and Sharp. Include them in the required
    // inventory alongside the dynamic canvas, OCR worker and resource paths we supplement.
    const tesseract = relative(dirname(require.resolve('tesseract.js/package.json')), require.resolve('tesseract.js'));
    const { fileList } = await nodeFileTrace([
        sharp, join(web, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'), join(web, 'node_modules/tesseract.js', tesseract)
    ], { base: root, processCwd: web });
    // Resolving the Geist font path does not load Next. NFT also adds semver's
    // optional preload entry, which Sharp does not load and Next does not ship.
    const required = [...new Set([...await traceProofProcessorRuntime(root), ...fileList])]
        .filter(path => moduleName(path) !== 'next' && !path.endsWith('/node_modules/semver/preload.js'));

    const { build } = require('esbuild');
    const { outputFiles: [fixture] } = await build({
        entryPoints: [join(web, 'scripts/check-proof-pdf-runtime.ts')],
        platform: 'node', format: 'esm', bundle: true, write: false, external: proofProcessorExternals,
        plugins: [{ name: 'traced-sharp', setup(builder) {
            // Turbopack traces Sharp at its concrete pnpm path without the app's module alias.
            builder.onResolve({ filter: /^sharp$/ }, () => ({ path: relative(web, sharp), external: true }));
        } }],
        banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }
    });
    await verifyPdfFunctions(root, required, async (isolated, names) => {
        // Run from the assembled function root, with no checkout dependencies in Node's lookup path.
        const entry = join(isolated, 'apps/web/check-proof-pdf-runtime.mjs');
        await mkdir(dirname(entry), { recursive: true });
        await writeFile(entry, fixture.contents);
        const result = spawnSync(process.execPath, [entry], { cwd: isolated, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 80_000 });
        if (result.status !== 0) throw new Error(`Packaged PDF processing failed for ${names.join(', ')}:\n${result.stderr || result.error || result.signal}`);
        console.info(`Verified PDF render, OCR, search and privacy for ${names.join(', ')}.`);
    }, { production: process.env.UIER_DEPLOYMENT_ENV === 'production' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    await checkPrebuilt(await realpath(process.cwd()));
