'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { encodeScreenshot } from '../screenshot';
import { destructiveTextClassName } from './@types/Comments';

type Area = { x: number; y: number; width: number; height: number };
const initialArea: Area = { x: 0, y: 0, width: 25, height: 25 };

/** Only mounted from saved image details. Opaque masks are flattened into replacement bytes. */
export function ScreenshotRedaction({ data, pending, onSave, onCancel }: {
    data: string; pending: boolean; onSave: (data: string) => Promise<void>; onCancel: () => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const startRef = useRef<{ x: number; y: number } | null>(null);
    const savingRef = useRef(false);
    const [ready, setReady] = useState(false);
    const [areas, setAreas] = useState<Area[]>([]);
    const [area, setArea] = useState<Area>(initialArea);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const image = new Image();
        image.src = data;
        image.decode().then(() => {
            if (cancelled) return;
            imageRef.current = image;
            setReady(true);
        }).catch(() => { if (!cancelled) setError('The saved image could not be opened. Close and try again.'); });
        return () => { cancelled = true; imageRef.current = null; };
    }, [data]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!canvas || !image || !ready) return;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0);
        context.fillStyle = 'black';
        for (const mask of areas) {
            const x = Math.floor(mask.x * canvas.width / 100);
            const y = Math.floor(mask.y * canvas.height / 100);
            context.fillRect(x, y, Math.ceil((mask.x + mask.width) * canvas.width / 100) - x,
                Math.ceil((mask.y + mask.height) * canvas.height / 100) - y);
        }
    }, [areas, ready]);

    const point = (event: PointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)),
            y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) };
    };
    const boundedArea = { ...area, width: Math.min(area.width, 100 - area.x), height: Math.min(area.height, 100 - area.y) };
    const save = async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        setError('');
        try {
            if (!canvasRef.current) return;
            await onSave(encodeScreenshot(canvasRef.current).dataUrl);
        } catch {
            setError('Redaction was not confirmed. Your saved image is kept until replacement succeeds. Try again or reload to check it.');
        } finally {
            savingRef.current = false;
        }
    };

    return <section aria-label="Redact screenshot" className="flex flex-col gap-3">
        <p className="m-0 text-sm">Drag over sensitive content, or enter an area as percentages and add it. Black areas replace the image content when saved.</p>
        <canvas ref={canvasRef} aria-label="Image redaction surface" role="img"
            className="block h-auto w-full touch-none rounded-md border"
            onPointerDown={event => {
                if (pending || !ready || event.button !== 0) return;
                startRef.current = point(event);
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
                if (!startRef.current) return;
                const end = point(event), start = startRef.current;
                setArea({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) });
            }}
            onPointerUp={event => {
                const start = startRef.current;
                startRef.current = null;
                if (!start) return;
                const end = point(event);
                const mask = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) };
                if (mask.width > 0 && mask.height > 0) setAreas(current => [...current, mask]);
            }}
            onPointerCancel={() => { startRef.current = null; }} />
        <fieldset disabled={pending || !ready} className="m-0 grid grid-cols-2 gap-2 border-0 p-0">
            <legend className="sr-only">Redaction area in percentages</legend>
            {(['x', 'y', 'width', 'height'] as const).map(key => <Input key={key} type="number"
                label={`${({ x: 'Left', y: 'Top', width: 'Width', height: 'Height' })[key]} (%)`}
                min={0} max={100} step="any" value={Math.round(area[key] * 100) / 100}
                onChange={event => setArea(current => ({ ...current, [key]: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }))} />)}
        </fieldset>
        <div className="flex flex-wrap gap-2">
            <Button variant="outlined" className="min-h-11" disabled={pending || !ready || boundedArea.width <= 0 || boundedArea.height <= 0}
                onClick={() => setAreas(current => [...current, boundedArea])}>Add redaction</Button>
            <Button variant="plain" className="min-h-11" disabled={pending || !areas.length}
                onClick={() => setAreas(current => current.slice(0, -1))}>Undo redaction</Button>
        </div>
        <p role="status" className="m-0 text-xs text-muted-foreground">{areas.length} redaction {areas.length === 1 ? 'area' : 'areas'}. The saved image changes only after you save.</p>
        {error && <p role="alert" className={destructiveTextClassName}>{error}</p>}
        <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={pending || !ready || !areas.length} onClick={() => { void save(); }}>Save redaction</Button>
            <Button variant="plain" className="min-h-11" disabled={pending} onClick={onCancel}>Cancel redaction</Button>
        </div>
    </section>;
}
