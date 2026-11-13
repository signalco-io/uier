'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { RecordingIcon } from './RecordingIcon';
import { apiRequest, required, currentReviewerRevision } from '../hooks/api';
import { commentUrl } from '../hooks/useComments';
import { useMessages } from '../i18n';
import { recordingLength, type RecordingInfo, type RecordingLocation } from '../recordings';

/** Signed URLs stay in this mounted player only; renewal rechecks the thread's current permissions. */
export function CommentRecording({ commentId, itemId, recording }: { commentId: string; itemId?: string; recording: RecordingInfo }) {
    const t = useMessages().recording;
    const video = useRef<HTMLVideoElement>(null);
    const [location, setLocation] = useState<RecordingLocation>();
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const live = useRef(true);
    const pending = useRef(false);
    const recovered = useRef(false);
    const restore = useRef<{ time: number; playing: boolean } | undefined>(undefined);
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    const load = async () => {
        if (pending.current) return;
        pending.current = true; setLoading(true); setFailed(false);
        const revision = currentReviewerRevision();
        try {
            const next = required(await apiRequest<RecordingLocation>(`${commentUrl(commentId)}${itemId ? `/replies/${encodeURIComponent(itemId)}` : ''}/recording`));
            if (live.current && revision === currentReviewerRevision()) setLocation(next);
        } catch {
            if (live.current) { setLocation(undefined); setFailed(true); }
        } finally {
            pending.current = false;
            if (live.current) setLoading(false);
        }
    };
    const refresh = () => {
        if (pending.current) return;
        restore.current = { time: video.current?.currentTime ?? 0, playing: Boolean(video.current && !video.current.paused) };
        void load();
    };
    return <section aria-label={t.label} className="min-w-0">
        {location ? <video ref={video} key={location.url} src={location.url} controls playsInline preload="metadata" crossOrigin="anonymous"
            className="max-h-72 w-full rounded-lg border bg-muted" aria-label={t.label}
            onLoadedMetadata={() => {
                if (restore.current && video.current) {
                    video.current.currentTime = restore.current.time;
                    if (restore.current.playing) void video.current.play().catch(() => {});
                    restore.current = undefined;
                }
            }}
            onSeeking={() => { if (Date.parse(location.expiresAt) <= Date.now() + 1000) refresh(); }}
            onPlay={() => { if (Date.parse(location.expiresAt) <= Date.now() + 1000) refresh(); }}
            onError={() => {
                if (recovered.current) { setLocation(undefined); setFailed(true); return; }
                recovered.current = true; refresh();
            }} /> : <Button type="button" variant="outlined" size="xs" className="gap-1.5 rounded-md pointer-coarse:min-h-11" disabled={loading}
            startDecorator={<RecordingIcon size={14} />} onClick={() => { recovered.current = false; void load(); }}>
            {loading ? t.loading : failed ? t.retry : t.load}
            <span className="font-mono tabular-nums text-muted-foreground">{recordingLength(recording.duration)}</span>
        </Button>}
        {failed && <p role="status" className="m-0 pt-1 text-xs text-muted-foreground">{t.unavailable}</p>}
    </section>;
}
