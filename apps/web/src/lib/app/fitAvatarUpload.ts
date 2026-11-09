import { MAX_AVATAR_UPLOAD_BYTES } from './avatarLimits';

/** Longer side of a photo scaled down in the browser before upload, when the file is over the limit */
const SHRINK_TO = 1024;

/**
 * A photo over the upload limit is scaled down here first (a phone camera's often is); the server
 * still checks and re-encodes whatever arrives. Anything the browser cannot draw goes as it is.
 */
export async function fitForUpload(file: File): Promise<Blob> {
    if (file.size <= MAX_AVATAR_UPLOAD_BYTES) return file;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, SHRINK_TO / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        return await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob ?? file), type, 0.9));
    } catch {
        return file;
    }
}

