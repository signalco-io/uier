import { createHash } from 'node:crypto';
import type { DbComment } from '../db/schema';

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
/**
 * Opaque content revision. Future workflow fields participate automatically; delivery bookkeeping
 * does not, nor do transient agent presence and the generated title (`aiTitle`), which follows the first message.
 */
export function commentRevision(comment: DbComment) {
    const content = Object.fromEntries(Object.entries(comment).filter(([key]) => !key.startsWith('_')
        && !key.startsWith('sync') && !key.startsWith('notification') && key !== 'aiTitle'));
    if (comment.assigneeAgent) {
        const { workingUntil: _, ...agent } = comment.assigneeAgent;
        content.assigneeAgent = agent;
    }
    return createHash('sha256').update(stable(content)).digest('hex');
}
