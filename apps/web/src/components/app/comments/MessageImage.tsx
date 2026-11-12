'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Skeleton } from '@/src/components/ui/skeleton';
import { cn } from '@/src/lib/utils';

/** The thumbnail's height limit (`max-h-56`), in CSS pixels */
const thumbnailMaxHeight = 224;

/**
 * Same thumbnail and keyboard/touch expansion for comment and reply images. The thumbnail takes its final size from
 * the saved width and height before the image arrives (no jump when it does), with a pulsing placeholder until it has
 * loaded, then the image fades in.
 */
export function MessageImage({ image, reply = false }: { image: { url: string; width: number; height: number }; reply?: boolean }) {
    const { t } = useAppI18n();
    const [loaded, setLoaded] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    // A cached image can finish before React attaches `onLoad`; a lazy one not fetched yet has no natural width
    useEffect(() => {
        const element = imageRef.current;
        setLoaded(Boolean(element?.complete && element.naturalWidth > 0));
    }, [image.url]);
    const sized = image.width > 0 && image.height > 0;
    // The button names the image; the image says what it shows, without "Screenshot of" (screen readers announce images)
    const label = reply ? t("Image attached to reply") : t("Screenshot of the commented part of the page");
    const alt = reply ? t("Image attached to reply") : t("Commented part of the page");
    return <Dialog>
        <DialogTrigger render={<Button variant="ghost" className="mt-1 h-auto max-w-full self-start p-0" aria-label={label} />}>
            {sized ? (
                // Its own width or what the height limit allows, narrowed to the column by `max-w-full` (a percentage
                // width would collapse in the button, which takes its content's width)
                <span className="relative block max-w-full overflow-hidden rounded-lg border"
                    style={{ aspectRatio: `${image.width} / ${image.height}`, width: `${Math.min(image.width, Math.round(thumbnailMaxHeight * image.width / image.height))}px` }}>
                    {!loaded && <Skeleton aria-hidden="true" data-image-placeholder="" className="absolute inset-0 rounded-none motion-reduce:animate-none" />}
                    <img ref={imageRef} src={image.url} width={image.width} height={image.height} alt={alt} loading="lazy"
                        onLoad={() => setLoaded(true)} onError={() => setLoaded(true)}
                        className={cn('block size-full object-contain transition-opacity duration-200 motion-reduce:transition-none', loaded ? 'opacity-100' : 'opacity-0')} />
                </span>
            ) : (
                <img src={image.url} alt={alt} loading="lazy" className="block h-auto max-h-56 w-auto max-w-full rounded-lg border object-contain" />
            )}
        </DialogTrigger>
        <DialogContent className="sm:max-w-4xl" aria-describedby={undefined}>
            <DialogHeader><DialogTitle>{reply ? t("Reply image") : t("Screenshot")}</DialogTitle></DialogHeader>
            <img src={image.url} width={image.width} height={image.height} alt={reply ? t("Expanded reply image") : t("Expanded screenshot")}
                className="max-h-[70dvh] w-full object-contain" />
        </DialogContent>
    </Dialog>;
}
