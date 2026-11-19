'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { proofApiPath, type ProofArtifact, type ProofVersion } from '@/src/lib/proofs/model';
import type { ProofAnchor } from '@/src/lib/proofs/threadModel';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { PdfDocument } from './PdfProof';

const Pdf = dynamic(() => import('./PdfProof').then(module => module.PdfProof), { ssr: false });
const AnimatedImage = dynamic(() => import('./AnimatedProofImage').then(module => module.AnimatedProofImage), { ssr: false });
const Video = dynamic(() => import('./VideoProof').then(module => module.VideoProof), { ssr: false });
const Email = dynamic(() => import('./DocumentProof').then(module => module.EmailProof), { ssr: false });
const Html = dynamic(() => import('./DocumentProof').then(module => module.HtmlProof), { ssr: false });

export type MediaSize = { width: number; height: number };
export type VideoPosition = { ms: number; nonce: number };
export type QuoteTarget = { x: number; y: number };

export const mediaSurface = (version: ProofVersion, index: number) => version.manifest?.surfaces[index];

export function proofSize(version: ProofVersion, index: number, emailWidth: number): MediaSize {
    const surface = mediaSurface(version, index);
    if (version.manifest?.format === 'email') return { width: emailWidth, height: Math.max(surface?.height ?? 630, 420) };
    if (surface?.width && surface.height) return { width: surface.width, height: surface.height };
    return version.manifest?.format === 'pdf' ? { width: 612, height: 792 } : { width: 1280, height: 800 };
}

export function proofArtifact(version: ProofVersion, index: number) {
    const surface = mediaSurface(version, index);
    return version.artifacts.find(item => item.id === surface?.artifactId);
}

function imageArtifact(artifact: ProofArtifact | undefined): artifact is ProofArtifact {
    return Boolean(artifact && ['image/png', 'image/webp', 'image/jpeg', 'image/gif'].includes(artifact.contentType));
}

export function ProofMedia({ projectId, version, index, label, width, emailWidth, onSize, onDocument, onText,
    onQuoteTarget, onAnchor, anchor, videoPosition, onTime, readonly = false, decorative = false }: {
    projectId: string; version: ProofVersion; index: number; label: string; width: number; emailWidth: number;
    onSize?: (size: MediaSize) => void; onDocument?: (document: PdfDocument) => void; onText?: (text: string) => void;
    onQuoteTarget?: (point: QuoteTarget) => void; onAnchor?: (anchor: ProofAnchor) => void;
    anchor?: ProofAnchor; videoPosition?: VideoPosition; onTime?: (ms: number) => void; readonly?: boolean; decorative?: boolean;
}) {
    const { t } = useAppI18n();
    const surface = mediaSurface(version, index);
    const manifest = version.manifest;
    const artifact = proofArtifact(version, index);
    if (manifest?.format === 'pdf') {
        const file = version.artifacts.find(item => item.id === manifest.pdf?.artifactId && item.contentType === 'application/pdf')
            ?? version.artifacts.find(item => item.contentType === 'application/pdf');
        if (file) return <Pdf key={file.url} url={file.url} pageNumber={index + 1} width={width} onSize={onSize} onDocument={onDocument} onText={onText}
            quote={anchor?.kind === 'text' ? anchor.quote : undefined} onQuoteTarget={onQuoteTarget} />;
    }
    if (manifest?.format === 'video' && surface) {
        const file = [artifact, ...version.artifacts].find(item => item && (item.contentType === 'video/mp4' || item.contentType === 'video/webm'));
        const poster = version.artifacts.find(item => item.id === manifest.video?.posterArtifactId && imageArtifact(item))?.url;
        if (file) return <Video key={file.url} url={file.url} label={label} surfaceId={surface.id} durationMs={manifest.durationMs} frameRate={manifest.video?.frameRate}
            poster={poster} position={videoPosition} range={anchor?.kind === 'time' ? anchor : undefined} onTime={onTime} onAnchor={readonly ? undefined : onAnchor} />;
    }
    if (manifest?.format === 'email' && surface) {
        const body = artifact?.contentType.startsWith('text/html') ? artifact : version.artifacts.find(item => item.contentType.startsWith('text/html'));
        const plain = version.artifacts.find(item => item.id === manifest.email?.plainTextArtifactId && item.contentType.startsWith('text/plain'))
            ?? version.artifacts.find(item => item.contentType.startsWith('text/plain'));
        if (body || plain) return <Email key={`${version.id}:${emailWidth}`} manifest={manifest} body={body} plain={plain} surfaceId={surface.id} logicalWidth={emailWidth} renderedWidth={width} onAnchor={readonly ? undefined : onAnchor} />;
    }
    if (manifest?.format === 'html' && surface)
        return <Html key={`${version.id}:${surface.id}`} accessUrl={manifest.html && `${proofApiPath(projectId)}/assets/${encodeURIComponent(version.assetId)}/versions/${encodeURIComponent(version.id)}/prototype?` +
                new URLSearchParams({ surface: surface.id })}
            pages={manifest.html?.pages} surface={surface} width={width} onAnchor={readonly ? undefined : onAnchor} snapshot={imageArtifact(artifact) ? <RasterImage artifact={artifact} label={label} onSize={onSize} /> : undefined} />;
    if (imageArtifact(artifact)) {
        if (manifest?.format === 'image' && manifest.durationMs && artifact.contentType === 'image/webp') {
            return <AnimatedImage key={artifact.url} url={artifact.url} label={label} controls={!decorative} />;
        }
        return <RasterImage key={artifact.url} artifact={artifact} label={label} onSize={onSize} />;
    }
    return <p role="alert" className="m-0 grid size-full place-items-center p-4 text-center text-destructive">{t('This preview is unavailable.')}</p>;
}

export function RasterImage({ artifact, label, onSize }: { artifact: ProofArtifact; label: string; onSize?: (size: MediaSize) => void }) {
    const [failed, setFailed] = useState(false);
    const { t } = useAppI18n();
    if (failed) return <p role="alert" className="m-0 grid size-full place-items-center p-4 text-center text-destructive">{t('This preview is unavailable.')}</p>;
    // An authenticated, immutable derivative remains on its original URL, bypassing the public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={artifact.url} alt={label} draggable={false} decoding="async" className="block size-full object-contain"
        onLoad={event => onSize?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => setFailed(true)} />;
}
