'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ProofAnchor } from '@/src/lib/proofs/threadModel';
import { clamp, videoTime } from './coordinates';
import { ProofSelect } from './ProofSelect';

type VideoPosition = { ms: number; nonce: number };

export function VideoProof({ url, label, durationMs, frameRate, poster, position, range, proposal, onTime, onAnchor, surfaceId }: {
    url: string; label: string; durationMs?: number; frameRate?: number; poster?: string; position?: VideoPosition;
    range?: { startMs: number; endMs?: number };
    proposal?: Extract<ProofAnchor, { kind: 'time' }>;
    onTime?: (ms: number) => void; onAnchor?: (anchor: ProofAnchor) => void; surfaceId: string;
}) {
    const { t } = useAppI18n();
    const video = useRef<HTMLVideoElement>(null);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(durationMs ?? 0);
    const [rate, setRate] = useState('1');
    const [playing, setPlaying] = useState(false);
    const [loop, setLoop] = useState(false);
    const [mark, setMark] = useState<number>();
    const [error, setError] = useState(false);
    const [ready, setReady] = useState(false);
    const intervalLength = proposal?.endMs !== undefined ? proposal.endMs - proposal.startMs : undefined;
    const fits = time + (intervalLength ?? 0) <= duration;

    useEffect(() => {
        const player = video.current;
        if (!player) return;
        const metadata = () => {
            const milliseconds = Math.round(player.duration * 1000);
            if (Number.isFinite(milliseconds)) setDuration(durationMs ? Math.min(durationMs, milliseconds) : milliseconds);
            setReady(true);
        };
        player.addEventListener('loadedmetadata', metadata);
        if (player.readyState >= HTMLMediaElement.HAVE_METADATA) metadata();
        return () => player.removeEventListener('loadedmetadata', metadata);
    }, [durationMs]);

    const { ms: requestedTime, nonce } = position ?? {};
    useEffect(() => {
        const player = video.current;
        if (!player || !ready || requestedTime === undefined) return;
        player.pause();
        player.currentTime = clamp(requestedTime / 1000, 0, player.duration);
    }, [requestedTime, nonce, ready]);

    const seek = (ms: number) => {
        const player = video.current;
        if (!player || !ready) return;
        player.currentTime = clamp(ms, 0, duration) / 1000;
        setTime(Math.round(player.currentTime * 1000));
        onTime?.(Math.round(player.currentTime * 1000));
    };
    function step(direction: 1 | -1) {
        const player = video.current;
        if (!player) return;
        player.pause();
        seek(player.currentTime * 1000 + direction * 1000 / (frameRate && frameRate > 0 ? frameRate : 30));
    }

    return <div className="relative size-full bg-background">
        <video ref={video} src={url} poster={poster} aria-label={label} className="block size-full object-contain"
            playsInline preload="metadata" onError={() => setError(true)}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onTimeUpdate={event => {
                const player = event.currentTarget;
                const now = Math.round(player.currentTime * 1000);
                setTime(now);
                onTime?.(now);
                const end = range?.endMs ?? duration;
                if (loop && end > (range?.startMs ?? 0) && now >= end) {
                    player.currentTime = (range?.startMs ?? 0) / 1000;
                    if (player.paused) void player.play().catch(() => setError(true));
                }
            }} />
        {error && <p role="alert" className="absolute inset-0 m-0 grid place-items-center bg-background/90 p-4 text-destructive">{t('This video could not be played.')}</p>}
        {!error && <div className="absolute inset-x-1 bottom-1 z-10 flex flex-col gap-1 rounded-lg bg-background/90 p-1" data-proof-control="">
            <div className="flex items-center gap-2 px-1">
                <Input type="range" min={0} max={Math.max(1, duration)} step={1} aria-label={t('Video position')}
                    value={Math.min(time, duration)} onChange={event => seek(Number(event.target.value))} disabled={!ready} />
                <span className="shrink-0 font-mono text-xs">{videoTime(time)} / {videoTime(duration)}</span>
            </div>
            <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" disabled={!ready} onClick={() => {
                    const player = video.current;
                    if (!player) return;
                    if (player.paused) void player.play().catch(() => setError(true));
                    else player.pause();
                }}>{t(playing ? 'Pause' : 'Play')}</Button>
                <Button size="sm" variant="ghost" disabled={!ready} onClick={() => step(-1)}>{t('Step backward')}</Button>
                <Button size="sm" variant="ghost" disabled={!ready} onClick={() => step(1)}>{t('Step forward')}</Button>
                <ProofSelect label={t('Playback speed')} value={rate} items={['0.5', '1', '1.5', '2'].map(value => ({ value, label: `${value}×` }))}
                    disabled={!ready} onChange={value => {
                        if (video.current) video.current.playbackRate = Number(value);
                        setRate(value);
                    }} />
                <Button size="sm" variant={loop ? 'secondary' : 'ghost'} aria-pressed={loop} disabled={!ready} onClick={() => setLoop(value => !value)}>{t('Loop')}</Button>
                {onAnchor && durationMs !== undefined && <>
                    {proposal && <Button size="sm" variant="secondary" disabled={!ready || !fits} onClick={() => {
                        const player = video.current;
                        if (!player) return;
                        player.pause();
                        const startMs = Math.round(player.currentTime * 1000);
                        if (startMs + (intervalLength ?? 0) > duration) return;
                        onAnchor({ kind: 'time', surfaceId, startMs, geometry: proposal.geometry,
                            ...(intervalLength !== undefined ? { endMs: startMs + intervalLength } : {}) });
                    }}>{t(proposal.geometry ? 'Keep position at this time' : 'Confirm this time')}</Button>}
                    <Button size="sm" variant="ghost" disabled={!ready} onClick={() => {
                        const player = video.current;
                        if (!player) return;
                        player.pause();
                        onAnchor({ kind: 'time', startMs: clamp(Math.round(player.currentTime * 1000), 0, durationMs), surfaceId });
                    }}>{t('Annotate time')}</Button>
                    <Button size="sm" variant="ghost" disabled={!ready} onClick={() => {
                        const player = video.current;
                        if (!player) return;
                        const end = clamp(Math.round(player.currentTime * 1000), 0, durationMs);
                        if (mark === undefined) setMark(end);
                        else {
                            player.pause();
                            onAnchor({ kind: 'time', startMs: Math.min(mark, end), endMs: Math.max(mark, end), surfaceId });
                            setMark(undefined);
                        }
                    }}>{t(mark === undefined ? 'Start time range' : 'Finish time range')}</Button>
                    {mark !== undefined && <Button size="sm" variant="ghost" onClick={() => setMark(undefined)}>{t('Cancel')}</Button>}
                </>}
            </div>
            {proposal && !fits && <p role="status" className="m-0 px-1 text-xs">{t('The original range does not fit here. Choose a new time range.')}</p>}
        </div>}
    </div>;
}
