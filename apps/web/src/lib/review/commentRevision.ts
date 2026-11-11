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
 * does not, nor do the bounded history, transient agent presence, query indexes and generated title (`aiTitle`).
 */
export function commentRevision(comment: DbComment) {
    const content = Object.fromEntries(Object.entries(comment).filter(([key]) => !key.startsWith('_')
        && !key.startsWith('sync') && !key.startsWith('notification') && key !== 'aiTitle' && key !== 'history' && key !== 'queryMetadata'));
    if (comment.assigneeAgent) {
        const { workingUntil: _, ...agent } = comment.assigneeAgent;
        content.assigneeAgent = agent;
    }
    if (comment.assigneeAgents) content.assigneeAgents = comment.assigneeAgents.map(({ workingUntil: _, ...agent }) => agent);
    return createHash('sha256').update(stable(content)).digest('hex');
}
