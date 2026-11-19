import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, TextRenderingMode, beginText, endText, setFontAndSize, setTextMatrix, setTextRenderingMode, showText } from 'pdf-lib';
import sharp from 'sharp';
import type { Worker, Word } from 'tesseract.js';
import { MAX_PROOF_UPLOAD_BYTES, type ProofSurface } from '../model';
import { ProofSourceError, type ProofSourceAdapter } from '../sourceTypes';

const maxPages = 100;
const maxTextBytes = 2 * 1024 * 1024;
const maxRasterBytes = 16 * 1024 * 1024;
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function packageFile(name: string) {
    const cwd = process.cwd();
    const web = existsSync(join(cwd, 'apps/web/node_modules/pdfjs-dist')) ? join(cwd, 'apps/web') : cwd;
    const resolver = createRequire(join(web, 'package.json')).resolve;
    return resolver(name);
}

type Canvas = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };

async function recognitionWorker(signal: AbortSignal) {
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    const data = dirname(packageFile('@tesseract.js-data/eng/package.json'));
    const worker = await createWorker('eng', OEM.LSTM_ONLY, { langPath: join(data, '4.0.0_best_int'), cacheMethod: 'none',
        errorHandler: () => undefined });
    if (signal.aborted) { await worker.terminate(); signal.throwIfAborted(); }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    return worker;
}

async function recognize(worker: Worker, image: Buffer, signal: AbortSignal) {
    const job = worker.recognize(image, {}, { blocks: true, text: false });
    let cancel: () => void = () => {};
    const interrupted = new Promise<never>((_, reject) => { cancel = () => reject(signal.reason); });
    signal.addEventListener('abort', cancel, { once: true });
    try {
        signal.throwIfAborted();
        const { data } = await Promise.race([job, interrupted]);
        return (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => line.words)));
    } finally { signal.removeEventListener('abort', cancel); }
}

/** Creates the searchable layer from the pixels the reviewer actually sees, never source text/ToUnicode. */
function addSearchWords(page: ReturnType<PDFDocument['addPage']>, font: Awaited<ReturnType<PDFDocument['embedFont']>>,
    lines: Word[][], width: number, height: number, pixelWidth: number, pixelHeight: number) {
    const fontKey: PDFName = page.node.newFontDictionary('ProofSearch', font.ref);
    const supported = new Set(font.getCharacterSet());
    return lines.map(line => line.flatMap(word => {
        const text = [...word.text].filter(char => supported.has(char.codePointAt(0)!)).join('').trim();
        const { x0, x1, y0, y1 } = word.bbox;
        if (!text || ![x0, x1, y0, y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 > pixelWidth || y1 > pixelHeight || x1 <= x0 || y1 <= y0) return [];
        const size = (y1 - y0) * height / pixelHeight;
        const measured = font.widthOfTextAtSize(text, size);
        if (!(measured > 0)) return [];
        const stretch = (x1 - x0) * width / pixelWidth / measured;
        page.pushOperators(beginText(), setFontAndSize(fontKey, size), setTextRenderingMode(TextRenderingMode.Invisible),
            setTextMatrix(stretch, 0, 0, 1, x0 * width / pixelWidth, height - y1 * height / pixelHeight), showText(font.encodeText(text)), endText());
        return [text];
    }).join(' ')).filter(Boolean).join('\n');
}

export const pdfAdapter: ProofSourceAdapter = {
    format: 'pdf', contentTypes: ['application/pdf'],
    async ingest({ bytes, signal }) {
        if (!bytes.subarray(0, 8).toString('ascii').match(/^%PDF-\d\.\d/)) throw new ProofSourceError('Choose a valid PDF file.');
        const { getDocument, AnnotationMode } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const root = dirname(packageFile('pdfjs-dist/package.json'));
        const task = getDocument({ data: new Uint8Array(bytes), stopAtErrors: true, useSystemFonts: false,
            cMapUrl: root + sep + 'cmaps' + sep, cMapPacked: true,
            standardFontDataUrl: root + sep + 'standard_fonts' + sep, wasmUrl: root + sep + 'wasm' + sep,
            maxImageSize: 24_000_000, canvasMaxAreaInBytes: 48 * 1024 * 1024, enableXfa: false });
        const stop = () => { void task.destroy().catch(() => undefined); };
        const budget = AbortSignal.timeout(70_000);
        const processing = AbortSignal.any([signal, budget]);
        processing.addEventListener('abort', stop, { once: true });
        let worker: Worker | undefined;
        try {
            processing.throwIfAborted();
            const pdf = await task.promise;
            if (pdf.numPages < 1 || pdf.numPages > maxPages) throw new ProofSourceError('PDFs can contain up to 100 pages.');
            const display = await PDFDocument.create({ updateMetadata: false });
            display.registerFontkit(fontkit);
            const geist = dirname(packageFile('geist/font/sans'));
            const font = await display.embedFont(await readFile(join(geist, 'fonts/geist-sans/Geist-Regular.ttf')), { subset: true });
            worker = await recognitionWorker(processing);
            const factory = pdf.canvasFactory as { create(width: number, height: number): Canvas; destroy(value: Canvas): void };
            const surfaces: ProofSurface[] = [];
            const evidence: { id: string; text: string }[] = [];
            const fingerprintCounts = new Map<string, number>();
            let textBytes = 0;
            let rasterBytes = 0;
            for (let number = 1; number <= pdf.numPages; number++) {
                processing.throwIfAborted();
                const page = await pdf.getPage(number);
                const { width, height } = page.getViewport({ scale: 1 });
                if (!Number.isFinite(width * height) || width <= 0 || height <= 0 || width > 20_000 || height > 20_000)
                    throw new ProofSourceError('A PDF page exceeds the supported dimensions.');
                const viewport = page.getViewport({ scale: Math.min(2.25, 1800 / Math.max(width, height)) });
                const pixelWidth = Math.max(1, Math.ceil(viewport.width));
                const pixelHeight = Math.max(1, Math.ceil(viewport.height));
                const canvas = factory.create(pixelWidth, pixelHeight);
                const render = page.render({ canvas: canvas.canvas, canvasContext: canvas.context, viewport, annotationMode: AnnotationMode.DISABLE });
                const cancel = () => render.cancel();
                processing.addEventListener('abort', cancel, { once: true });
                let raster;
                try {
                    await render.promise;
                    const { data } = canvas.context.getImageData(0, 0, pixelWidth, pixelHeight);
                    raster = await sharp(Buffer.from(data), { raw: { width: pixelWidth, height: pixelHeight, channels: 4 } })
                        .flatten({ background: 'white' }).jpeg({ quality: 86, chromaSubsampling: '4:4:4' }).toBuffer();
                } finally {
                    processing.removeEventListener('abort', cancel);
                    factory.destroy(canvas);
                    page.cleanup();
                }
                rasterBytes += raster.length;
                if (rasterBytes > maxRasterBytes) throw new ProofSourceError('The rendered PDF is too large. Split it into smaller files.');
                const target = display.addPage([width, height]);
                target.drawImage(await display.embedJpg(raster), { x: 0, y: 0, width, height });
                const lines = await recognize(worker, raster, processing);
                const text = addSearchWords(target, font, lines, width, height, pixelWidth, pixelHeight);
                textBytes += Buffer.byteLength(text);
                if (textBytes > maxTextBytes) throw new ProofSourceError('This PDF contains too much searchable text.');
                const textDigest = text ? sha(text.normalize('NFKC').replace(/\s+/g, ' ')) : undefined;
                const contentDigest = sha(raster);
                const fingerprint = textDigest ?? contentDigest;
                const occurrence = (fingerprintCounts.get(fingerprint) ?? 0) + 1;
                fingerprintCounts.set(fingerprint, occurrence);
                const id = `page-${fingerprint}-${occurrence}`;
                surfaces.push({ id, label: String(number), width, height, textDigest, contentDigest });
                evidence.push({ id, text });
            }
            const rendition = Buffer.from(await display.save({ addDefaultPage: false, useObjectStreams: false }));
            if (rendition.length > MAX_PROOF_UPLOAD_BYTES) throw new ProofSourceError('The rendered PDF is too large. Split it into smaller files.');
            return { manifest: { format: 'pdf', surfaces, pdf: { artifactId: 'document', textArtifactId: 'page-text', rendition: 'raster-ocr-v1' } },
                artifacts: [{ id: 'document', contentType: 'application/pdf', bytes: rendition },
                    { id: 'page-text', contentType: 'application/json', bytes: Buffer.from(JSON.stringify(evidence)) }] };
        } catch (error) {
            if (signal.aborted || error instanceof ProofSourceError) throw error;
            if (budget.aborted) throw new ProofSourceError('The PDF took too long to render. Split it into smaller files.');
            // No source details from the parser, font or worker are returned to the client.
            throw new ProofSourceError('The PDF could not be rendered. Check that it is valid and does not require a password.');
        } finally {
            processing.removeEventListener('abort', stop);
            await Promise.all([task.destroy().catch(() => undefined), worker?.terminate().catch(() => undefined)]);
        }
    }
};
