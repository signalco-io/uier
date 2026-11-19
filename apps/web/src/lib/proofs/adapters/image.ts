import sharp from 'sharp';
import { SaxesParser } from 'saxes';
import { MAX_PROOF_UPLOAD_BYTES, proofUploadTypes } from '../model';
import { ProofSourceError, type ProofSourceAdapter } from '../sourceTypes';

const imageTypes: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
const inputPixels = 24_000_000;
const svgNamespace = 'http://www.w3.org/2000/svg';

function validateSvg(bytes: Buffer) {
    if (bytes.length > 2 * 1024 * 1024) throw new ProofSourceError('SVG files must be 2 MB or smaller.');
    const invalid = () => { throw new ProofSourceError('SVG files must be self-contained and use local references.'); };
    const parser = new SaxesParser({ xmlns: true });
    let nodes = 0;
    parser.on('doctype', invalid);
    parser.on('processinginstruction', invalid);
    parser.on('opentag', tag => {
        if (tag.local === 'style') inStyle = true;
        if ((nodes++ === 0 && tag.local !== 'svg') || nodes > 20_000 || tag.uri !== svgNamespace
            || ['script', 'foreignObject', 'iframe'].includes(tag.local)) invalid();
        for (const attribute of Object.values(tag.attributes)) {
            const value = attribute.value.trim();
            if (attribute.local.startsWith('on') || attribute.local === 'base') invalid();
            if (attribute.local === 'href' && !/^#[A-Za-z0-9_:.~-]+$/.test(value)) invalid();
            if (attribute.local === 'style') validateCss(value);
            if (/url\s*\(/i.test(value)) validateCss(value);
        }
    });
    function validateCss(css: string) {
        // Escapes and imports can conceal a reference. Allow fragment references used by gradients and masks.
        if (/[@\\]/.test(css) || /url\s*\(/i.test(css.replace(/url\s*\(\s*(['"]?)#[A-Za-z0-9_:.~-]+\1\s*\)/gi, ''))) invalid();
    }
    parser.on('text', validateCssText);
    parser.on('cdata', validateCssText);
    let inStyle = false;
    parser.on('closetag', tag => { if (tag.local === 'style') inStyle = false; });
    function validateCssText(value: string) { if (inStyle) validateCss(value); }
    parser.write(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).close();
}

export const imageAdapter: ProofSourceAdapter = {
    format: 'image',
    contentTypes: proofUploadTypes.image,
    async ingest({ bytes, contentType, signal }) {
        try {
            signal.throwIfAborted();
            if (contentType === 'image/svg+xml') validateSvg(bytes);
            const pipeline = sharp(bytes, { animated: true, failOn: 'warning', limitInputPixels: inputPixels }).timeout({ seconds: 20 });
            const metadata = await pipeline.metadata();
            if (!metadata.format || imageTypes[metadata.format] !== contentType
                || !metadata.width || !metadata.height || metadata.width * metadata.height > inputPixels || (metadata.pages ?? 1) > 160)
                throw new ProofSourceError('The image format or dimensions do not match a supported upload.');
            if ((metadata.pages ?? 1) === 1) pipeline.autoOrient();
            const { data, info } = await pipeline.webp({ lossless: true }).toBuffer({ resolveWithObject: true });
            signal.throwIfAborted();
            if (data.length > MAX_PROOF_UPLOAD_BYTES) throw new ProofSourceError('The image preview is too large.');
            return {
                manifest: { format: 'image', surfaces: [{ id: 'image', artifactId: 'image', width: info.width, height: info.pageHeight ?? info.height }],
                    ...(metadata.delay ? { durationMs: metadata.delay.reduce((total, delay) => total + delay, 0) } : {}) },
                artifacts: [{ id: 'image', contentType: 'image/webp', bytes: data }]
            };
        } catch (error) {
            if (signal.aborted) throw error;
            if (error instanceof ProofSourceError) throw error;
            throw new ProofSourceError('The image could not be decoded safely.');
        }
    }
};
