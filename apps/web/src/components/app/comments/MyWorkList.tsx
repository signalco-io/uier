'use client';

import { KnownPageLinks } from '../../../knownPages';
import type { MyWorkItem } from '../../../lib/app/myWork';
import { CommentRow } from './CommentRow';

/** Rows of several projects; each opens its thread on its project's comments page */
export function MyWorkList({ label, items }: { label: string; items: MyWorkItem[] }) {
    return (
        <ul aria-label={label} className="m-0 flex min-w-0 list-none flex-col gap-0.5 rounded-xl border bg-card p-1">
            {items.map(({ projectId, projectName, comment }) => (
                <li key={comment.id} className="min-w-0">
                    <CommentRow comment={comment} project={projectName}
                        href={`${KnownPageLinks.project(projectId)}?comment=${encodeURIComponent(comment.id)}#comments`} />
                </li>
            ))}
        </ul>
    );
}
