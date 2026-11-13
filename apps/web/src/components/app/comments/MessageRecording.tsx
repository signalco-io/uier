'use client';

import { useEffect, useRef, useState } from 'react';
import { VideoIcon } from 'lucide-react';
import { recordingLength, type RecordingInfo, type RecordingLocation } from '@uier/toolbar/recordings';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { useAppI18n } from '@/src/lib/i18n/client';

/** URL credentials stay in this mounted player and are renewed against current thread access. */
export function MessageRecording({ recording, projectId, commentId, itemId }: {
    recording: RecordingInfo; projectId: string; commentId: string; itemId?: string;
}) {
    const { t } = useAppI18n();
    const endpoint = `/api/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}${itemId ? `/replies/${encodeURIComponent(itemId)}` : ''}/recording`;
    const [location, setLocation] = useState<RecordingLocation>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const player = useRef<HTMLVideoElement>(null);
    const request = useRef<AbortController | undefined>(undefined);
    const resume = useRef({ time: 0, playing: false });
    const retried = useRef(false);
    const restoring = useRef(false);
    const current = useRef<RecordingLocation | undefined>(undefined);
    useEffect(() => {
        setLocation(undefined); current.current = undefined; retried.current = false; resume.current = { time: 0, playing: false };
        setError(false); setLoading(false);
        return () => { request.current?.abort(); request.current = undefined; };
    }, [endpoint, recording.id]);

    const load = async (play = false) => {
        if (request.current) return;
        const abort = new AbortController();
        request.current = abort;
        if (play) resume.current.playing = true;
        setLoading(true); setError(false);
        try {
            const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: abort.signal, headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error('unavailable');
            const next = await response.json() as RecordingLocation;
            const url = new URL(next.url, window.location.href);
            if (!['https:', 'http:'].includes(url.protocol) || !Number.isFinite(Date.parse(next.expiresAt))) throw new Error('unavailable');
            if (abort.signal.aborted) return;
            const sameUrl = current.current?.url === url.href;
            current.current = { url: url.href, expiresAt: next.expiresAt };
            restoring.current = true;
            setLocation(current.current);
            // Two authorizations within one signing interval may return the same URL. A failed
            // native player still needs an explicit reload when its src attribute did not change.
            if (sameUrl) player.current?.load();
        } catch {
            if (!abort.signal.aborted) setError(true);
        } finally {
            if (!abort.signal.aborted) { request.current = undefined; setLoading(false); }
        }
    };
    const expiresSoon = () => !current.current || Date.parse(current.current.expiresAt) <= Date.now() + 5_000;
    const label = itemId ? t('Recording attached to reply') : t('Recording attached to comment');
    return <div className="mt-1 w-full max-w-xl min-w-0 space-y-1.5" data-comment-recording={recording.id}>
        {!location || error ? <Button variant="outline" size="sm" disabled={loading} className="pointer-coarse:min-h-11"
            onClick={() => { retried.current = false; void load(true); }}>
            {loading ? <Spinner data-icon="inline-start" /> : <VideoIcon data-icon="inline-start" />}
            {error ? t('Retry recording') : label}
            <span className="font-mono tabular-nums text-muted-foreground">{recordingLength(recording.duration)}</span>
        </Button> : <video ref={player} src={location.url} crossOrigin="anonymous" controls muted playsInline preload="metadata"
            aria-label={label} style={{ aspectRatio: `${recording.width} / ${recording.height}` }}
            className="block max-h-80 w-full rounded-lg border bg-muted object-contain"
            onLoadedMetadata={() => {
                const video = player.current;
                if (!video) return;
                if (resume.current.time > 0) video.currentTime = resume.current.time;
                if (resume.current.playing) void video.play().catch(() => undefined);
                restoring.current = false;
            }}
            onTimeUpdate={() => { if (player.current && !restoring.current) resume.current.time = player.current.currentTime; }}
            onPlay={() => { resume.current.playing = true; if (expiresSoon()) void load(); }}
            onPause={() => { if (!restoring.current) resume.current.playing = false; }}
            onSeeking={() => {
                if (player.current) resume.current.time = player.current.currentTime;
                if (expiresSoon()) void load();
            }}
            onError={() => {
                if (retried.current) { setError(true); return; }
                retried.current = true;
                void load();
            }} />}
        {loading && location && <p role="status" className="m-0 text-xs text-muted-foreground">{t('Loading recording...')}</p>}
        {error && <p role="alert" className="m-0 text-xs text-destructive">{t('This recording could not be loaded. Try again.')}</p>}
    </div>;
}
