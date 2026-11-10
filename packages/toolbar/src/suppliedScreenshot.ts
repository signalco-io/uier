import { decodeScreenshot } from './screenshotImage';
import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DIMENSION, screenshotContentTypes } from './screenshotPolicy';

/** Why a supplied image was refused: the toolbar words it in its language, the app keeps the English message */
export type SuppliedImageProblem = 'type' | 'size' | 'read' | 'open' | 'dimensions';

export class SuppliedImageError extends Error {
    constructor(readonly problem: SuppliedImageProblem, message: string) {
        super(message);
        this.name = 'SuppliedImageError';
    }
}

/** Files and clipboard images use the same formats and limits as stored automatic captures. */
export async function suppliedScreenshot(file: Blob): Promise<string> {
    if (!screenshotContentTypes.some(type => type === file.type))
        throw new SuppliedImageError('type', 'Choose a PNG, JPEG or WebP image.');
    if (file.size > MAX_SCREENSHOT_BYTES) throw new SuppliedImageError('size', 'Choose an image of at most 512 KB.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new SuppliedImageError('read', 'The image could not be read. Try uploading it again.'));
        reader.readAsDataURL(file);
    });
    let image;
    try { image = await decodeScreenshot(dataUrl); } catch { throw new SuppliedImageError('open', 'This image could not be opened. Choose a valid PNG, JPEG or WebP image.'); }
    const { width, height } = image;
    image.close();
    if (!width || !height || width > MAX_SCREENSHOT_DIMENSION || height > MAX_SCREENSHOT_DIMENSION)
        throw new SuppliedImageError('dimensions', 'Choose an image of at most 4096 pixels on each side.');
    return dataUrl;
}
