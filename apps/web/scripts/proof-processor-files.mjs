import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

export const proofProcessorExternals = ['pdfjs-dist/*', 'tesseract.js'];

// The processing libraries resolve these assets on demand. Include both the logical package
// entry paths (which let the tracer follow pnpm's links) and the exact assets used at runtime.
export function proofProcessorTraceEntries(root) {
    const web = join(root, 'apps/web');
    const modules = join(web, 'node_modules');
    const pdf = join(modules, 'pdfjs-dist');
    return [join(pdf, 'package.json'),
        join(modules, 'geist/package.json'), join(modules, 'geist/dist/sans.js'),
        join(modules, '@tesseract.js-data/eng/package.json'), join(modules, 'tesseract.js/src/worker-script/node/index.js')];
}

export function proofProcessorAssetFiles(root) {
    const modules = join(root, 'apps/web/node_modules');
    const pdf = join(modules, 'pdfjs-dist');
    const entries = [join(pdf, 'legacy/build/pdf.worker.mjs'), join(modules, 'geist/dist/fonts/geist-sans/Geist-Regular.ttf'),
        join(modules, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')];
    for (const directory of ['cmaps', 'standard_fonts', 'wasm'])
        for (const file of readdirSync(join(pdf, directory))) entries.push(join(pdf, directory, file));
    return entries.map(file => relative(root, realpathSync(file)));
}

export function proofVideoFile(root) {
    const entry = join(root, 'apps/web/dist/proof-processor/ffmpeg');
    return existsSync(entry) ? [relative(root, entry)] : [];
}

export function isProofProcessorTraceNoise(message) {
    // NFT scans the same PDF.js ESM as a script after attempting module parsing. Its dynamic
    // worker entry is copied above. The underlying Node loader is exercised in isolation.
    return /^Failed to parse .*\/pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs as script:\nCannot use 'import.meta' outside a module/.test(message)
        || /^Failed to resolve dependency "encoding":\nCannot find module 'encoding' loaded from .*\/node-fetch\/lib\/index\.js$/.test(message)
        || /^Failed to resolve dependency "@napi-rs\/(?:canvas|canvas-[^"]+)"/.test(message);
}
