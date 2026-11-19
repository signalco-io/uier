import sharp from 'sharp';
import type { SiteIcon } from './siteIcons';

const resizableTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const MAX_INPUT_PIXELS = 25_000_000;

// Each variant belongs to the fetched source and can be collected when that source expires or is evicted.
// The route allows only a fixed set of sizes. Concurrent requests for one variant share the resize.
const variants = new WeakMap<SiteIcon, Map<number, Promise<SiteIcon>>>();

async function resizeIcon(icon: SiteIcon, size: number): Promise<SiteIcon> {
    try {
        const image = sharp(icon.data, { limitInputPixels: MAX_INPUT_PIXELS, pages: 1, failOn: 'error' });
        const { width, height } = await image.metadata();
        if (!width || !height || Math.max(width, height) <= size)
            return icon;
        const data = await image.autoOrient().resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer();
        return { data, contentType: 'image/webp' };
    } catch {
        // Keep browser-compatible icons available if the server cannot decode them within its limits.
        return icon;
    }
}

export function siteIconVariant(icon: SiteIcon, size: number) {
    if (!resizableTypes.has(icon.contentType))
        return icon;
    let sizes = variants.get(icon);
    if (!sizes) {
        sizes = new Map();
        variants.set(icon, sizes);
    }
    let variant = sizes.get(size);
    if (!variant) {
        variant = resizeIcon(icon, size);
        sizes.set(size, variant);
    }
    return variant;
}
