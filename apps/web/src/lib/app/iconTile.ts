/**
 * Which tile an icon draws on (`ProjectMark`, uier #496): most favicons are dark ink drawn for light browser tabs and
 * keep the light tile in both themes; light ink on a transparent background (a white or pale yellow logo) would vanish
 * on it and draws on a dark tile instead. Decided once per icon from its pixels, when the same-origin image loads
 * or when this browser's copy is saved (`imageCache`), so the tile never changes after the icon shows.
 */
export type IconTile = 'light' | 'dark';

/** The icon is drawn this many pixels a side to be measured */
const SIDE = 24;
/** At least this share of the square transparent: a transparent background, not an opaque or rounded-square icon */
const MIN_TRANSPARENT = 0.1;
/** Relative luminance above which a colour contrasts less than 2.3:1 with the light tile */
const LIGHT_LUMINANCE = 0.4;
/** At least this share of the icon's visible pixels light */
const MIN_LIGHT = 0.6;

const linear = Array.from({ length: 256 }, (_, value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

/** The tile for an image that has loaded; the light one when it cannot be measured */
export function measureIconTile(image: CanvasImageSource): IconTile {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = SIDE;
        canvas.height = SIDE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context)
            return 'light';
        context.drawImage(image, 0, 0, SIDE, SIDE);
        const { data } = context.getImageData(0, 0, SIDE, SIDE);
        let transparent = 0;
        let visible = 0;
        let light = 0;
        for (let index = 0; index < data.length; index += 4) {
            if (data[index + 3]! < 128) {
                transparent++;
                continue;
            }
            visible++;
            const luminance = 0.2126 * linear[data[index]!]! + 0.7152 * linear[data[index + 1]!]! + 0.0722 * linear[data[index + 2]!]!;
            if (luminance > LIGHT_LUMINANCE)
                light++;
        }
        return visible > 0 && transparent >= MIN_TRANSPARENT * SIDE * SIDE && light >= MIN_LIGHT * visible ? 'dark' : 'light';
    } catch {
        // A canvas the image tainted, or an image the browser cannot draw
        return 'light';
    }
}

/** {@link measureIconTile} of image bytes (this browser's copy) */
export async function blobIconTile(blob: Blob): Promise<IconTile> {
    if (typeof document === 'undefined')
        return 'light';
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return measureIconTile(image);
    } catch {
        return 'light';
    } finally {
        URL.revokeObjectURL(url);
    }
}
