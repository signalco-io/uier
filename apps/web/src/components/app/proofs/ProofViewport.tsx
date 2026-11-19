'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Button } from '@/src/components/ui/button';
import { cn } from '@/src/lib/utils';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ProofVersion } from '@/src/lib/proofs/model';
import type { ProofAnchor, ProofPoint, ProofThread } from '@/src/lib/proofs/threadModel';
import { anchorPoint, anchorForGesture, clamp, normalizedPoint, type ReviewTool, type SpatialTool } from './coordinates';
import { mediaSurface, proofSize, ProofMedia, type MediaSize, type VideoPosition } from './ProofMedia';
import type { PdfDocument } from './PdfProof';

export type ProofFocus = { anchor: ProofAnchor; nonce: number };
export type SynchronizedCenter = { point: ProofPoint; from: 'primary' | 'reference'; nonce: number };

export function ProofViewport({ projectId, version, index, label, zoom, emailWidth, tool = 'browse', focus, draftAnchor, threads = [], selectedThread,
    pins = true, source = 'primary', syncCenter, onCenter, onSelectThread, onAnchor, onDocument, onText, onTime, videoPosition, overlay }: {
    projectId: string; version: ProofVersion; index: number; label: string; zoom: number | 'fit'; emailWidth: number; tool?: ReviewTool; focus?: ProofFocus;
    draftAnchor?: ProofAnchor; threads?: ProofThread[]; selectedThread?: string; pins?: boolean;
    source?: SynchronizedCenter['from']; syncCenter?: SynchronizedCenter; onCenter?: (point: ProofPoint, from: SynchronizedCenter['from']) => void;
    onSelectThread?: (thread: ProofThread) => void; onAnchor?: (anchor: ProofAnchor) => void;
    onDocument?: (document: PdfDocument) => void; onText?: (text: string) => void; onTime?: (ms: number) => void;
    videoPosition?: VideoPosition; overlay?: { version: ProofVersion; index: number; opacity: number };
}) {
    const { t } = useAppI18n();
    const viewport = useRef<HTMLDivElement>(null);
    const surface = useRef<HTMLDivElement>(null);
    const [viewportSize, setViewportSize] = useState<MediaSize>();
    const [measured, setMeasured] = useState<{ id: string; size: MediaSize }>();
    const [preview, setPreview] = useState<ProofAnchor>();
    const [cursor, setCursor] = useState<ProofPoint>({ x: 0.5, y: 0.5 });
    const keyboardStart = useRef<ProofPoint | undefined>(undefined);
    const pointer = useRef<{ id: number; x: number; y: number; left: number; top: number; points: ProofPoint[] } | undefined>(undefined);
    const programmatic = useRef<{ left: number; top: number } | undefined>(undefined);
    const surfaceId = mediaSurface(version, index)?.id;
    const sizeKey = `${version.id}:${index}:${emailWidth}`;
    const base = measured?.id === sizeKey ? measured.size : proofSize(version, index, emailWidth);
    const fit = viewportSize
        ? Math.max(0.02, Math.min(1, (viewportSize.width - 32) / base.width, (viewportSize.height - 32) / base.height))
        : 0.4;
    const scale = zoom === 'fit' ? fit : zoom;
    const width = Math.max(1, Math.round(base.width * scale));
    const height = Math.max(1, Math.round(base.height * scale));
    const onSize = useCallback((size: MediaSize) => {
        if (size.width > 0 && size.height > 0 && Number.isFinite(size.width + size.height)) setMeasured({ id: sizeKey, size });
    }, [sizeKey]);
    const activeAnchor = focus?.anchor;
    const position = activeAnchor?.kind === 'time' ? { ms: activeAnchor.startMs, nonce: focus?.nonce ?? 0 } : videoPosition;

    useLayoutEffect(() => {
        const box = viewport.current;
        if (!box) return;
        const observer = new ResizeObserver(() => setViewportSize({ width: box.clientWidth, height: box.clientHeight }));
        observer.observe(box);
        return () => observer.disconnect();
    }, []);

    const align = useCallback((point: ProofPoint) => {
        const box = viewport.current;
        const work = surface.current;
        if (!box || !work) return;
        const bounds = work.getBoundingClientRect();
        const view = box.getBoundingClientRect();
        const left = clamp(box.scrollLeft + bounds.left - view.left + bounds.width * point.x - box.clientWidth / 2, 0, box.scrollWidth - box.clientWidth);
        const top = clamp(box.scrollTop + bounds.top - view.top + bounds.height * point.y - box.clientHeight / 2, 0, box.scrollHeight - box.clientHeight);
        programmatic.current = { left, top };
        box.scrollTo({ left, top, behavior: 'instant' });
    }, []);
    useLayoutEffect(() => {
        const point = activeAnchor && anchorPoint(activeAnchor);
        if (point && 'surfaceId' in activeAnchor && activeAnchor.surfaceId === surfaceId) align(point);
    }, [activeAnchor, align, focus?.nonce, surfaceId, width, height]);
    useLayoutEffect(() => {
        if (syncCenter && syncCenter.from !== source) align(syncCenter.point);
    }, [align, source, syncCenter, width, height]);
    useEffect(() => {
        keyboardStart.current = undefined;
        pointer.current = undefined;
    }, [tool, surfaceId]);

    function scrolled() {
        const box = viewport.current;
        const work = surface.current;
        if (!box || !work || !onCenter) return;
        const intended = programmatic.current;
        programmatic.current = undefined;
        if (intended && Math.abs(box.scrollLeft - intended.left) < 2 && Math.abs(box.scrollTop - intended.top) < 2) return;
        const bounds = box.getBoundingClientRect();
        onCenter(normalizedPoint(work.getBoundingClientRect(), bounds.left + box.clientWidth / 2, bounds.top + box.clientHeight / 2), source);
    }

    const spatial = Boolean(surfaceId && onAnchor && ['point', 'region', 'drawing'].includes(tool));
    const handlesPointer = spatial || tool === 'pan';
    function start(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || (!spatial && tool !== 'pan') || pointer.current || !viewport.current) return;
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
            left: viewport.current.scrollLeft, top: viewport.current.scrollTop,
            points: [normalizedPoint(target.getBoundingClientRect(), event.clientX, event.clientY)] };
    }
    function move(event: PointerEvent<HTMLDivElement>) {
        const gesture = pointer.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        if (tool === 'pan' && viewport.current) {
            viewport.current.scrollLeft = gesture.left + gesture.x - event.clientX;
            viewport.current.scrollTop = gesture.top + gesture.y - event.clientY;
        } else if (spatial && surfaceId) {
            const point = normalizedPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
            if (tool === 'drawing') {
                if (gesture.points.length >= 300) gesture.points = gesture.points.filter((_, index) => index % 2 === 0);
                gesture.points.push(point);
            } else gesture.points = [gesture.points[0]!, point];
            setPreview(anchorForGesture(tool as SpatialTool, surfaceId, gesture.points));
        }
    }
    function finish(event: PointerEvent<HTMLDivElement>) {
        const gesture = pointer.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        pointer.current = undefined;
        setPreview(undefined);
        if (spatial && surfaceId && onAnchor) {
            const end = normalizedPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
            onAnchor(anchorForGesture(tool as SpatialTool, surfaceId, [...gesture.points, end]));
        }
    }

    function selectedText() {
        const selection = window.getSelection();
        if (tool !== 'text' || !surfaceId || !onAnchor || !selection?.anchorNode || !selection.focusNode) return;
        const root = surface.current?.querySelector('.proof-pdf-text');
        if (!root?.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
        const quote = selection.toString().trim().slice(0, 500);
        if (quote) onAnchor({ kind: 'text', surfaceId, quote });
    }

    const relevantDraft = draftAnchor && 'surfaceId' in draftAnchor && draftAnchor.surfaceId === surfaceId ? draftAnchor : undefined;
    const evidenceAnchor = activeAnchor && 'surfaceId' in activeAnchor && activeAnchor.surfaceId === surfaceId ? activeAnchor : undefined;
    const markerThreads = pins ? threads.filter(thread => thread.location.versionId === version.id
        && 'surfaceId' in thread.location.anchor && thread.location.anchor.surfaceId === surfaceId && anchorPoint(thread.location.anchor)) : [];
    return (
        <div ref={viewport} role="region" aria-label={label} tabIndex={0}
            onScroll={scrolled}
            onKeyDown={event => {
                if (event.target !== event.currentTarget || !spatial || !surfaceId || !onAnchor) return;
                const step = event.shiftKey ? 0.1 : 0.02;
                const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
                if (direction) {
                    event.preventDefault();
                    const next = { x: clamp(cursor.x + direction[0]! * step), y: clamp(cursor.y + direction[1]! * step) };
                    setCursor(next);
                    align(next);
                    if (keyboardStart.current) setPreview(anchorForGesture(tool as SpatialTool, surfaceId, [keyboardStart.current, next]));
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if ((tool === 'region' || tool === 'drawing') && !keyboardStart.current) {
                        keyboardStart.current = cursor;
                        return;
                    }
                    onAnchor(anchorForGesture(tool as SpatialTool, surfaceId, keyboardStart.current ? [keyboardStart.current, cursor] : [cursor]));
                    keyboardStart.current = undefined;
                    setPreview(undefined);
                }
                if (event.key === 'Escape') {
                    keyboardStart.current = undefined;
                    setPreview(undefined);
                }
            }}
            className="group/work h-[min(52dvh,42rem)] min-h-52 overflow-auto rounded-lg border bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-[min(62dvh,52rem)]">
            <div className="relative flex min-h-full w-max min-w-full p-4">
                <div ref={surface} className="relative m-auto shrink-0 bg-background shadow-sm" style={{ width, height }}
                    data-proof-surface={surfaceId} onPointerUp={selectedText} onKeyUp={event => { if (event.shiftKey) selectedText(); }}>
                    <ProofMedia projectId={projectId} version={version} index={index} label={label} width={width} emailWidth={emailWidth} onSize={onSize}
                        onDocument={onDocument} onText={onText} onQuoteTarget={align} anchor={pins ? evidenceAnchor : undefined}
                        videoPosition={position} onAnchor={onAnchor} onTime={onTime} readonly={!onAnchor} />
                    {overlay && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity: overlay.opacity }}>
                        <ProofMedia projectId={projectId} version={overlay.version} index={overlay.index} label={label} width={width} emailWidth={emailWidth} readonly decorative />
                    </div>}
                    {pins && evidenceAnchor && <AnchorShape anchor={evidenceAnchor} />}
                    {pins && relevantDraft && <AnchorShape anchor={relevantDraft} draft />}
                    {preview && spatial && <AnchorShape anchor={preview} draft />}
                    {markerThreads.map(thread => {
                        const point = anchorPoint(thread.location.anchor)!;
                        const selected = thread.id === selectedThread;
                        return <Button key={thread.id} size="icon-sm" variant={selected ? 'default' : 'outline'}
                            aria-label={t('Thread {number}', { number: thread.number ?? '–' })} aria-pressed={selected}
                            tabIndex={handlesPointer ? -1 : undefined} aria-disabled={handlesPointer || undefined}
                            onClick={() => { if (!handlesPointer) onSelectThread?.(thread); }}
                            className={cn('absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm pointer-coarse:size-10',
                                handlesPointer && 'pointer-events-none')}
                            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>
                            {thread.number ?? '•'}</Button>;
                    })}
                    {handlesPointer && <div aria-hidden className={cn('absolute inset-0 z-30 touch-none select-none', tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair')}
                        onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { pointer.current = undefined; setPreview(undefined); }} />}
                    {spatial && <span aria-hidden className="pointer-events-none absolute z-20 hidden size-4 -translate-1/2 rounded-full border-2 border-accent bg-background group-focus-visible/work:block"
                        style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }} />}
                </div>
            </div>
        </div>
    );
}

function AnchorShape({ anchor, draft }: { anchor: ProofAnchor; draft?: boolean }): ReactNode {
    const paint = draft ? 'border-dashed border-ring bg-ring/15' : 'border-ring bg-ring/20';
    if (anchor.kind === 'region') return <div aria-hidden className={cn('pointer-events-none absolute z-10 border-2', paint)}
        style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%`, width: `${anchor.width * 100}%`, height: `${anchor.height * 100}%` }} />;
    if (anchor.kind === 'point') return <span aria-hidden className={cn('pointer-events-none absolute z-10 size-5 -translate-1/2 rounded-full border-2', paint)}
        style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} />;
    if (anchor.kind === 'drawing') return (
        <svg aria-hidden viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 z-10 size-full stroke-ring">
            {anchor.strokes.map((stroke, index) => <polyline key={index} points={stroke.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ')}
                fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
        </svg>
    );
    return null;
}
