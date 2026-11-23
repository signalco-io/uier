/**
 * Encoding an image under the API's limits (MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DIMENSION): the automatic
 * capture (screenshot.ts), a redaction, and the reviewer's own image when it is larger (suppliedScreenshot.ts).
 * Without page access or large dependencies, so the app's reply composer can use it too.
 */

/** A screenshot sent to the API as a data URL; shown only on saved feedback. */
export type CapturedScreenshot = {
    dataUrl: string;
    /** Pixels */
    width: number;
    height: number;
};

/** Under the API's limits, with room to spare */
export const encodedScreenshotLimits = { bytes: 480 * 1024, side: 2400 };

export function readAsDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function bytesOf(dataUrl: string) {
    return Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
}

/** WebP (JPEG where the browser can't make WebP), smaller in quality and then in size until it fits */
export function encodeScreenshot(source: HTMLCanvasElement): CapturedScreenshot {
    let canvas = source;
    for (let attempt = 0; attempt < 6; attempt++) {
        for (const quality of [0.85, 0.7, 0.55]) {
            let dataUrl = canvas.toDataURL('image/webp', quality);
            if (!dataUrl.startsWith('data:image/webp')) {
                dataUrl = canvas.toDataURL('image/jpeg', quality);
            }
            if (bytesOf(dataUrl) <= encodedScreenshotLimits.bytes) {
                return { dataUrl, width: canvas.width, height: canvas.height };
            }
        }
        canvas = resized(canvas, 0.75);
    }
    throw new Error('The screenshot is too large');
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
    return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
}

/** Like `encodeScreenshot`, with the browser encoding outside the page's main thread (`toBlob`) */
export async function encodeScreenshotInBackground(source: HTMLCanvasElement, signal?: AbortSignal): Promise<CapturedScreenshot> {
    let canvas = source;
    for (let attempt = 0; attempt < 6; attempt++) {
        for (const quality of [0.85, 0.7, 0.55]) {
            let blob = await canvasBlob(canvas, 'image/webp', quality);
            if (blob?.type !== 'image/webp') {
                blob = await canvasBlob(canvas, 'image/jpeg', quality);
            }
            signal?.throwIfAborted();
            if (blob && blob.size <= encodedScreenshotLimits.bytes) {
                return { dataUrl: await readAsDataUrl(blob), width: canvas.width, height: canvas.height };
            }
        }
        canvas = resized(canvas, 0.75);
    }
    throw new Error('The screenshot is too large');
}

function resized(source: HTMLCanvasElement, factor: number) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * factor));
    canvas.height = Math.max(1, Math.round(source.height * factor));
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
}

let webpEncoding: boolean | undefined;
/** Whether the browser's canvas makes WebP (Safari makes JPEG instead, which has no transparency) */
export function encodesWebp() {
    if (webpEncoding === undefined) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        webpEncoding = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    }
    return webpEncoding;
}
