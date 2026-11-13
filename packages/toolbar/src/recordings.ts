'use client';

import { useEffect, useRef, useState } from 'react';

export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
export const MAX_RECORDING_DURATION = 60;
export const recordingContentTypes = ['video/webm', 'video/mp4'] as const;
export type RecordingContentType = typeof recordingContentTypes[number];
export type RecordingInfo = { id: string; contentType: RecordingContentType; size: number; duration: number; width: number; height: number };
export type RecordingClip = Omit<RecordingInfo, 'id'> & { blob: Blob; key: string; name: string };
export type RecordingProblem = 'unsupported' | 'permission' | 'type' | 'size' | 'duration' | 'read' | 'capture' | 'upload';
export type RecordingLocation = { url: string; expiresAt: string };

/** A time as a player shows it, in whole seconds rounded down: 0:07, 1:00 */
export const recordingClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** A clip's length like its player's, so both say the same; never 0:00 for a clip under a second */
export const recordingLength = (seconds: number) => recordingClock(Math.max(1, seconds));

export function canRecordScreen() {
    return typeof window !== 'undefined' && window.isSecureContext && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
        && typeof MediaRecorder !== 'undefined';
}

/** Read only browser metadata here; the API independently inspects the actual uploaded container. */
async function inspectVideo(blob: Blob): Promise<{ duration: number; width: number; height: number }> {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    try {
        return await new Promise((resolve, reject) => {
            const finish = () => {
                if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) return;
                window.clearTimeout(timeout);
                resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
            };
            const timeout = window.setTimeout(() => reject(new Error('read')), 10_000);
            const done = () => { window.clearTimeout(timeout); };
            video.onloadedmetadata = () => {
                if (!Number.isFinite(video.duration)) {
                    // MediaRecorder WebM files may omit Duration; asking for the end finds the last timestamp.
                    video.currentTime = Number.MAX_SAFE_INTEGER;
                } else { finish(); }
            };
            video.ondurationchange = finish;
            video.ontimeupdate = finish;
            video.onerror = () => { done(); reject(new Error('read')); };
            video.src = url;
        });
    } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
    }
}

/**
 * MediaRecorder writes WebM as a live stream: no Duration in its Info element, so players show no
 * length and cannot seek. This adds it to a finished capture. Anything unexpected (a sized Segment,
 * a seek index before Info, a Duration that is already there) leaves the bytes as they were.
 */
export async function withWebmDuration(blob: Blob, seconds: number): Promise<Blob> {
    try {
        const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
        let at = 0;
        const width = () => {
            const length = Math.clz32(head[at] ?? 0) - 23;
            if (length < 1 || length > 8 || at + length > head.length) throw new Error('webm');
            return length;
        };
        const id = () => {
            const length = width();
            let value = 0;
            for (let index = 0; index < length; index++) value = value * 256 + head[at++]!;
            return value;
        };
        const size = () => {
            const length = width();
            let value = head[at]! & (0xff >> length);
            let unknown = value === (0xff >> length);
            for (let index = 1; index < length; index++) { value = value * 256 + head[at + index]!; unknown &&= head[at + index] === 0xff; }
            at += length;
            return { length, value, unknown };
        };
        if (id() !== 0x1a45dfa3) return blob;
        // Not `at += size().value`: that reads `at` before `size()` moves it.
        const header = size();
        at += header.value;
        if (id() !== 0x18538067 || !size().unknown) return blob;
        while (at < head.length) {
            const element = id();
            const sizeAt = at;
            const info = size();
            if (element !== 0x1549a966) {
                // Clusters, or an index whose positions an insertion would shift: not this file.
                if (element === 0x1f43b675 || element === 0x114d9b74 || element === 0x1c53bb6b || info.unknown) return blob;
                at += info.value;
                continue;
            }
            const end = at + info.value;
            if (info.unknown || end > head.length) return blob;
            let scale = 1_000_000;
            while (at < end) {
                const child = id();
                const length = size().value;
                if (child === 0x4489) return blob;
                if (child === 0x2ad7b1) { scale = 0; for (let index = 0; index < length; index++) scale = scale * 256 + head[at + index]!; }
                at += length;
            }
            const grown = info.value + 11;
            if (at !== end || !scale || grown >= 2 ** (7 * info.length) - 1) return blob;
            const before = head.slice(0, end);
            for (let index = info.length - 1, rest = grown; index >= 0; index--, rest = Math.floor(rest / 256)) before[sizeAt + index] = rest % 256;
            before[sizeAt]! |= 0x80 >> (info.length - 1);
            const duration = new Uint8Array(11);
            duration.set([0x44, 0x89, 0x88]);
            new DataView(duration.buffer).setFloat64(3, seconds * 1_000_000_000 / scale);
            return new Blob([before, duration, blob.slice(end)], { type: blob.type });
        }
        return blob;
    } catch {
        return blob;
    }
}

export type RecordingState = ReturnType<typeof useRecording>;

/** Recording bytes and object URLs never enter draft storage. Every capture belongs to this mounted owner. */
export function useRecording(initial?: RecordingClip) {
    const [clip, setClip] = useState(initial);
    const clipRef = useRef(initial);
    const [previewUrl, setPreviewUrl] = useState<string>();
    const [phase, setPhase] = useState<'idle' | 'choosing' | 'recording' | 'reading'>('idle');
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState<RecordingProblem>();
    const session = useRef(0);
    const mounted = useRef(true);
    const media = useRef<MediaStream | undefined>(undefined);
    const recorder = useRef<MediaRecorder | undefined>(undefined);
    const interval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
    const started = useRef(0);
    const busyRef = useRef(false);
    const save = (next: RecordingClip | undefined) => { clipRef.current = next; if (mounted.current) setClip(next); };
    const cleanTracks = () => {
        if (interval.current) clearInterval(interval.current);
        interval.current = undefined;
        for (const track of media.current?.getTracks() ?? []) track.stop();
        media.current = undefined;
    };
    const stop = () => {
        if (recorder.current?.state === 'recording') recorder.current.stop();
        cleanTracks();
    };
    const discard = () => {
        session.current++;
        stop();
        recorder.current = undefined;
        busyRef.current = false;
        save(undefined);
        if (mounted.current) { setPhase('idle'); setElapsed(0); setError(undefined); }
    };
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; session.current++; stop(); };
    }, []);
    useEffect(() => {
        if (!clip) { setPreviewUrl(undefined); return; }
        const url = URL.createObjectURL(clip.blob);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [clip]);
    // Leaving the document cannot preserve this capture. Ask before losing a live or unsent recording.
    useEffect(() => {
        if (!clip && phase !== 'recording') return;
        const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', leaving);
        return () => window.removeEventListener('beforeunload', leaving);
    }, [clip, phase]);

    const attach = async (file: File) => {
        if (busyRef.current) return;
        const contentType = file.type.split(';')[0] as RecordingContentType;
        if (!recordingContentTypes.includes(contentType)) { setError('type'); return; }
        if (!file.size || file.size > MAX_RECORDING_BYTES) { setError('size'); return; }
        const attempt = ++session.current;
        busyRef.current = true;
        setPhase('reading'); setError(undefined);
        try {
            const metadata = await inspectVideo(file);
            if (metadata.duration > MAX_RECORDING_DURATION) throw new Error('duration');
            if (attempt === session.current && mounted.current)
                save({ blob: file, contentType, size: file.size, name: file.name, key: crypto.randomUUID(), ...metadata });
        } catch (cause) {
            if (attempt === session.current && mounted.current) setError(cause instanceof Error && cause.message === 'duration' ? 'duration' : 'read');
        } finally {
            if (attempt === session.current && mounted.current) { busyRef.current = false; setPhase('idle'); }
        }
    };
    const start = async () => {
        if (busyRef.current) return;
        if (!canRecordScreen()) { setError('unsupported'); return; }
        const attempt = ++session.current;
        busyRef.current = true;
        setPhase('choosing'); setError(undefined);
        try {
            // Called directly by the click handler, before any unrelated await (transient activation).
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
            if (!mounted.current || attempt !== session.current) { stream.getTracks().forEach(track => track.stop()); return; }
            media.current = stream;
            const mimeType = ['video/webm;codecs=vp8', 'video/mp4;codecs=avc1.42E01E', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
            if (!mimeType) throw new Error('unsupported');
            const capture = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000 });
            recorder.current = capture;
            const chunks: Blob[] = [];
            let size = 0;
            let failed = false;
            const settings = stream.getVideoTracks()[0]?.getSettings();
            capture.ondataavailable = event => {
                if (attempt !== session.current || failed) return;
                size += event.data.size;
                if (size > MAX_RECORDING_BYTES) { failed = true; setError('size'); stop(); return; }
                if (event.data.size) chunks.push(event.data);
            };
            capture.onerror = () => {
                if (!mounted.current || attempt !== session.current) return;
                failed = true; setError('capture'); stop();
            };
            capture.onstop = () => {
                if (!mounted.current || attempt !== session.current) return;
                cleanTracks();
                const duration = Math.min(MAX_RECORDING_DURATION, (performance.now() - started.current) / 1000);
                const contentType = capture.mimeType.split(';')[0] as RecordingContentType;
                const captured = new Blob(chunks, { type: capture.mimeType });
                if (failed || !captured.size || !duration || !settings?.width || !settings.height) {
                    busyRef.current = false; setPhase('idle');
                    if (!failed) setError('capture');
                    return;
                }
                const { width, height } = settings;
                void (contentType === 'video/webm' ? withWebmDuration(captured, duration) : Promise.resolve(captured)).then(blob => {
                    if (!mounted.current || attempt !== session.current) return;
                    busyRef.current = false; setPhase('idle');
                    save({ blob, contentType, size: blob.size, duration, width, height,
                        name: `recording.${contentType === 'video/mp4' ? 'mp4' : 'webm'}`, key: crypto.randomUUID() });
                });
            };
            stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (attempt === session.current) stop(); }, { once: true });
            started.current = performance.now();
            setElapsed(0); setPhase('recording');
            capture.start(250);
            interval.current = setInterval(() => {
                if (!mounted.current || attempt !== session.current) return;
                const seconds = (performance.now() - started.current) / 1000;
                setElapsed(Math.min(MAX_RECORDING_DURATION, seconds));
                if (seconds >= MAX_RECORDING_DURATION) stop();
            }, 200);
        } catch (cause) {
            cleanTracks();
            if (mounted.current && attempt === session.current) {
                busyRef.current = false; setPhase('idle');
                setError(cause instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(cause.name) ? 'permission'
                    : cause instanceof Error && cause.message === 'unsupported' ? 'unsupported' : 'capture');
            }
        }
    };
    return { clip, previewUrl, phase, elapsed, error, busy: phase !== 'idle', start, stop, discard, attach,
        current: () => clipRef.current,
        restore: (sent: RecordingClip) => { if (!clipRef.current && !busyRef.current) save(sent); },
        clear: (sent?: RecordingClip) => { if (!sent || clipRef.current === sent) save(undefined); } };
}

export type RecordingRequest = <T>(url: string, init?: { method?: 'POST'; body?: unknown }) => Promise<T | undefined>;
type UploadSession = { id: string; uploadUrl: string; headers?: Record<string, string>; expiresAt: string };
type UploadAttempt = { session?: UploadSession; bytesSent?: boolean; completed?: string; pending?: Promise<string> };
const uploaded = new WeakMap<RecordingClip, Map<string, UploadAttempt>>();

/** Authorize metadata with uier; send binary bytes directly without cookies or reviewer headers. */
export async function uploadRecording(clip: RecordingClip, baseUrl: string, request: RecordingRequest, scope: string | number = ''): Promise<string> {
    let scopes = uploaded.get(clip);
    if (!scopes) { scopes = new Map(); uploaded.set(clip, scopes); }
    const key = `${baseUrl}#${scope}`;
    let attempt = scopes.get(key);
    if (!attempt) { attempt = {}; scopes.set(key, attempt); }
    if (attempt.completed) return attempt.completed;
    if (attempt.pending) return attempt.pending;
    const sending = (async () => {
        // Reissuing the same idempotent init renews an expired grant without reserving another upload.
        if (attempt.session && Date.parse(attempt.session.expiresAt) <= Date.now()) attempt.session = undefined;
        const session = attempt.session ?? await request<UploadSession>(baseUrl, {
            method: 'POST', body: { idempotencyKey: clip.key, contentType: clip.contentType, size: clip.size, duration: clip.duration, width: clip.width, height: clip.height }
        });
        if (!session?.id || !session.uploadUrl) throw new Error('upload');
        attempt.session = session;
        const api = new URL(baseUrl, location.href);
        const target = new URL(session.uploadUrl, api);
        if (target.username || target.password || (target.origin !== api.origin && (target.protocol !== 'https:' || !target.hostname.endsWith('.blob.core.windows.net')))) throw new Error('upload');
        if (!attempt.bytesSent) {
            const response = await fetch(target, { method: 'PUT', body: clip.blob, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
                headers: { 'Content-Type': clip.contentType, ...(session.headers ?? {}) } });
            // A retried immutable PUT may already exist after its response was lost.
            if (!response.ok && response.status !== 412) throw new Error('upload');
            attempt.bytesSent = true;
        }
        const completed = await request<RecordingInfo>(`${baseUrl}/${encodeURIComponent(session.id)}/complete`, { method: 'POST' });
        if (!completed?.id) throw new Error('upload');
        attempt.completed = completed.id;
        return completed.id;
    })();
    attempt.pending = sending;
    try { return await sending; }
    finally { attempt.pending = undefined; }
}
