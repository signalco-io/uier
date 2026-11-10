import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { LoaderSpinner } from '@signalco/ui-icons';
import { canRecheck, recheck, type Recheck } from '../../checks/recheck';
import { useWebVitals, type WebVitals } from '../../checks/webVitals';
import { commentCheckLabels } from '../../feedbackTypes';
import { getDomVersion } from '../../hooks/useLayoutVersion';
import { useProjectViewer } from '../../project/ProjectGate';
import { readyForReview } from '../../verification';
import type { CommentItem } from '../@types/Comments';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { checkStates } from './ChecksParts';

type LineProps = { comment: CommentItem; path: string; vitals?: WebVitals };

/**
 * The thread of a comment posted from a page check, open on the page it was posted on (a pin's
 * popover, an inbox card): that check run again here, on the comment's element, with **Check
 * again** (packages/toolbar/docs/page-checks-verify.md). Ready to verify, it runs once on its own
 * when the thread opens. Evidence only: the status stays the reviewer's to change.
 */
export function CheckRecheck({ comment }: { comment: CommentItem }) {
    const { path } = useContext(CommentsBootstrapperContext);
    const { currentEnvironment } = useProjectViewer();
    if (!comment.check || comment.pending || comment.thread.items[0]?.deleted
        || comment.path !== path || (comment.source && comment.source.environment !== currentEnvironment)) return null;
    // Another page (a client-side navigation) starts over
    return comment.check.type === 'web-vitals' ? <VitalRecheck key={path} comment={comment} path={path} /> : <RecheckLine key={path} comment={comment} path={path} />;
}

/** Core Web Vitals: this visit's measurement, so only these threads follow its updates */
function VitalRecheck(props: LineProps) {
    return <RecheckLine {...props} vitals={useWebVitals()} />;
}

function RecheckLine({ comment, path, vitals }: LineProps) {
    const check = comment.check!;
    const [state, setState] = useState<{ status: 'idle' | 'checking' | 'done' | 'failed' | 'unavailable'; result?: Recheck }>({ status: 'idle' });
    // One re-check at a time (of the thread as rendered then); closing the thread cancels it
    const running = useRef<AbortController>(undefined);
    const autoRan = useRef(false);
    const domVersion = getDomVersion();
    const available = useMemo(() => canRecheck(comment, vitals), [check.type, check.id, comment.position, vitals, domVersion]);
    const ready = readyForReview(comment);
    const statusId = useId();

    const start = () => {
        if (running.current) return;
        const controller = new AbortController();
        running.current = controller;
        setState(current => ({ ...current, status: 'checking' }));
        recheck(comment, path, controller.signal, vitals).then(result => {
            if (!controller.signal.aborted) setState(result ? { status: 'done', result } : { status: 'unavailable' });
        }, error => {
            if (controller.signal.aborted) return;
            console.warn('uier-toolbar: The check could not run again', error);
            setState(current => ({ ...current, status: 'failed' }));
        }).finally(() => {
            if (running.current === controller) running.current = undefined;
        });
    };
    useEffect(() => () => {
        running.current?.abort();
        running.current = undefined;
        autoRan.current = false;
    }, []);
    // Ready to verify: once, when the thread opens (not on every render or refetch)
    useEffect(() => {
        if (!ready || !available || autoRan.current) return;
        autoRan.current = true;
        start();
    }, [ready, available]);

    const { status, result } = state;
    if (status === 'unavailable' || (!available && status !== 'checking')) return null;
    const shown = status === 'done' ? result : undefined;
    const { icon: Icon, tone } = checkStates[shown?.state ?? 'none'];
    return (
        <div data-uier-recheck={shown?.state ?? status} className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
            <p id={statusId} role="status" className="m-0 flex min-w-0 flex-1 items-start gap-1.5 py-1">
                {status === 'checking' ? <>
                    <LoaderSpinner size={14} aria-hidden="true" className="mt-px shrink-0 motion-safe:animate-spin" />
                    Checking...
                </> : status === 'failed' ? 'This could not be checked. Check again to retry.'
                    : shown ? <>
                        <Icon size={14} aria-hidden="true" className={cx('mt-px shrink-0', tone)} />
                        <span className="min-w-0 break-words"><span className="text-foreground">{shown.text}</span>{shown.reason && ` ${shown.reason}`}</span>
                    </> : <span className="min-w-0 break-words">{commentCheckLabels[check.type]} check: {check.id}</span>}
            </p>
            <Button size="xs" variant="plain" className="shrink-0" aria-busy={status === 'checking' || undefined}
                aria-describedby={statusId} onClick={start}>
                Check again
            </Button>
        </div>
    );
}
