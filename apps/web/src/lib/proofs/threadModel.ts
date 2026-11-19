import type { VerificationDetails, VerificationPermissions } from '@uier/toolbar/verification';
import type { WorkflowStatus } from '../app/statusWorkflow';
import type { ReviewCommentDto } from '../review/dto';
import { proofViewerPath } from './model';

export type ProofPoint = { x: number; y: number };
export type ProofVideoTime = { startMs: number; endMs?: number };
export type ProofVideoGeometry = ProofPoint & { width?: number; height?: number };
export type ProofPrototypeNode = { path: number[]; tag: string };
export type ProofPrototypeCapture = {
    nodes: { node: ProofPrototypeNode; box: ProofPoint & { width: number; height: number }; label?: string; state?: string }[];
    native: { node: ProofPrototypeNode; control: 'details' | 'popover' }[];
};
export type ProofPrototypeAnchor = {
    kind: 'prototype'; surfaceId: string; target: ProofPrototypeNode;
    selection?: { quote: string; offset: number; endOffset: number; start: number; end: number };
    capture: ProofPrototypeCapture;
};
export type ProofTextAnchor = {
    kind: 'text'; surfaceId: string; quote: string;
    occurrence?: number;
    field?: 'subject' | 'preheader' | 'sender' | 'body' | 'cta';
};
export type ProofAnchor =
    | { kind: 'general' }
    | ({ kind: 'point'; surfaceId: string } & ProofPoint)
    | ({ kind: 'region'; surfaceId: string; width: number; height: number } & ProofPoint)
    | { kind: 'drawing'; surfaceId: string; strokes: ProofPoint[][] }
    | ProofTextAnchor
    | ({ kind: 'time'; surfaceId?: string; geometry?: ProofVideoGeometry } & ProofVideoTime)
    | ProofPrototypeAnchor;

export type ProofThreadLocation = { versionId: string; anchor: ProofAnchor };
export type ProofVerificationEvidence = { assetId: string; before: ProofThreadLocation; after: ProofThreadLocation };
export type ProofThreadTarget = { assetId: string; source: ProofThreadLocation; relocations?: ProofThreadLocation[]; suggestion?: { replacement: string } };
export type ProofThread = Pick<ReviewCommentDto, 'id' | 'number' | 'thread' | 'resolved' | 'inProgress' | 'archivedAt' | 'private' | 'assignees' | 'activity'> & {
    target: ProofThreadTarget;
    location: ProofThreadLocation;
    href: string;
    revision: string;
    statusId: string;
    currentVersionId: string | null;
    permissions: ReviewCommentDto['permissions'] & { makePrivate: boolean };
    verification?: VerificationDetails & { evidence?: ProofVerificationEvidence };
    evidenceLinks?: Record<'before' | 'after', { href: string; previewUrl?: string; number: number | null }>;
    participants?: { id: string; name: string }[];
    verificationEnabled: boolean;
    verificationPermissions: VerificationPermissions;
};

export type ProofThreadPage = {
    threads: ProofThread[];
    next: string | null;
    canComment: boolean;
    canMakePrivate: boolean;
    guest: boolean;
    statuses: WorkflowStatus[];
};

export type ProofPendingPage = { threads: ProofThread[]; next: string | null; count: number };

export function proofThreadPath(projectId: string, assetId: string, versionId: string, threadId: string) {
    return `${proofViewerPath(projectId, assetId, versionId)}&thread=${encodeURIComponent(threadId)}`;
}

export function proofThreadLocation(target: ProofThreadTarget, evidence?: ProofVerificationEvidence, versionId?: string): ProofThreadLocation {
    if (!versionId || target.source.versionId === versionId) return target.source;
    if (evidence?.after.versionId === versionId) return evidence.after;
    return target.relocations?.find(location => location.versionId === versionId) ?? target.source;
}
