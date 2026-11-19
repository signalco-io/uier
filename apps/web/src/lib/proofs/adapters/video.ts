import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';
import { BufferSource, BufferTarget, Conversion, Input, MP4, Mp4OutputFormat, Output, QTFF, WEBM, WebMOutputFormat } from 'mediabunny';
import { apiErrors } from '../../comments/http';
import { MAX_PROOF_UPLOAD_BYTES, proofUploadTypes } from '../model';
import { ProofSourceError, type ProofSourceAdapter } from '../sourceTypes';

const ffmpeg = promisify(execFile);
const maxDuration = 15 * 60;
const maxTranscode = 120;
const formats = { 'video/mp4': MP4, 'video/quicktime': QTFF, 'video/webm': WEBM };
const dimensionsLimit = 3840 * 2160;
const maxInputFrameRate = 120;

let packagedExecutable: Promise<string> | undefined;

async function unpackFfmpeg(archive: string) {
    const directory = await mkdtemp(join(tmpdir(), 'uier-ffmpeg-'));
    const binary = join(directory, 'ffmpeg');
    try {
        await pipeline(createReadStream(archive), createGunzip(), createWriteStream(binary, { mode: 0o700 }));
        return binary;
    } catch {
        await rm(directory, { recursive: true, force: true });
        throw apiErrors.unavailable('Video conversion is unavailable because the packaged processor could not be unpacked.');
    }
}

async function ffmpegCommand() {
    const configured = process.env.UIER_PROOF_FFMPEG_PATH?.trim();
    if (configured) return configured;
    const archive = [join(process.cwd(), 'dist/proof-processor/ffmpeg.gz'), join(process.cwd(), 'apps/web/dist/proof-processor/ffmpeg.gz')]
        .find(path => existsSync(path));
    if (!archive) return;
    // Concurrent conversions share one unpacked binary and a failed unpack can be retried.
    packagedExecutable ??= unpackFfmpeg(archive).catch(error => {
        packagedExecutable = undefined;
        throw error;
    });
    return packagedExecutable;
}

async function ffmpegRun(binary: string, args: string[], signal: AbortSignal, cwd: string, seconds: number) {
    try {
        await ffmpeg(binary, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
            '-filter_threads', '1', '-max_alloc', '134217728', ...args], {
            signal, cwd, timeout: seconds * 1000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024,
            env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV }
        });
    } catch (error) {
        if (signal.aborted) throw error;
        if (error && typeof error === 'object' && 'code' in error && ['ENOENT', 'EACCES'].includes(String(error.code)))
            throw apiErrors.unavailable('Video conversion is unavailable because the configured processor could not start.');
        throw new ProofSourceError('The video could not be converted within the supported limits.');
    }
}

async function makeVideoFiles(source: Buffer, contentType: string, transcode: boolean, signal: AbortSignal) {
    const binary = await ffmpegCommand();
    if (!binary) {
        if (transcode) throw apiErrors.unavailable('This video requires a configured conversion processor.');
        return { playable: source };
    }
    const root = await mkdtemp(join(tmpdir(), 'uier-proof-video-'));
    try {
        await writeFile(join(root, 'source'), source, { signal });
        const input = ['-threads', '1', '-f', contentType === 'video/webm' ? 'matroska' : 'mov', '-i', 'source'];
        if (transcode) await ffmpegRun(binary, [...input, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1',
            '-vf', 'scale=w=min(1920\\,iw):h=min(1080\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '25', '-threads', '2', '-fpsmax', '60',
            '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-fs', String(MAX_PROOF_UPLOAD_BYTES), 'preview.mp4'], signal, root, 55);
        const playable = transcode ? await readBounded(join(root, 'preview.mp4'), MAX_PROOF_UPLOAD_BYTES, signal) : source;
        let poster: Buffer | undefined;
        try {
            await ffmpegRun(binary, [...transcode ? ['-threads', '1', '-i', 'preview.mp4'] : input,
                '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=w=min(768\\,iw):h=-2', '-c:v', 'mjpeg',
                '-threads', '1', '-f', 'image2', 'poster.jpg'], signal, root, 10);
            poster = await readBounded(join(root, 'poster.jpg'), 512 * 1024, signal);
        } catch (error) {
            if (signal.aborted || !(error instanceof ProofSourceError)) throw error;
        }
        return { playable, poster };
    } finally { await rm(root, { recursive: true, force: true }); }
}

async function readBounded(path: string, max: number, signal: AbortSignal) {
    const { size } = await stat(path).catch(() => { throw new ProofSourceError('The video processor did not return a derivative.'); });
    if (size < 1 || size >= max) throw new ProofSourceError('The video derivative exceeds the supported size.');
    return readFile(path, { signal });
}

export const videoAdapter: ProofSourceAdapter = {
    format: 'video', contentTypes: proofUploadTypes.video, async ingest({ bytes, contentType, signal }) {
        const input = new Input({ source: new BufferSource(bytes), formats: [MP4, QTFF, WEBM] });
        const abort = () => input.dispose();
        signal.addEventListener('abort', abort, { once: true });
        try {
            signal.throwIfAborted();
            const format = await input.getFormat();
            if (format !== formats[contentType as keyof typeof formats] && !(contentType === 'video/quicktime' && format === MP4))
                throw new ProofSourceError('The video container does not match the selected file format.');
            const video = await input.getPrimaryVideoTrack();
            if (!video) throw new ProofSourceError('The file does not contain a video track.');
            const audio = await input.getPrimaryAudioTrack();
            const [width, height, codec, audioCodec, duration, stats, rotation] = await Promise.all([
                video.getDisplayWidth(), video.getDisplayHeight(), video.getCodec(), audio?.getCodec(), input.computeDuration(), video.computePacketStats(120), video.getRotation()
            ]);
            if (!stats.packetCount || !Number.isFinite(duration) || duration <= 0 || duration > maxDuration || width * height > dimensionsLimit
                || width <= 0 || height <= 0 || width > 4096 || height > 4096
                || (Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > maxInputFrameRate))
                throw new ProofSourceError('Videos must be up to 15 minutes, 4K and 120 frames per second.');
            const webm = format === WEBM;
            const portable = webm ? (codec === 'vp8' || codec === 'vp9') && (!audio || audioCodec === 'opus' || audioCodec === 'vorbis')
                : codec === 'avc' && (!audio || audioCodec === 'aac');
            let transcode = !portable || rotation !== 0;
            let candidate = bytes;
            if (!transcode) {
                const target = new BufferTarget();
                const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
                const conversion = await Conversion.init({ input, output, tracks: 'primary', tags: {} });
                if (conversion.isValid && conversion.utilizedTracks.includes(video) && (!audio || conversion.utilizedTracks.includes(audio))) {
                    await conversion.execute();
                    if (!target.buffer || target.buffer.byteLength > MAX_PROOF_UPLOAD_BYTES)
                        throw new ProofSourceError('The video preview exceeds the supported size.');
                    candidate = Buffer.from(target.buffer);
                } else { transcode = true; }
            }
            if (transcode && duration > maxTranscode) throw new ProofSourceError('Videos requiring conversion must be up to 2 minutes.');
            const playbackType = !transcode && webm ? 'video/webm' : 'video/mp4';
            const { playable, poster } = await makeVideoFiles(candidate, transcode ? contentType : playbackType, transcode, signal);
            const played = new Input({ source: new BufferSource(playable), formats: [MP4, WEBM] });
            try {
                const outputTrack = await played.getPrimaryVideoTrack();
                if (!outputTrack) throw new ProofSourceError('The generated video cannot be played.');
                const length = await played.computeDuration();
                if (Math.abs(length - duration) > Math.max(0.5, 2 / (stats.averagePacketRate || 1)))
                    throw new ProofSourceError('The video conversion reached the output limit before completion.');
                const frameRate = (await outputTrack.computePacketStats(120)).averagePacketRate;
                const posterArtifactId = poster ? 'poster' : undefined;
                return {
                    manifest: { format: 'video', durationMs: Math.round(length * 1000),
                        surfaces: [{ id: 'video', artifactId: 'video', width: await outputTrack.getDisplayWidth(), height: await outputTrack.getDisplayHeight() }],
                        video: { artifactId: 'video', posterArtifactId, ...(Number.isFinite(frameRate) && frameRate > 0 ? { frameRate } : {}) } },
                    artifacts: [{ id: 'video', contentType: playbackType, bytes: playable },
                        ...(poster ? [{ id: 'poster', contentType: 'image/jpeg', bytes: poster }] : [])]
                };
            } finally { played.dispose(); }
        } catch (error) {
            if (signal.aborted || error instanceof ProofSourceError || (error && typeof error === 'object' && 'status' in error)) throw error;
            throw new ProofSourceError('The video file could not be read or converted.');
        } finally {
            signal.removeEventListener('abort', abort);
            input.dispose();
        }
    }
};
