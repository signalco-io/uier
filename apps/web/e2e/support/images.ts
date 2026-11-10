import type { Locator, Page } from '@playwright/test';

// Tiny real images (3 x 2 pixels, encoded by Chromium's canvas) for the screenshot tests
export const pngImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAF0lEQVR4AWLi4uL6b9307T+IZmJAAgAAAAD///60tGQAAAAGSURBVAMAXCME8aNkJEMAAAAASUVORK5CYII=';
export const jpegImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAbEAEAAAcAAAAAAAAAAAAAAAAAAwQFBzV1tP/EABQBAQAAAAAAAAAAAAAAAAAAAAT/xAAdEQAABQUAAAAAAAAAAAAAAAAAAQIEsQMzNHFy/9oADAMBAAIRAxEAPwCdVws9K6mmcEAAx5k1ejkHb2UaKB//2Q==';
/** Extended WebP (`VP8X`, with a colour profile), lossy */
export const webpImage = 'data:image/webp;base64,UklGRi4CAABXRUJQVlA4WAoAAAAgAAAAAgAAAQAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggQAAAALACAJ0BKgMAAgAAwBIljAJ0RwB+gGWAfoAC3ZmZAAD+/6IZzL/zGf/6IbQVnOvVzOO8fA9D/P3upaZZiJQAAAA=';
/** Simple lossless WebP (`VP8L`), 1 x 1 */
export const webpLosslessImage = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

type TestFile = { name: string; mimeType: string; buffer: Buffer };

/** Drags a file from outside the browser onto `target` and drops it there */
export async function dropFile(target: Locator, file: TestFile) {
    const dataTransfer = await target.page().evaluateHandle(({ bytes, name, type }) => {
        const data = new DataTransfer();
        data.items.add(new File([Uint8Array.from(bytes)], name, { type }));
        return data;
    }, { bytes: [...file.buffer], name: file.name, type: file.mimeType });
    for (const type of ['dragenter', 'dragover', 'drop']) await target.dispatchEvent(type, { dataTransfer });
}

/** Pastes a file from the clipboard where the focus is, like Ctrl+V or Cmd+V */
export async function pasteFile(page: Page, file: TestFile) {
    await page.evaluate(({ bytes, name, type }) => {
        const clipboard = new DataTransfer();
        clipboard.items.add(new File([Uint8Array.from(bytes)], name, { type }));
        (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    }, { bytes: [...file.buffer], name: file.name, type: file.mimeType });
}
