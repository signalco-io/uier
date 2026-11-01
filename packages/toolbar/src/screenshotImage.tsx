import { useEffect, useRef, type ImgHTMLAttributes } from 'react';
import { runtimeAdapters } from './adapters';

/** Decode bytes without a page img/data/blob request. Important for restrictive host img-src. */
export async function decodeScreenshot(data: string) {
    if (!runtimeAdapters()) {
        const image = new Image(); image.src = data; await image.decode();
        return { image, width: image.naturalWidth, height: image.naturalHeight, close() {} };
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (!match || data.length > 750_000) throw new Error('Invalid screenshot');
    const bytes = Uint8Array.from(atob(match[2]!), c => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: match[1] }));
    return { image, width: image.width, height: image.height, close: () => image.close() };
}
export function ScreenshotImage(props: ImgHTMLAttributes<HTMLImageElement>) {
    if (!runtimeAdapters()) return <img {...props} />;
    return <ScreenshotCanvas {...props} />;
}
function ScreenshotCanvas({ src, width, height, alt, className }: ImgHTMLAttributes<HTMLImageElement>) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        let cancelled = false;
        if (typeof src === 'string') void decodeScreenshot(src).then(decoded => {
            const canvas = ref.current;
            if (!cancelled && canvas) {
                canvas.width = decoded.width; canvas.height = decoded.height;
                canvas.getContext('2d')?.drawImage(decoded.image, 0, 0);
            }
            decoded.close();
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [src]);
    return <canvas ref={ref} width={width} height={height} role="img" aria-label={alt} className={className} />;
}
