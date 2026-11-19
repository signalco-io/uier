import { z } from 'zod';
import { idempotencyKeySchema, textSchema } from '../comments/validation';
import { guestNameSchema } from '../review/actor';
import { apiErrors } from '../comments/http';
import type { ProofAnchor } from './threadModel';
import type { ProofManifest } from './model';
import { prototypeAnchorSchema, samePrototypeNode } from './prototypeEvidence';

export const proofReferenceId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/);
const normalized = z.number().min(0).max(1);
const point = z.object({ x: normalized, y: normalized }).strict();
const surfaceId = z.string().min(1).max(256).regex(/^[^\p{Cc}]+$/u);
const surface = { surfaceId };
export const proofAnchorSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('general') }).strict(),
    z.object({ kind: z.literal('point'), ...surface, ...point.shape }).strict(),
    z.object({ kind: z.literal('region'), ...surface, ...point.shape, width: normalized.gt(0), height: normalized.gt(0) }).strict(),
    z.object({ kind: z.literal('drawing'), ...surface, strokes: z.array(z.array(point).min(2).max(100)).min(1).max(10) }).strict(),
    z.object({ kind: z.literal('text'), ...surface, quote: z.string().trim().min(1).max(500),
        occurrence: z.int().min(0).max(100_000).optional(), field: z.enum(['subject', 'preheader', 'sender', 'body', 'cta']).optional() }).strict(),
    z.object({ kind: z.literal('time'), startMs: z.int().nonnegative(), endMs: z.int().nonnegative().optional(),
        surfaceId: surfaceId.optional(), geometry: point.extend({ width: normalized.gt(0).optional(), height: normalized.gt(0).optional() }).optional() }).strict(),
    prototypeAnchorSchema
]) satisfies z.ZodType<ProofAnchor>;

export const proofLocationSchema = z.object({ versionId: proofReferenceId, anchor: proofAnchorSchema }).strict();
export const proofEvidenceSchema = z.object({ assetId: proofReferenceId, before: proofLocationSchema, after: proofLocationSchema }).strict();
export const proofMessageSchema = z.object({ text: textSchema, authorName: guestNameSchema.optional(), idempotencyKey: idempotencyKeySchema }).strict();
export const proofCreateThreadSchema = proofMessageSchema.extend({ location: proofLocationSchema, private: z.boolean().optional(),
    suggestion: z.object({ replacement: z.string().trim().min(1).max(1000) }).strict().optional() });

export function assertProofAnchor(anchor: ProofAnchor, manifest?: ProofManifest) {
    if (anchor.kind === 'general') return;
    if (anchor.surfaceId && !manifest?.surfaces.some(surface => surface.id === anchor.surfaceId))
        throw apiErrors.invalidRequest('Choose a location on this version.');
    if (anchor.kind === 'region' && (anchor.x + anchor.width > 1.000001 || anchor.y + anchor.height > 1.000001))
        throw apiErrors.invalidRequest('Keep the selected region inside the page.');
    if (anchor.kind === 'time' && (manifest?.format !== 'video' || manifest.durationMs === undefined
        || (anchor.endMs ?? anchor.startMs) > manifest.durationMs || (anchor.endMs !== undefined && anchor.endMs < anchor.startMs)))
        throw apiErrors.invalidRequest('Choose a time within this version.');
    if (anchor.kind === 'time' && anchor.geometry) {
        const { x, y, width, height } = anchor.geometry;
        if (!anchor.surfaceId || (width === undefined) !== (height === undefined) || x + (width ?? 0) > 1.000001 || y + (height ?? 0) > 1.000001)
            throw apiErrors.invalidRequest('Keep the selected region inside the page.');
    }
    if (anchor.kind === 'prototype' && (manifest?.format !== 'html'
        || !anchor.capture.nodes.some(({ node }) => samePrototypeNode(node, anchor.target))
        || (anchor.selection && (anchor.selection.offset > anchor.selection.endOffset
            || (anchor.selection.offset === anchor.selection.endOffset && anchor.selection.start >= anchor.selection.end)))
        || anchor.capture.nodes.some(({ box }) => box.x + box.width > 1.000001 || box.y + box.height > 1.000001)))
        throw apiErrors.invalidRequest('Choose a location on this version.');
    if (anchor.kind === 'text' && anchor.field && (manifest?.format !== 'email'
        || (anchor.field !== 'cta' && anchor.field !== 'body' && manifest.email?.[anchor.field] !== anchor.quote)))
        throw apiErrors.invalidRequest('Choose a location on this version.');
}
