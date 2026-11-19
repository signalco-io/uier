import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyPdfFunctions } from './check_proof_pdf_prebuilt.mjs';

const browser = 'api/proofs/[projectId]/[[...proofPath]]';
const mcp = 'api/mcp';
const mail = 'api/proof-mail';
const worker = '_uier/worker';
const previewFunctions = [browser, mcp, mail];
const prefix = '.vercel/output/runtime-files/';
const pdf = 'node_modules/pdfjs-dist/legacy/build/pdf.mjs';
const canvas = 'node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node';
const wasm = 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm';
const workerEntry = 'node_modules/tesseract.js/src/worker-script/node/index.js';
const workerLink = 'apps/web/node_modules/tesseract.js';
const required = [pdf, canvas, wasm, workerEntry, workerLink];
const runtimeMap = Object.fromEntries(required.map(path => [path, prefix + path]));

async function fixture(t, { production = false } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'uier-proof-package-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    async function write(path, contents) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), contents);
    }
    async function writeMap(name, filePathMap) {
        await write(`.vercel/output/functions/${name}.func/.vc-config.json`, JSON.stringify({ runtime: 'nodejs26.x', filePathMap }));
    }
    await write('.vercel/output/config.json', JSON.stringify({
        version: 3, ...(production && { schedules: { 'review-notifications': { function: worker } } })
    }));
    for (const base of ['', prefix]) {
        for (const path of [pdf, canvas, wasm, workerEntry]) await write(base + path, path);
        await mkdir(dirname(join(root, base, workerLink)), { recursive: true });
        await symlink('../../../node_modules/tesseract.js', join(root, base, workerLink));
    }
    for (const name of production ? [...previewFunctions, worker] : previewFunctions) await writeMap(name, runtimeMap);
    return { root, write, writeMap };
}

test('checks the API aliases once despite shared marketing and RSC maps', async t => {
    const { root, writeMap } = await fixture(t);
    const reversed = Object.fromEntries(Object.entries(runtimeMap).reverse());
    await writeMap(browser, { ...runtimeMap, 'apps/web/.next/browser.js': prefix + 'apps/web/.next/browser.js' });
    await writeMap(mcp, { ...reversed, 'apps/web/.next/mcp.js': prefix + 'apps/web/.next/mcp.js' });
    for (const name of ['_global-error', 'brand', 'brand.rsc', 'brand.segments/__PAGE__.segment.rsc', `${browser}.prefetch.rsc`])
        await writeMap(name, { ...runtimeMap, 'node_modules/tesseract.js/marketing-only.js': prefix + 'missing.js' });
    const runs = [];
    await verifyPdfFunctions(root, required, async (isolated, names) => {
        assert.equal(await readFile(join(isolated, canvas), 'utf8'), canvas);
        assert.equal(await readFile(join(isolated, workerLink, 'src/worker-script/node/index.js'), 'utf8'), workerEntry);
        runs.push(names);
    });
    assert.deepEqual(runs, [previewFunctions]);
});

test('runs the fixture on a distinct processor map, including the scheduled retry worker', async t => {
    const { root, write, writeMap } = await fixture(t, { production: true });
    const extra = 'node_modules/tesseract.js/extra.js';
    await write(prefix + extra, 'processor variant');
    await writeMap(worker, { ...runtimeMap, [extra]: prefix + extra });
    const runs = [];
    await verifyPdfFunctions(root, required, async (isolated, names) => {
        if (names.includes(worker)) assert.equal(await readFile(join(isolated, extra), 'utf8'), 'processor variant');
        runs.push(names);
    });
    assert.deepEqual(runs, [previewFunctions, [worker]]);
});

test('rejects missing and incorrect processor entries in individual routes before running OCR', async t => {
    const { root, writeMap } = await fixture(t);
    const { [wasm]: omitted, ...withoutWasm } = runtimeMap;
    const run = () => verifyPdfFunctions(root, required, () => assert.fail('Invalid maps must fail before running the fixture.'));
    await writeMap(mcp, withoutWasm);
    await assert.rejects(run, /api\/mcp is missing PDF runtime file .*\.wasm/);
    const { [pdf]: omittedPdf, ...withoutPdf } = runtimeMap;
    await writeMap(mcp, withoutPdf);
    await assert.rejects(run, /api\/mcp is missing PDF runtime file .*pdf\.mjs/);
    await writeMap(mcp, { ...runtimeMap, [canvas]: prefix + wasm });
    await assert.rejects(run, /api\/mcp maps PDF runtime file .*\.node to the wrong source/);
    await writeMap(mcp, undefined);
    await assert.rejects(run, /Missing packaged Node\.js dependency map for api\/mcp/);
});

test('requires the expected handler configs and the production retry schedule', async t => {
    const { root } = await fixture(t);
    const run = () => assert.fail('Missing handlers must fail before running the fixture.');
    await assert.rejects(verifyPdfFunctions(root, required, run, { production: true }), /Missing PDF retry schedule/);
    await rm(join(root, '.vercel/output/functions', `${browser}.func`), { recursive: true });
    await assert.rejects(verifyPdfFunctions(root, required, run), { code: 'ENOENT', path: join(root, '.vercel/output/functions', `${browser}.func/.vc-config.json`) });
});

test('rejects a mapped OCR file with missing or incorrect packaged bytes', async t => {
    const { root, write } = await fixture(t);
    const run = () => verifyPdfFunctions(root, required, () => assert.fail('The invalid file must fail before OCR.'));
    await rm(join(root, prefix, wasm));
    await assert.rejects(run, { code: 'ENOENT', path: join(root, prefix, wasm) });
    await write(prefix + wasm, 'incorrect OCR bytes');
    await assert.rejects(run, /Packaged PDF runtime file .*\.wasm differs from the build dependency/);
});
