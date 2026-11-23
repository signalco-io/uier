import { encodedScreenshotLimits, encodesWebp, encodeScreenshotInBackground, readAsDataUrl } from './screenshotEncoding';
import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DIMENSION, MAX_SUPPLIED_IMAGE_BYTES, screenshotContentTypes } from './screenshotPolicy';

/** Why a supplied image was refused: the toolbar words it in its language, the app keeps the English message */
export type SuppliedImageProblem = 'type' | 'size' | 'read' | 'open';

export class SuppliedImageError extends Error {
    constructor(readonly problem: SuppliedImageProblem, message: string) {
        super(message);
        this.name = 'SuppliedImageError';
    }
}

/**
 * Files and clipboard images use the same formats as stored automatic captures. One within the API's limits is
 * sent as it is; a larger one (most full-screen screenshots) is made smaller like a capture.
 */
export async function suppliedScreenshot(file: Blob): Promise<string> {
    return (await suppliedScreenshotWithSize(file)).dataUrl;
}

/** `suppliedScreenshot` with the image's size, so a message that is still sending can keep its place (uier #409) */
export async function suppliedScreenshotWithSize(file: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
    if (!screenshotContentTypes.some(type => type === file.type))
        throw new SuppliedImageError('type', 'Choose a PNG, JPEG or WebP image.');
    if (file.size > MAX_SUPPLIED_IMAGE_BYTES) throw new SuppliedImageError('size', 'Choose an image of at most 25 MB.');
    const unopened = () => new SuppliedImageError('open', 'This image could not be opened. Choose a valid PNG, JPEG or WebP image.');
    const unread = () => new SuppliedImageError('read', 'The image could not be read. Try uploading it again.');
    // Decoded from the file itself: no page image request, so a host's img-src does not apply
    let image: ImageBitmap;
    try { image = await createImageBitmap(file); } catch { throw unopened(); }
    try {
        const { width, height } = image;
        if (!width || !height) throw unopened();
        if (file.size <= MAX_SCREENSHOT_BYTES && width <= MAX_SCREENSHOT_DIMENSION && height <= MAX_SCREENSHOT_DIMENSION) {
            try { return { dataUrl: await readAsDataUrl(file), width, height }; } catch { throw unread(); }
        }
        try { return await smaller(image); } catch { throw unread(); }
    } finally {
        image.close();
    }
}

/** At most the capture's size on a side, then encoded like a capture */
function smaller(image: ImageBitmap) {
    const { side } = encodedScreenshotLimits;
    const fit = Math.min(1, side / image.width, side / image.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * fit));
    canvas.height = Math.max(1, Math.round(image.height * fit));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    // JPEG has no transparency: a window's shadow would turn black, so it goes on white
    if (!encodesWebp()) {
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return encodeScreenshotInBackground(canvas);
}
