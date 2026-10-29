import type { DbScreenshot } from '../db/schema';
import sharp from 'sharp';
import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DIMENSION } from './limits';

/** Image formats a screenshot can have (what browsers' canvas encoders produce) */
import { screenshotContentTypes } from '@uier/toolbar/screenshot-policy';
export { screenshotContentTypes };
export type ScreenshotContentType = typeof screenshotContentTypes[number];

export type ParsedScreenshot = {
    contentType: ScreenshotContentType;
    data: Buffer;
    width: number;
    height: number;
};

/** The longest data URL of a screenshot: base64 of MAX_SCREENSHOT_BYTES and the `data:` prefix */
export const MAX_SCREENSHOT_DATA_URL_LENGTH = Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 64;

const dataUrlPattern = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;

function pngSize(data: Buffer) {
    // Signature, then the IHDR chunk: width and height at 16 and 20
    if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a || data.toString('latin1', 12, 16) !== 'IHDR')
        return null;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function jpegSize(data: Buffer) {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8)
        return null;
    // Walk the segments to the first start of frame (SOF0-SOF15, but not DHT, JPG and DAC)
    let offset = 2;
    while (offset + 9 < data.length) {
        if (data[offset] !== 0xff)
            return null;
        const marker = data[offset + 1]!;
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        const length = data.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
            return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
        if (length < 2)
            return null;
        offset += 2 + length;
    }
    return null;
}

function webpSize(data: Buffer) {
    if (data.length < 30 || data.toString('latin1', 0, 4) !== 'RIFF' || data.toString('latin1', 8, 12) !== 'WEBP')
        return null;
    switch (data.toString('latin1', 12, 16)) {
        case 'VP8 ':
            // Lossy: 14-bit sizes after the frame tag and start code
            return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
        case 'VP8L': {
            // Lossless: after the 0x2f signature, two 14-bit sizes minus one
            if (data[20] !== 0x2f)
                return null;
            const bits = data.readUInt32LE(21);
            return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        case 'VP8X':
            // Extended: 24-bit canvas sizes minus one
            return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
        default:
            return null;
    }
}

const sizeReaders: Record<ScreenshotContentType, (data: Buffer) => { width: number; height: number } | null> = {
    'image/png': pngSize,
    'image/jpeg': jpegSize,
    'image/webp': webpSize
};

/**
 * A screenshot sent as a data URL (`data:image/webp;base64,...`): its bytes, and its type and size
 * read from the image itself, not from what the client says. An error message when it is not a
 * PNG, JPEG or WebP image of its declared type, is larger than {@link MAX_SCREENSHOT_BYTES} or
 * than {@link MAX_SCREENSHOT_DIMENSION} pixels on a side.
 */
export function parseScreenshot(dataUrl: string): ParsedScreenshot | string {
    const match = dataUrlPattern.exec(dataUrl);
    if (!match)
        return 'Screenshot must be a PNG, JPEG or WebP data URL.';

    const contentType = match[1] as ScreenshotContentType;
    const data = Buffer.from(match[2]!, 'base64');
    if (data.length > MAX_SCREENSHOT_BYTES)
        return `Screenshot must be at most ${MAX_SCREENSHOT_BYTES} bytes.`;

    const size = sizeReaders[contentType](data);
    if (!size)
        return `Screenshot is not a valid ${contentType.slice('image/'.length).toUpperCase()} image.`;
    if (size.width < 1 || size.height < 1 || size.width > MAX_SCREENSHOT_DIMENSION || size.height > MAX_SCREENSHOT_DIMENSION)
        return `Screenshot must be at most ${MAX_SCREENSHOT_DIMENSION} pixels on a side.`;

    return { contentType, data, ...size };
}

/** Decode untrusted bytes and store only newly encoded pixels, never metadata or extra frames. */
export async function sanitizeScreenshot(input: ParsedScreenshot): Promise<ParsedScreenshot | string> {
    try {
        const image = sharp(input.data, {
            limitInputPixels: MAX_SCREENSHOT_DIMENSION ** 2, pages: 1, failOn: 'warning'
        }).autoOrient();
        const format = input.contentType === 'image/jpeg' ? 'jpeg' : input.contentType === 'image/png' ? 'png' : 'webp';
        let result = await image.toFormat(format).toBuffer({ resolveWithObject: true });
        let contentType = input.contentType;
        if (result.data.length > MAX_SCREENSHOT_BYTES && format === 'png') {
            result = await image.webp().toBuffer({ resolveWithObject: true });
            contentType = 'image/webp';
        }
        if (result.info.width > MAX_SCREENSHOT_DIMENSION || result.info.height > MAX_SCREENSHOT_DIMENSION)
            return `Screenshot must be at most ${MAX_SCREENSHOT_DIMENSION} pixels on a side.`;
        if (result.data.length > MAX_SCREENSHOT_BYTES)
            return `Screenshot must be at most ${MAX_SCREENSHOT_BYTES} bytes.`;
        return { contentType, data: result.data, width: result.info.width, height: result.info.height };
    } catch {
        return 'Screenshot is not a valid decodable image.';
    }
}

/**
 * A stored screenshot as the response of `GET .../comments/<id>/screenshot`: the image, never
 * sniffed as anything else (the site's CSP, next.config.ts, applies to it as to every response)
 */
export function screenshotResponse(screenshot: DbScreenshot) {
    const data = Buffer.from(screenshot.data, 'base64');
    return new Response(new Uint8Array(data), {
        headers: {
            'Content-Type': screenshot.contentType,
            'Content-Length': String(data.length),
            'Content-Disposition': 'inline',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}
