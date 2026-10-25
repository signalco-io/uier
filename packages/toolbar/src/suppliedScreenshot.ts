import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DIMENSION, screenshotContentTypes } from './screenshotPolicy';

/** Files and clipboard images use the same formats and limits as stored automatic captures. */
export async function suppliedScreenshot(file: Blob): Promise<string> {
    if (!screenshotContentTypes.some(type => type === file.type))
        throw new Error('Choose a PNG, JPEG or WebP image.');
    if (file.size > MAX_SCREENSHOT_BYTES) throw new Error('Choose an image of at most 512 KB.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('The image could not be read. Try uploading it again.'));
        reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = dataUrl;
    try { await image.decode(); } catch { throw new Error('This image could not be opened. Choose a valid PNG, JPEG or WebP image.'); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > MAX_SCREENSHOT_DIMENSION || image.naturalHeight > MAX_SCREENSHOT_DIMENSION)
        throw new Error('Choose an image of at most 4096 pixels on each side.');
    return dataUrl;
}
