import { z } from 'zod';
import type { ProofPrototypeAnchor } from './threadModel';

export const prototypeNodeLimit = 24;
export const prototypeLabelLimit = 120;
export const prototypePathLimit = 20;
export const prototypeScanLimit = 1200;
const normalized = z.number().min(0).max(1);
const node = z.object({ path: z.array(z.int().min(0).max(4095)).min(1).max(prototypePathLimit),
    tag: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)
        .refine(tag => !['script', 'style', 'template', 'input', 'textarea', 'select'].includes(tag)) }).strict();
const box = z.object({ x: normalized, y: normalized, width: normalized.gt(0), height: normalized.gt(0) }).strict();

// The bridge is in the uploaded document's trust domain. Treat its output as
// reviewer input and allow only inert text, numeric paths and viewport geometry.
export const prototypeAnchorSchema = z.object({
    kind: z.literal('prototype'),
    surfaceId: z.string().min(1).max(256).regex(/^[^\p{Cc}]+$/u),
    target: node,
    selection: z.object({ quote: z.string().trim().min(1).max(500), offset: z.int().min(0).max(4095), endOffset: z.int().min(0).max(4095), start: z.int().min(0).max(4095), end: z.int().min(0).max(4096) }).strict(),
    capture: z.object({
        nodes: z.array(z.object({ node, box, label: z.string().min(1).max(prototypeLabelLimit).regex(/^[^\p{Cc}]+$/u).optional(),
            state: z.string().regex(/^[01-]{5}$/).optional() }).strict())
            .min(1).max(prototypeNodeLimit),
        native: z.array(z.object({ node, control: z.enum(['details', 'popover']) }).strict()).max(8)
    }).strict()
}).strict().partial({ selection: true }) satisfies z.ZodType<ProofPrototypeAnchor>;

export function samePrototypeNode(a: ProofPrototypeAnchor['target'], b: ProofPrototypeAnchor['target']) {
    return a.tag === b.tag && a.path.length === b.path.length && a.path.every((part, index) => part === b.path[index]);
}
