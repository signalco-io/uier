/** Shared by browser uploads and the API. Automatic captures target a smaller budget. */
export const MAX_SCREENSHOT_BYTES = 512 * 1024;
export const MAX_SCREENSHOT_DIMENSION = 4096;
export const screenshotContentTypes = ['image/webp', 'image/jpeg', 'image/png'] as const;
/**
 * The reviewer's own image, before it is sent: one larger than the API's limits is made smaller in the browser
 * (suppliedScreenshot.ts), like a full-screen screenshot of a high-density display
 */
export const MAX_SUPPLIED_IMAGE_BYTES = 25 * 1024 * 1024;
