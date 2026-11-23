import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@uier/ui-primitives/Button';
import { apiRequest, required } from '../hooks/api';
import { toolbarConfig } from '../config';
import { useMessages, useToolbarLanguage } from '../i18n';
import { useProjectViewer } from '../project/ProjectGate';
import { privatePreviewHidden, subscribeToCapturePrivacy } from '../capturePrivacy';
import { InkScope } from './InkScope';

type Pair = { id: string; width: number; height: number; page: string };

export function useStagingPair(path: string) {
    const { isMember, draftScope } = useProjectViewer();
    const [id] = useState(() => new URLSearchParams(location.search).get('uier-design'));
    const enabled = Boolean(toolbarConfig.project && isMember && id && /^[a-f0-9]{64}$/.test(id));
    const query = useQuery({
        queryKey: ['staging-pair', draftScope, id, path],
        enabled, retry: false, refetchInterval: 30_000,
        queryFn: async () => required(await apiRequest<Pair>(`${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/staging?${new URLSearchParams({ pair: id!, path })}`))
    });
    return { pair: enabled && !query.isError ? query.data : undefined, unavailable: enabled && query.isError };
}

export function StagingComparison({ pair, unavailable, onReport }: { pair?: Pair; unavailable: boolean; onReport: (keyboard: boolean) => void }) {
    const t = useMessages().staging;
    const language = useToolbarLanguage();
    const [open, setOpen] = useState(false);
    const [ready, setReady] = useState(false);
    const [opacity, setOpacity] = useState(50);
    const [width, setWidth] = useState(() => document.documentElement.clientWidth);
    const [height, setHeight] = useState(() => innerHeight);
    const hidden = useSyncExternalStore(subscribeToCapturePrivacy, privatePreviewHidden);
    const frame = useRef<HTMLIFrameElement>(null);
    const sliderId = useId();
    const origin = new URL(toolbarConfig.apiUrl, location.href).origin;

    useEffect(() => {
        if (!open || !pair) return;
        const update = () => {
            setWidth(document.documentElement.clientWidth);
            setHeight(innerHeight);
            if (frame.current) {
                frame.current.style.left = ready ? `${-window.scrollX}px` : '';
                frame.current.style.top = ready ? `${-window.scrollY}px` : '';
            }
        };
        const message = (event: MessageEvent) => {
            if (event.origin === origin && event.source === frame.current?.contentWindow && event.data?.type === 'uier:staging-preview') {
                setReady(event.data.ready === true);
                if (event.data.ready) frame.current?.blur();
            }
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('message', message);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update);
            window.removeEventListener('message', message);
        };
    }, [open, pair, origin, ready]);

    if (!pair && !unavailable) return null;
    const src = pair && `${origin}/api/review/${encodeURIComponent(toolbarConfig.project!)}/staging-preview/${pair.id}?${new URLSearchParams({ lang: language })}`;
    return <InkScope>
        <section aria-label={t.label} className="fixed right-2 bottom-24 z-[51] sm:bottom-auto sm:top-2 max-w-[calc(100vw-1rem)] rounded-xl border bg-background p-2 text-sm text-foreground">
            {!pair ? <p role="status" className="m-1">{t.unavailable}</p> : <>
                <Button size="sm" variant="outlined" className="pointer-coarse:min-h-11" aria-pressed={open} data-uier-staging-toggle=""
                    onClick={() => { setOpen(!open); setReady(false); }}>{t.toggle}</Button>
                <Button size="sm" variant="plain" className="pointer-coarse:min-h-11" data-uier-staging-report=""
                    onClick={event => onReport(event.detail === 0)}>{t.report}</Button>
                {open && <div className="mt-2 flex flex-col gap-2 px-1">
                    <small>{t.viewport(pair.width, pair.height)}</small>
                    {(width !== pair.width || height !== pair.height) && <small>{t.currentViewport(width, height)}</small>}
                    <a className="inline-flex min-h-11 items-center self-start underline underline-offset-2"
                        href={`${origin}/api/proofs/${encodeURIComponent(toolbarConfig.project!)}/staging/${pair.id}/design`}
                        target="_blank" rel="noopener noreferrer">{t.approvedDesign}</a>
                    {ready && <label htmlFor={sliderId} className="flex min-h-11 items-center gap-2">{t.opacity}
                        <input id={sliderId} type="range" min="0" max="100" value={opacity} onChange={event => setOpacity(Number(event.target.value))} />
                    </label>}
                </div>}
            </>}
        </section>
        {open && pair && <iframe ref={frame} src={src} title={t.preview} referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            hidden={hidden} tabIndex={ready ? -1 : 0}
            className={hidden ? 'hidden' : ready ? 'pointer-events-none fixed left-0 top-0 z-[39] border-0'
                : 'fixed right-2 bottom-64 z-[50] sm:bottom-auto sm:top-56 h-32 w-72 max-w-[calc(100vw-1rem)] rounded-xl border bg-background'}
            style={ready ? { width: pair.width, height: pair.height, opacity: opacity / 100 } : undefined} />}
    </InkScope>;
}
