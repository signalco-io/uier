import { expect, test } from '@playwright/test';
import { MAX_SCREENSHOT_BYTES } from '../src/lib/comments/limits';
import { parseScreenshot } from '../src/lib/comments/screenshot';
import { jpegImage, pngImage, webpImage, webpLosslessImage } from './support/images';

// The screenshot parser (src/lib/comments/screenshot.ts), used directly: the image's type and size
// come from its bytes, never from what the client says

function dataUrl(type: string, bytes: Buffer) {
    return `data:${type};base64,${bytes.toString('base64')}`;
}

/** A simple lossy WebP header (`VP8 `) with these sizes: enough for the parser, not a picture */
function lossyWebpHeader(width: number, height: number) {
    const bytes = Buffer.alloc(40);
    bytes.write('RIFF', 0, 'latin1');
    bytes.writeUInt32LE(32, 4);
    bytes.write('WEBPVP8 ', 8, 'latin1');
    bytes.writeUInt32LE(20, 16);
    bytes.set([0x9d, 0x01, 0x2a], 23);
    bytes.writeUInt16LE(width, 26);
    bytes.writeUInt16LE(height, 28);
    return bytes;
}

/** A PNG signature and header with these sizes, then `extra` bytes */
function pngHeader(width: number, height: number, extra = 0) {
    const bytes = Buffer.alloc(33 + extra);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
    bytes.writeUInt32BE(13, 8);
    bytes.write('IHDR', 12, 'latin1');
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
}

test('screenshots: type and size are read from the image', () => {
    expect(parseScreenshot(pngImage)).toMatchObject({ contentType: 'image/png', width: 3, height: 2 });
    expect(parseScreenshot(jpegImage)).toMatchObject({ contentType: 'image/jpeg', width: 3, height: 2 });
    expect(parseScreenshot(webpImage)).toMatchObject({ contentType: 'image/webp', width: 3, height: 2 });
    expect(parseScreenshot(webpLosslessImage)).toMatchObject({ contentType: 'image/webp', width: 1, height: 1 });
    expect(parseScreenshot(dataUrl('image/webp', lossyWebpHeader(640, 480)))).toMatchObject({ contentType: 'image/webp', width: 640, height: 480 });
});

test('screenshots: anything else is refused', () => {
    // Another type than the one declared, or not an image of that type
    expect(parseScreenshot(pngImage.replace('image/png', 'image/webp'))).toMatch(/not a valid WEBP image/);
    expect(parseScreenshot(dataUrl('image/jpeg', Buffer.from('not an image')))).toMatch(/not a valid JPEG image/);
    // Other formats and URLs
    expect(parseScreenshot('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toMatch(/PNG, JPEG or WebP data URL/);
    expect(parseScreenshot('data:image/svg+xml;base64,PHN2Zy8+')).toMatch(/PNG, JPEG or WebP data URL/);
    expect(parseScreenshot('https://example.com/a.png')).toMatch(/PNG, JPEG or WebP data URL/);
    expect(parseScreenshot('data:image/png;base64,not base64!')).toMatch(/PNG, JPEG or WebP data URL/);
    // Too large, in bytes or in pixels
    expect(parseScreenshot(dataUrl('image/png', pngHeader(10, 10, MAX_SCREENSHOT_BYTES)))).toMatch(/at most 524288 bytes/);
    expect(parseScreenshot(dataUrl('image/png', pngHeader(5000, 10)))).toMatch(/at most 4096 pixels/);
    expect(parseScreenshot(dataUrl('image/webp', lossyWebpHeader(0, 10)))).toMatch(/at most 4096 pixels/);
});
