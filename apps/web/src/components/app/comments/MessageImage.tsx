'use client';

import { Button } from '@/src/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';

/** Same thumbnail and keyboard/touch expansion for comment and reply images. */
export function MessageImage({ image, reply = false }: { image: { url: string; width: number; height: number }; reply?: boolean }) {
    // The button names the image; the image says what it shows, without "Screenshot of" (screen readers announce images)
    const label = reply ? 'Image attached to reply' : 'Screenshot of the commented part of the page';
    const alt = reply ? 'Image attached to reply' : 'Commented part of the page';
    return <Dialog>
        <DialogTrigger render={<Button variant="ghost" className="mt-1 h-auto max-w-full self-start p-0" aria-label={label} />}>
            <img src={image.url} width={image.width} height={image.height} alt={alt} loading="lazy"
                className="block h-auto max-h-56 w-auto max-w-full rounded-lg border object-contain" />
        </DialogTrigger>
        <DialogContent className="sm:max-w-4xl" aria-describedby={undefined}>
            <DialogHeader><DialogTitle>{reply ? 'Reply image' : 'Screenshot'}</DialogTitle></DialogHeader>
            <img src={image.url} width={image.width} height={image.height} alt={reply ? 'Expanded reply image' : 'Expanded screenshot'}
                className="max-h-[70dvh] w-full object-contain" />
        </DialogContent>
    </Dialog>;
}
