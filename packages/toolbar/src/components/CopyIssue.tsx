import { useContext, useEffect, useRef, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Stack } from '@signalco/ui-primitives/Stack';
import { cx } from '@signalco/ui-primitives/cx';
import { Copy, FileText, Link } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { floatingShadowClassName } from './@types/Comments';
import { useIconTooltip } from './IconTooltip';
import type { FeedbackExport } from '../feedbackContext';
import { apiRequest, required, currentReviewerRevision } from '../hooks/api';
import { commentUrl } from '../hooks/useComments';
import { useAnnounce } from './Announcer';
import { useMessages } from '../i18n';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { toolbarSurface } from '../toolbarReview';
import { moveFocusInMenu } from '../focusKeys';

/** Fetch on every explicit copy, so removed/private items cannot be exported from a stale cache. */
export function useCopyIssue(commentId: string) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<unknown>();
    const [manual, setManual] = useState<string>();
    const [copied, setCopied] = useState(false);
    const announce = useAnnounce();
    const t = useMessages();
    useEffect(() => {
        if (!copied) return;
        const timeout = window.setTimeout(() => setCopied(false), 2000);
        return () => window.clearTimeout(timeout);
    }, [copied]);
    const copy = async () => {
        setPending(true); setError(undefined); setManual(undefined); setCopied(false);
        const revision = currentReviewerRevision();
        try {
            const packet = required(await apiRequest<FeedbackExport>(`${commentUrl(commentId)}/context`));
            if (revision !== currentReviewerRevision()) return;
            try {
                await navigator.clipboard.writeText(packet.markdown);
                setCopied(true); announce(t.copy.issueCopied);
            } catch {
                setManual(packet.markdown);
            }
        } catch (error) { setError(error); }
        finally { setPending(false); }
    };
    return { pending, error, manual, copied, copy, close: () => setManual(undefined) };
}

/**
 * One Copy menu for the two things people copy, each saying what it is: the issue (Markdown for an
 * issue tracker or a coding tool) and the link (opens this page at the thread). "Issue copied." shows
 * under the button for two seconds; the shared announcer reports it to screen readers once.
 */
export function CopyMenu({ state, className, linkAvailable, onCopyLink }: {
    state: ReturnType<typeof useCopyIssue>;
    className?: string;
    linkAvailable: boolean;
    onCopyLink: () => void;
}) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const t = useMessages();
    const [open, setOpen] = useState(false);
    const issueRef = useRef<HTMLButtonElement>(null);
    const { triggerProps, tooltip } = useIconTooltip(t.copy.tooltip);
    const contentProps = { onOpenAutoFocus: (event: Event) => { event.preventDefault(); issueRef.current?.focus(); } };
    return <span className="relative inline-flex shrink-0">
        <Popper
            container={rootElement}
            open={open}
            onOpenChange={setOpen}
            align="end"
            aria-label={t.copy.label}
            // Like a menu: ↑ and ↓ move between its buttons
            onKeyDown={moveFocusInMenu}
            {...toolbarSurface('uier-copy-menu', cx('z-[70] w-64 max-w-[calc(100vw-1rem)] rounded-xl p-1', floatingShadowClassName))}
            trigger={(
                <IconButton size="xs" variant="plain" className={className} aria-label={t.copy.label} aria-busy={state.pending}
                    disabled={state.pending} {...triggerProps}>
                    <Copy size={16} />
                </IconButton>
            )}
            {...contentProps}>
            <Stack>
                <Button ref={issueRef} variant="plain" size="sm" fullWidth className="h-auto items-start justify-start py-1.5 text-left"
                    startDecorator={<FileText size={16} className="mt-0.5" />}
                    onClick={() => { setOpen(false); void state.copy(); }}>
                    <span className="flex flex-col whitespace-normal">
                        {t.copy.issue}
                        <span className="text-xs font-normal text-muted-foreground">{t.copy.issueDescription}</span>
                    </span>
                </Button>
                <Button variant="plain" size="sm" fullWidth className="h-auto items-start justify-start py-1.5 text-left" disabled={!linkAvailable}
                    startDecorator={<Link size={16} className="mt-0.5" />}
                    onClick={() => { setOpen(false); onCopyLink(); }}>
                    <span className="flex flex-col whitespace-normal">
                        {t.copy.link}
                        <span className="text-xs font-normal text-muted-foreground">{linkAvailable ? t.copy.linkDescription : t.copy.linkUnavailable}</span>
                    </span>
                </Button>
            </Stack>
        </Popper>
        {tooltip}
        {state.copied && <span aria-hidden="true"
            className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm animate-in fade-in-0 slide-in-from-top-2 duration-150 ease-out">
            {t.copy.issueCopiedVisible}
        </span>}
    </span>;
}

export function CopyIssueResult({ state }: { state: ReturnType<typeof useCopyIssue> }) {
    const { error, manual } = state;
    const t = useMessages();
    if (!error && manual === undefined) return null;
    return <div className="flex min-w-0 flex-col gap-2">
        <CommentsErrorMessage error={error} />
        {manual !== undefined && <>
            <p role="alert" className="m-0 text-xs text-muted-foreground">{t.copy.notCopied}</p>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">{t.copy.markdown}
                <textarea readOnly value={manual} onFocus={event => event.currentTarget.select()}
                    className="max-h-64 min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <Button variant="plain" size="xs" className="self-start" onClick={state.close}>{t.copy.closeText}</Button>
        </>}
    </div>;
}
