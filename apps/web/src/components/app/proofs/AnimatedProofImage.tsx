'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { useAppI18n } from '@/src/lib/i18n/client';

type Frame = { x: number; y: number; width: number; height: number; duration: number; clear: boolean; blend: boolean; source: Blob };

// The image processor publishes animated WebP. Each ANMF payload is an independently
// decodable WebP image. Compositing those frames keeps pause/step available without WebCodecs.
function readAnimation(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const uint24 = (offset: number) => bytes[offset]! + (bytes[offset + 1]! << 8) + (bytes[offset + 2]! << 16);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') throw new Error();
    let width = 0;
    let height = 0;
    const frames: Frame[] = [];
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const start = offset + 8;
        const length = view.getUint32(offset + 4, true);
        const end = start + length;
        if (end > bytes.length) throw new Error();
        if (tag(offset) === 'VP8X' && length >= 10) {
            width = uint24(start + 4) + 1;
            height = uint24(start + 7) + 1;
        }
        if (tag(offset) === 'ANMF' && length > 16) {
            const frameWidth = uint24(start + 6) + 1;
            const frameHeight = uint24(start + 9) + 1;
            const x = uint24(start) * 2;
            const y = uint24(start + 3) * 2;
            if (!width || !height || width * height > 24_000_000 || frames.length >= 160 || x + frameWidth > width || y + frameHeight > height) throw new Error();
            const flags = bytes[start + 15]!;
            const payload = buffer.slice(start + 16, end);
            const header = new Uint8Array(30);
            header.set([82, 73, 70, 70], 0); // RIFF
            new DataView(header.buffer).setUint32(4, 22 + payload.byteLength, true);
            header.set([87, 69, 66, 80, 86, 80, 56, 88, 10], 8); // WEBP VP8X
            if (tag(start + 16) === 'ALPH') header[20] = 16;
            header.set(bytes.subarray(start + 6, start + 12), 24);
            frames.push({ x, y, width: frameWidth, height: frameHeight, duration: Math.max(20, uint24(start + 12)), clear: Boolean(flags & 1),
                blend: !(flags & 2), source: new Blob([header, payload], { type: 'image/webp' }) });
        }
        offset = end + (length % 2);
    }
    if (!frames.length) throw new Error();
    return { width, height, frames };
}

export function AnimatedProofImage({ url, label, controls = true }: { url: string; label: string; controls?: boolean }) {
    const { t } = useAppI18n();
    const [animation, setAnimation] = useState<ReturnType<typeof readAnimation>>();
    const [playing, setPlaying] = useState(false);
    const [frame, setFrame] = useState(0);
    const [error, setError] = useState(false);
    const canvas = useRef<HTMLCanvasElement>(null);
    const drawn = useRef(-1);
    useEffect(() => {
        const controller = new AbortController();
        fetch(url, { signal: controller.signal }).then(response => {
            if (!response.ok) throw new Error();
            return response.arrayBuffer();
        }).then(data => {
            if (!controller.signal.aborted) setAnimation(readAnimation(data));
        }).catch(() => { if (!controller.signal.aborted) setError(true); });
        return () => controller.abort();
    }, [url]);

    useEffect(() => {
        const context = canvas.current?.getContext('2d');
        if (!animation || !context) return;
        let active = true;
        let nextFrame: ReturnType<typeof setTimeout> | undefined;
        async function draw() {
            if (!context || !animation) return;
            const { frames, width, height } = animation;
            if (drawn.current === frame - 1 && frame > 0) {
                const previous = frames[frame - 1]!;
                if (previous.clear) context.clearRect(previous.x, previous.y, previous.width, previous.height);
            } else if (drawn.current !== frame) {
                context.clearRect(0, 0, width, height);
                drawn.current = -1;
            }
            for (let index = drawn.current + 1; index <= frame; index++) {
                const item = frames[index]!;
                const bitmap = await createImageBitmap(item.source);
                if (active) {
                    if (!item.blend) context.clearRect(item.x, item.y, item.width, item.height);
                    context.drawImage(bitmap, item.x, item.y);
                    if (index < frame && item.clear) context.clearRect(item.x, item.y, item.width, item.height);
                    drawn.current = index;
                }
                bitmap.close();
                if (!active) return;
            }
            if (playing) nextFrame = setTimeout(() => setFrame(value => (value + 1) % frames.length), frames[frame]!.duration);
        }
        void draw().catch(() => { if (active) setError(true); });
        return () => { active = false; clearTimeout(nextFrame); };
    }, [animation, frame, playing]);

    if (error) return <p role="alert" className="m-0 grid h-full place-items-center p-4 text-center text-destructive">{t('This animation could not be rendered.')}</p>;
    if (!animation) return <p role="status" className="m-0 p-4 text-sm text-muted-foreground">{t('Loading animation…')}</p>;
    return <>
        <canvas ref={canvas} width={animation.width} height={animation.height} role="img" aria-label={label} className="block size-full" />
        {controls && <div className="absolute bottom-1 left-1 z-10 flex flex-wrap gap-1 rounded-lg bg-background/90 p-1" data-proof-control="">
            <Button variant="outline" size="sm" onClick={() => setPlaying(value => !value)}>{t(playing ? 'Pause animation' : 'Play animation')}</Button>
            <Button variant="outline" size="sm" onClick={() => {
                setPlaying(false);
                setFrame(value => (value + 1) % animation.frames.length);
            }}>{t('Next animation frame')}</Button>
        </div>}
    </>;
}
