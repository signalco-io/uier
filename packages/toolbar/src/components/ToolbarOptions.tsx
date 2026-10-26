'use client';

import { useContext, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { Close, ExternalLink, LogOut, MoreHorizontal } from '@signalco/ui-icons';
import { BRAND_URL, Mark } from '@uier/brand';
import { useDrafts } from '../hooks/useDrafts';
import { useVisitor } from '../hooks/useVisitor';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useInkContainer } from './InkScope';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { floatingShadowClassName } from './@types/Comments';

type ToolbarOptionsProps = {
    /** The reviewed project in the uier app (a review of a project's site, or a link with a project code) */
    projectUrl?: string;
    onResetPosition?: () => void;
    /** Ends the review (`review` mode) or closes the toolbar (`feedback` mode) */
    onExitReview?: () => void;
};

/**
 * The toolbar's options: view the project, exit the review, sign out (only the ones that apply),
 * and always a link to uier.io, since the toolbar shows on other people's sites.
 */
export function ToolbarOptions({ projectUrl, onExitReview, onResetPosition }: ToolbarOptionsProps) {
    const { rootElement, mode } = useContext(CommentsBootstrapperContext);
    // Dark like the pill it opens from
    const container = useInkContainer() ?? rootElement;
    const drafts = useDrafts();
    const { query: visitor, signOut } = useVisitor({ onSignedOut: () => drafts.clear() });
    const announce = useAnnounce();
    const [open, setOpen] = useState(false);
    const [confirmingSignOut, setConfirmingSignOut] = useState(false);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const name = visitor.data?.name;

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) {
            setConfirmingSignOut(false);
            signOut.reset();
        }
    };

    const handleAskSignOut = () => {
        setConfirmingSignOut(true);
        // After the confirmation renders
        window.setTimeout(() => confirmRef.current?.focus(), 0);
    };

    const handleSignOut = async () => {
        try {
            await signOut.mutateAsync();
            handleOpenChange(false);
            announce('Signed out');
        } catch {
            // Shown below
        }
    };

    const handleExitReview = () => {
        handleOpenChange(false);
        onExitReview?.();
    };

    const hasActions = Boolean(projectUrl || onExitReview || name || onResetPosition);

    return (
        <Popper
            container={container}
            open={open}
            onOpenChange={handleOpenChange}
            side="top"
            sideOffset={12}
            align="end"
            aria-label="Options"
            className={cx('w-auto min-w-48 max-w-72 rounded-xl p-1', floatingShadowClassName)}
            trigger={(
                <IconButton
                    variant="plain"
                    className="rounded-full"
                    title="Options"
                    aria-label="Options">
                    <MoreHorizontal />
                </IconButton>
            )}>
            {confirmingSignOut ? (
                <Stack spacing={1} className="p-2">
                    <p className="m-0 text-sm text-foreground">
                        Sign out of uier in this browser? You get a new guest name and can no longer
                        resolve or delete the comments you left as {name}.
                    </p>
                    <CommentsErrorMessage error={signOut.error} />
                    <Row spacing={1} justifyContent="end">
                        <Button variant="plain" size="sm" onClick={() => handleOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            ref={confirmRef}
                            variant="outlined"
                            size="sm"
                            loading={signOut.isPending}
                            onClick={handleSignOut}>
                            Sign out
                        </Button>
                    </Row>
                </Stack>
            ) : (
                <Stack>
                    {onResetPosition && (
                        <Button variant="plain" size="sm" className="justify-start" onClick={() => { handleOpenChange(false); onResetPosition(); }}>
                            Reset toolbar position
                        </Button>
                    )}
                    {projectUrl && (
                        <Button
                            variant="plain"
                            size="sm"
                            fullWidth
                            className="justify-start"
                            href={projectUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            startDecorator={<ExternalLink size={16} />}
                            onClick={() => handleOpenChange(false)}>
                            View project
                        </Button>
                    )}
                    {onExitReview && (
                        <Button
                            variant="plain"
                            size="sm"
                            fullWidth
                            className="justify-start"
                            startDecorator={<Close size={16} />}
                            onClick={handleExitReview}>
                            {mode === 'feedback' ? 'Close toolbar' : 'Exit review'}
                        </Button>
                    )}
                    {name && (
                        <Button
                            variant="plain"
                            size="sm"
                            fullWidth
                            className="justify-start"
                            startDecorator={<LogOut size={16} />}
                            onClick={handleAskSignOut}>
                            Sign out...
                        </Button>
                    )}
                    {hasActions && <Divider className="my-1" />}
                    {/* The referrer (the reviewed site's origin) tells uier.io where people came from */}
                    <Button
                        variant="plain"
                        size="sm"
                        fullWidth
                        className="justify-start text-muted-foreground hover:text-foreground"
                        href={BRAND_URL}
                        target="_blank"
                        rel="noopener"
                        startDecorator={<Mark size={16} aria-hidden="true" />}
                        endDecorator={<ExternalLink size={14} aria-hidden="true" className="ml-auto" />}
                        onClick={() => handleOpenChange(false)}>
                        Powered by uier
                    </Button>
                </Stack>
            )}
        </Popper>
    );
}
