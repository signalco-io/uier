/** Profile picture limits, shared by the server (`avatars.ts`) and the Account page */

/** Stored pictures are square WebP images of at most this many pixels on a side */
export const AVATAR_SIZE = 256;
/** Uploads from Account (Vercel refuses request bodies over 4.5 MB) */
export const MAX_AVATAR_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Image types an upload or a provider's picture can have; GIFs keep their first frame */
export const avatarInputTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** The answer to a file of another type, from the server and from the browser before it sends a dropped or pasted one */
export const AVATAR_TYPE_ERROR = 'Use a PNG, JPEG, WebP or GIF image.';
