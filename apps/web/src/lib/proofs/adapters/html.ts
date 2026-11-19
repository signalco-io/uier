import { crc32 } from 'node:zlib';
import { fromBufferPromise } from 'yauzl';
import { ProofSourceError, type ProofSourceAdapter } from '../sourceTypes';

export const HTML_FILE_LIMIT = 100;
export const HTML_SOURCE_BYTES = 32 * 1024 * 1024;
const maxResourceBytes = 4 * 1024 * 1024;
const resourceTypes: Readonly<Record<string, string>> = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
    json: 'application/json', txt: 'text/plain', png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', woff: 'font/woff', woff2: 'font/woff2',
    ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg'
};
const mimeType = (path: string) => resourceTypes[path.split('.').at(-1)?.toLowerCase() ?? ''];

export function validPrototypePath(path: string) {
    return path.length > 0 && path.length <= 360 && path.split('/').every(part => part !== '.' && part !== '..'
        && part.length <= 120 && part.length > 0 && !/[\\%?#:\x00-\x1f\x7f]/.test(part));
}

function verifyHtml(bytes: Buffer) {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!/<(?:!doctype\s+html|[a-z][a-z0-9-]*(?:\s|>))/i.test(html))
        throw new ProofSourceError('Choose an HTML document encoded as UTF-8.');
}

async function readZip(bytes: Buffer, signal: AbortSignal) {
    const zip = await fromBufferPromise(bytes, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true });
    try {
        if (zip.entryCount > HTML_FILE_LIMIT) throw new ProofSourceError('HTML bundles can contain up to 100 archive entries.');
        const files = new Map<string, Buffer>();
        const seen = new Set<string>();
        let size = 0;
        for await (const entry of zip.eachEntry()) {
            signal.throwIfAborted();
            const directory = entry.fileName.endsWith('/');
            const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
            const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (!validPrototypePath(name) || seen.has(name) || entry.isEncrypted()
                || (fileType && fileType !== (directory ? 0o040000 : 0o100000)))
                throw new ProofSourceError('The HTML bundle contains an unsafe or duplicate path.');
            seen.add(name);
            if (directory || name.split('/').some(part => part === '__MACOSX' || part === '.DS_Store')) continue;
            if (!mimeType(name)) throw new ProofSourceError('The HTML bundle contains a resource type that cannot be previewed.');
            size += entry.uncompressedSize;
            if (entry.uncompressedSize > maxResourceBytes || size > HTML_SOURCE_BYTES)
                throw new ProofSourceError('The expanded HTML bundle exceeds the supported size.');
            const stream = await zip.openReadStreamPromise(entry);
            const stop = () => stream.destroy(new Error('The proof request expired.'));
            signal.addEventListener('abort', stop, { once: true });
            const chunks: Buffer[] = [];
            try {
                for await (const chunk of stream as AsyncIterable<Buffer>) {
                    signal.throwIfAborted();
                    chunks.push(chunk);
                }
            } finally { signal.removeEventListener('abort', stop); }
            const data = Buffer.concat(chunks);
            if (crc32(data) !== entry.crc32) throw new ProofSourceError('The HTML bundle contains a damaged file.');
            if (mimeType(name) === 'text/html') verifyHtml(data);
            files.set(name, data);
        }
        return files;
    } finally { zip.close(); }
}

function archiveRoot(files: Map<string, Buffer>) {
    const direct = ['index.html', 'index.htm'].find(path => files.has(path));
    if (direct) return { entry: direct, prefix: '' };
    const first = files.keys().next().value;
    const prefix = first?.includes('/') ? first.split('/')[0] + '/' : '';
    const nested = prefix && [...files.keys()].every(path => path.startsWith(prefix))
        ? ['index.html', 'index.htm'].find(path => files.has(prefix + path)) : undefined;
    if (nested) return { entry: nested, prefix };
    throw new ProofSourceError('Add index.html at the root of the HTML bundle.');
}

export const htmlAdapter: ProofSourceAdapter = {
    format: 'html', contentTypes: ['text/html', 'application/zip'],
    async ingest({ bytes, contentType, signal }) {
        try {
            let files: Map<string, Buffer>;
            let root;
            if (contentType === 'text/html') {
                if (bytes.length > maxResourceBytes) throw new ProofSourceError('HTML files must be 4 MB or smaller.');
                verifyHtml(bytes);
                files = new Map([['index.html', bytes]]);
                root = { entry: 'index.html', prefix: '' };
            } else {
                files = await readZip(bytes, signal);
                root = archiveRoot(files);
            }
            const resources: Record<string, string> = Object.create(null);
            const artifacts = [...files].map(([name, bytes], index) => {
                const path = name.slice(root.prefix.length);
                if (path === '__uier_bridge.js') throw new ProofSourceError('The HTML bundle uses a reserved resource name.');
                const id = `prototype-${index + 1}`;
                resources[path] = id;
                return { id, contentType: mimeType(path)!, bytes: bytes.length ? bytes : Buffer.from(' ') };
            });
            const paths = [root.entry, ...Object.keys(resources).filter(path => path !== root.entry && mimeType(path) === 'text/html').sort()];
            const surfaces = paths.map((path, index) => ({ id: index ? 'prototype-' + (index + 1) : 'prototype',
                label: path.split('/').at(-1), width: 1280, height: 800 }));
            const pages = Object.fromEntries(surfaces.map((surface, index) => [surface.id, paths[index]!]));
            return {
                manifest: { format: 'html', surfaces, html: { entry: root.entry, pages } },
                artifacts, resources
            };
        } catch (error) {
            if (signal.aborted || error instanceof ProofSourceError) throw error;
            throw new ProofSourceError('The HTML bundle could not be read as a supported ZIP archive.');
        }
    }
};
