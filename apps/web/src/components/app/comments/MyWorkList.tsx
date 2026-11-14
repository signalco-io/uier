'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useRef, useState, type ReactNode } from 'react';
import { AtSignIcon, MailIcon, UserIcon } from 'lucide-react';
import { rovingIndex } from '@uier/toolbar/keyboard';
import { KnownPageLinks } from '../../../knownPages';
import type { MyWorkItem } from '../../../lib/app/myWork';
import type { BoardSort } from '../../../lib/app/boardSort';
import { useKeyShortcuts } from '../keyboard/keys';
import { CommentRow } from './CommentRow';
import { BoardSortMenu } from './BoardSortMenu';
import { sortBoardColumn } from './commentOrder';
import { myWorkSortColumn, type MyWorkGroup, type MyWorkSorts } from './myWorkSorts';

/** Each of My work's lists: its heading, what it holds (when the heading does not already say it) and its icon */
const groupLabels: Record<MyWorkGroup, { title: string; description?: string; icon: ReactNode }> = {
    assigned: { title: 'Assigned to you', icon: <UserIcon /> },
    mentions: { title: 'Mentions you', description: 'Open threads whose messages mention you', icon: <AtSignIcon /> },
    unread: { title: 'Unread', description: 'Other threads with activity you have not read', icon: <MailIcon /> }
};

/** The items in a sort (`sortBoardColumn`): ties keep the order they came in */
function sortItems(items: readonly MyWorkItem[], sort: BoardSort) {
    const byId = new Map(items.map(item => [item.comment.id, item]));
    return sortBoardColumn(items.map(item => item.comment), sort).map(comment => byId.get(comment.id)!);
}

/**
 * My work's lists (assigned to you, mentioning you, unread), each with its count and, at the right end of its heading,
 * its sort (`BoardSortMenu`, a board column's choices: priority by default, newest, oldest, recently updated). A list
 * with nothing in it (or nothing matching the filters) is left out. J and K go to the next and the previous row across them.
 */
export function MyWorkGroups({ groups, sorts, onSort }: {
    groups: Record<MyWorkGroup, MyWorkItem[]>;
    sorts: MyWorkSorts;
    onSort: (group: MyWorkGroup, sort: BoardSort) => void;
}) {
    const { t } = useAppI18n();
    return (
        <MyWorkKeys>
            {(Object.keys(groupLabels) as MyWorkGroup[]).map(group => {
                const items = groups[group];
                if (!items.length) return null;
                const { title, description, icon } = groupLabels[group];
                const id = `my-work-${group}`;
                return (
                    <section key={group} aria-labelledby={id} className="flex flex-col gap-2">
                        <div className="flex items-baseline gap-2 px-1">
                            <span aria-hidden="true" className="self-center text-muted-foreground [&_svg]:size-4">{icon}</span>
                            <h2 id={id} className="m-0 text-base font-semibold">{t(title)}</h2>
                            <span className="text-sm text-muted-foreground tabular-nums">{items.length}</span>
                            {description && <p className="m-0 ml-auto hidden text-sm text-muted-foreground sm:block">{t(description)}</p>}
                            <BoardSortMenu status={myWorkSortColumn(group)} label={t(title)} group sort={sorts[group]} onChange={sort => onSort(group, sort)}
                                className={description ? 'mr-0 self-center sm:ml-0' : 'mr-0 self-center'} />
                        </div>
                        <MyWorkList label={t(title)} items={sortItems(items, sorts[group])} />
                    </section>
                );
            })}
        </MyWorkKeys>
    );
}

/** The rows' links in a list or on the page, in order */
const rowLinks = (container: Element) => [...container.querySelectorAll<HTMLElement>('[data-comment-row] a[href]')];

/**
 * Rows of several projects; each opens its thread on its project's comments page. Like the comments list, one
 * row is in the Tab order (the one last focused): ↓ and ↑ move to the next and the previous row and stop at the
 * ends, Home and End to the first and the last, Enter opens it.
 */
export function MyWorkList({ label, items }: { label: string; items: MyWorkItem[] }) {
    const [focusId, setFocusId] = useState<string>();
    const tabStop = items.some(item => item.comment.id === focusId) ? focusId : items[0]?.comment.id;
    return (
        <ul aria-label={label} className="m-0 flex min-w-0 list-none flex-col gap-0.5 rounded-xl border bg-card p-1"
            onFocus={event => {
                const id = event.target.closest<HTMLElement>('[data-my-work-row]')?.dataset.myWorkRow;
                if (id && id !== focusId) setFocusId(id);
            }}
            onKeyDown={event => {
                if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                const row = (event.target as Element).closest('[data-my-work-row]');
                if (!row) return;
                const links = rowLinks(event.currentTarget);
                const next = rovingIndex(event.key, links.findIndex(link => row.contains(link)), links.length, { orientation: 'vertical' });
                if (next === undefined) return;
                event.preventDefault();
                links[next]!.focus({ preventScroll: true });
                links[next]!.closest('li')?.scrollIntoView({ block: 'nearest' });
            }}>
            {items.map(({ projectId, projectName, projectUrl, comment }) => (
                <li key={comment.id} className="min-w-0" data-my-work-row={comment.id}>
                    <CommentRow comment={comment} project={projectName} projectId={projectId} projectUrl={projectUrl} tabbable={comment.id === tabStop}
                        href={`${KnownPageLinks.project(projectId)}?comment=${encodeURIComponent(comment.id)}#comments`} />
                </li>
            ))}
        </ul>
    );
}

/** J and K on My work: the next and the previous row, across its lists */
export function MyWorkKeys({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const move = (step: number) => {
        const links = ref.current ? rowLinks(ref.current) : [];
        if (!links.length) return false;
        const from = links.findIndex(link => link.closest('li')?.contains(document.activeElement));
        const next = from < 0 ? links.at(step > 0 ? 0 : -1) : links[from + step];
        next?.focus({ preventScroll: true });
        next?.closest('li')?.scrollIntoView({ block: 'nearest' });
    };
    useKeyShortcuts({ j: () => move(1), k: () => move(-1) });
    return <div ref={ref} className="flex flex-col gap-6">{children}</div>;
}
