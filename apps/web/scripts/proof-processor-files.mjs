import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

export const proofProcessorExternals = ['pdfjs-dist/*', 'tesseract.js'];
export const usesProofPdf = file => typeof file === 'string' && /(?:^|\/)pdfjs-dist\/legacy\/build\/pdf\.mjs$/.test(file);

function pdfCanvasEntry(webRequire) {
    const requireFromPdf = createRequire(webRequire.resolve('pdfjs-dist/package.json'));
    const canvas = '@napi-rs/canvas';
    const entry = requireFromPdf.resolve(canvas);
    const manifest = requireFromPdf.resolve(canvas + '/package.json');
    const packageRoot = dirname(manifest);
    const logicalRoot = requireFromPdf.resolve.paths(canvas).map(path => join(path, canvas))
        .find(path => existsSync(path) && realpathSync(path) === packageRoot);
    if (!logicalRoot) throw new Error('Could not locate the canvas package from PDF.js.');
    // Trace from the logical entry so NFT keeps the pnpm link that PDF.js resolves at runtime.
    return join(logicalRoot, relative(packageRoot, entry));
}

// The processing libraries resolve these assets on demand. Include both the logical package
// entry paths (which let the tracer follow pnpm's links) and the exact assets used at runtime.
export function proofProcessorTraceEntries(root) {
    const web = join(root, 'apps/web');
    const modules = join(web, 'node_modules');
    const pdf = join(modules, 'pdfjs-dist');
    return [join(pdf, 'package.json'),
        join(modules, 'geist/package.json'), join(modules, 'geist/dist/sans.js'),
        join(modules, '@tesseract.js-data/eng/package.json'), join(modules, 'tesseract.js/src/worker-script/node/index.js'),
        pdfCanvasEntry(createRequire(join(web, 'package.json')))];
}

export function proofProcessorAssetFiles(root) {
    const modules = join(root, 'apps/web/node_modules');
    const pdf = join(modules, 'pdfjs-dist');
    const requireFromTesseract = createRequire(realpathSync(join(modules, 'tesseract.js/package.json')));
    const core = dirname(requireFromTesseract.resolve('tesseract.js-core/package.json'));
    const wasm = readdirSync(core).filter(name => name.endsWith('.wasm'));
    if (!wasm.length) throw new Error('The Tesseract Node worker requires its standalone WebAssembly files.');
    const entries = [join(pdf, 'legacy/build/pdf.worker.mjs'), join(modules, 'geist/dist/fonts/geist-sans/Geist-Regular.ttf'),
        join(modules, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), ...wasm.map(name => join(core, name))];
    for (const directory of ['cmaps', 'standard_fonts', 'wasm'])
        for (const file of readdirSync(join(pdf, directory))) entries.push(join(pdf, directory, file));
    return entries.map(file => relative(root, realpathSync(file)));
}

export function proofVideoFile(root) {
    const entry = join(root, 'apps/web/dist/proof-processor/ffmpeg.gz');
    return existsSync(entry) ? [relative(root, entry)] : [];
}

/** Complete the runtime edges that Next cannot see through PDF.js's createRequire and worker paths. */
export async function traceProofProcessorRuntime(root) {
    const web = join(root, 'apps/web');
    const require = createRequire(join(web, 'package.json'));
    const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft');
    const { fileList, warnings } = await nodeFileTrace(proofProcessorTraceEntries(root), { base: root, processCwd: web });
    const unexpected = [...warnings].find(warning => !isProofProcessorTraceNoise(warning.message));
    if (unexpected) throw new Error(`The PDF processor dependency trace is incomplete: ${unexpected.message}`);
    return [...new Set([...fileList, ...proofProcessorAssetFiles(root)])];
}

export function isProofProcessorTraceNoise(message) {
    // NFT scans the same PDF.js ESM as a script after attempting module parsing. Its dynamic
    // worker entry is copied above. The underlying Node loader is exercised in isolation.
    return /^Failed to parse .*\/pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs as script:\nCannot use 'import.meta' outside a module/.test(message)
        || /^Failed to resolve dependency "encoding":\nCannot find module 'encoding' loaded from .*\/node-fetch\/lib\/index\.js$/.test(message)
        || /^Failed to resolve dependency "(?:@napi-rs\/canvas-[^"]+|\.\/skia\.[^"]+\.(?:node|cjs))":\n.*loaded from .*\/canvas\/js-binding\.js$/.test(message);
}
