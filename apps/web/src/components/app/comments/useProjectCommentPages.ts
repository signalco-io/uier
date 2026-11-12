'use client';

import type { ProjectCommentView } from '@/src/lib/app/projectComments';
import { useEffect, useRef, useState } from 'react';
import type { loadAppCommentsSnapshot } from '@/src/lib/app/appCommentsSnapshot';
import { PROJECT_COMMENT_MAX_DEPTH, projectCommentPageKey, type CommentLane } from '@/src/lib/app/projectCommentPaging';
import type { CommentsQuery } from './commentsQuery';
import type { StatusWorkflow } from '@/src/lib/app/statusWorkflow';
import type { BoardColumn, BoardSort } from '@/src/lib/app/boardSort';

type Snapshot = Pick<NonNullable<Awaited<ReturnType<typeof loadAppCommentsSnapshot>>>, 'comments' | 'paging' | 'revision' | 'projectId' | 'userId'> & { openedComment?: ProjectCommentView };
export function mergePage(current: Snapshot, next: Snapshot, lane: CommentLane): Snapshot {
    const page = next.paging.lanes[lane];
    if (!page) return current;
    const rows = new Map(current.comments.map(comment => [comment.id, comment]));
    for (const comment of next.comments) rows.set(comment.id, comment);
    const lanes = { ...current.paging.lanes };
    for (const [id, metadata] of Object.entries(next.paging.lanes)) {
        if (!metadata) continue;
        lanes[id] = id === lane ? { ...metadata, ids: [...new Set([...(lanes[id]?.ids ?? []), ...metadata.ids])] }
            : lanes[id] ? { ...lanes[id]!, total: metadata.total } : metadata;
    }
    // A continuation refreshes one lane only; preserve the full-window refresh baseline.
    return { ...next, revision: current.revision, comments: [...rows.values()], openedComment: next.openedComment ?? current.openedComment,
        paging: { ...next.paging, lanes } };
}

/** Query changes cancel stale reads; refreshes rebuild the loaded windows and keep the composers mounted. */
export function useProjectCommentPages(initial: Snapshot, query: CommentsQuery, sorts: Record<BoardColumn, BoardSort>, archiveExpanded: boolean, workflow: StatusWorkflow, openId?: string) {
    const desiredKey = projectCommentPageKey(query, sorts, archiveExpanded, workflow, `${initial.projectId}:${initial.userId}`);
    const [data, setData] = useState(initial);
    const [loading, setLoading] = useState(false);
    const [loadingLanes, setLoadingLanes] = useState<Set<CommentLane>>(new Set());
    const [error, setError] = useState<'budget' | 'unavailable'>();
    const [failedLanes, setFailedLanes] = useState<Set<CommentLane>>(new Set());
    const [retry, setRetry] = useState(0);
    const state = useRef(data); state.current = data;
    const generation = useRef(0);
    const busyLanes = useRef(new Set<CommentLane>());
    const serverUsed = useRef(`${initial.paging.key}|${initial.revision}`);
    const controllers = useRef(new Set<AbortController>());
    const depths = useRef<Partial<Record<CommentLane, number>>>({});
    const latestOpen = useRef(openId); latestOpen.current = openId;
    const params = { ...query, view: query.view, status: query.status, people: query.people };
    const request = async (signal: AbortSignal, lane?: CommentLane, cursor?: string, depths?: Partial<Record<CommentLane, number>>): Promise<Snapshot> => {
        const response = await fetch(`/api/projects/${encodeURIComponent(initial.projectId)}/comments/pages`, {
            method: 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ params: Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])),
                archiveExpanded, openId: latestOpen.current, lane, cursor, depths })
        });
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<Snapshot>;
    };
    useEffect(() => {
        const version = ++generation.current;
        for (const controller of controllers.current) controller.abort();
        controllers.current.clear(); busyLanes.current.clear(); setLoadingLanes(new Set()); setFailedLanes(new Set());
        const controller = new AbortController(); controllers.current.add(controller);
        const sameScope = state.current.paging.key === desiredKey;
        const wanted = sameScope ? Object.fromEntries(Object.entries(depths.current).map(([lane, depth]) => [lane, Math.min(depth ?? 1, PROJECT_COMMENT_MAX_DEPTH)])) : {};
        if (!sameScope) depths.current = {};
        const serverMatches = initial.paging.key === desiredKey;
        const serverVersion = `${initial.paging.key}|${initial.revision}`;
        const useServer = serverMatches && serverUsed.current !== serverVersion && !retry;
        // The initial SSR window needs no duplicate HTTP request.
        if (serverMatches && initial.revision === state.current.revision && sameScope && !retry) {
            controllers.current.delete(controller); setLoading(false); setError(undefined); return;
        }
        setLoading(true); setError(undefined);
        void (async () => {
            try {
                // A fresh RSC first page suffices until a lane has more loaded. Restore all deeper
                // windows in one request/scan, rather than replaying every continuation serially.
                const needsDepths = Object.values(wanted).some(depth => depth > 1);
                const next = useServer && !needsDepths ? initial : await request(controller.signal, undefined, undefined, wanted);
                if (useServer) serverUsed.current = serverVersion;
                if (!controller.signal.aborted && version === generation.current) { depths.current = wanted; setData(next); }
            } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error && error.message === '422' ? 'budget' : 'unavailable'); }
            finally {
                controllers.current.delete(controller);
                if (!controller.signal.aborted && version === generation.current) setLoading(false);
            }
        })();
        return () => { controller.abort(); controllers.current.delete(controller); };
        // All request inputs are represented by the normalized key. The open thread does not restart a column.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [desiredKey, initial.revision, initial.paging.key, retry]);
    useEffect(() => () => { for (const controller of controllers.current) controller.abort(); }, []);
    const loadMore = async (lane: CommentLane) => {
        if (loading || busyLanes.current.has(lane) || data.paging.key !== desiredKey) return;
        const cursor = state.current.paging.lanes[lane]?.nextCursor;
        if (!cursor) return;
        const controller = new AbortController(), version = generation.current;
        controllers.current.add(controller); busyLanes.current.add(lane); setFailedLanes(current => new Set([...current].filter(value => value !== lane))); setLoadingLanes(current => new Set([...current, lane])); setError(undefined);
        try {
            const next = await request(controller.signal, lane, cursor);
            if (version !== generation.current || controller.signal.aborted) return;
            depths.current[lane] = (depths.current[lane] ?? 1) + 1;
            setData(current => mergePage(current, next, lane));
        } catch (error) {
            if (!controller.signal.aborted) {
                setFailedLanes(current => new Set([...current, lane]));
                // Expired/query-mismatched cursors restart this window; no permanently broken sentinel.
                if (error instanceof Error && error.message === '400') setRetry(current => current + 1);
            }
        } finally {
            controllers.current.delete(controller);
            if (version === generation.current) { busyLanes.current.delete(lane); setLoadingLanes(current => new Set([...current].filter(value => value !== lane))); }
        }
    };
    return { data: data.projectId === initial.projectId && data.userId === initial.userId ? data : initial, loading: loading || !error && data.paging.key !== desiredKey, error, loadMore, loadingLanes, failedLanes, retry: () => setRetry(current => current + 1) };
}
