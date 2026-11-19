import type { ProofAnchor, ProofPoint } from '@/src/lib/proofs/threadModel';

export type SpatialTool = 'point' | 'region' | 'drawing';
export type ReviewTool = 'browse' | 'pan' | SpatialTool | 'text';

export const clamp = (value: number, lower = 0, upper = 1) => Math.min(upper, Math.max(lower, value));

export function normalizedPoint(bounds: DOMRect, x: number, y: number): ProofPoint {
    return { x: clamp((x - bounds.left) / bounds.width), y: clamp((y - bounds.top) / bounds.height) };
}

export function anchorForGesture(tool: SpatialTool, surfaceId: string, points: ProofPoint[]): ProofAnchor {
    const start = points[0]!;
    const end = points.at(-1)!;
    const width = Math.abs(start.x - end.x);
    const height = Math.abs(start.y - end.y);
    if (tool === 'region' && width > 0.005 && height > 0.005) {
        return { kind: 'region', surfaceId, x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height };
    }
    if (tool === 'drawing' && points.length > 1) {
        const samples = Math.min(100, points.length);
        const stroke = Array.from({ length: samples }, (_, index) => points[Math.round(index * (points.length - 1) / (samples - 1))]!);
        return { kind: 'drawing', surfaceId, strokes: [stroke] };
    }
    return { kind: 'point', surfaceId, ...end };
}

export function anchorPoint(anchor: ProofAnchor): ProofPoint | undefined {
    if (anchor.kind === 'point' || anchor.kind === 'region') return anchor;
    if (anchor.kind === 'drawing') return anchor.strokes[0]?.[0];
    return undefined;
}
