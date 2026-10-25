/** Shared by browser uploads and the API. Automatic captures target a smaller budget. */
export const MAX_SCREENSHOT_BYTES = 512 * 1024;
export const MAX_SCREENSHOT_DIMENSION = 4096;
export const screenshotContentTypes = ['image/webp', 'image/jpeg', 'image/png'] as const;
