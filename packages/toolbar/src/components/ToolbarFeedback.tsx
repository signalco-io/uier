'use client';

import { useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Row } from '@signalco/ui-primitives/Row';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { Megaphone } from '@signalco/ui-icons';
import { useComments } from '../hooks/useComments';
import { feedbackDraftKey, useDrafts } from '../hooks/useDrafts';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentComposer } from './CommentComposer';
import { CommentKindIcon, commentKindLabels } from './CommentKindLabel';
import { useAnnounce } from './Announcer';
import { getDeviceInfo } from './info/getDeviceInfo';
import { captureCommentScreenshot } from '../screenshot';
import { floatingShadowClassName } from './@types/Comments';

type FeedbackKind = 'feedback' | 'bug';

const kinds: { value: FeedbackKind; placeholder: string; submitLabel: string; sent: string }[] = [
    { value: 'feedback', placeholder: 'What works well, what could be better?', submitLabel: 'Send feedback', sent: 'Feedback sent' },
    { value: 'bug', placeholder: 'What went wrong, and what did you expect?', submitLabel: 'Send bug report', sent: 'Bug report sent' }
];

/**
 * The toolbar's feedback button: general feedback (heart) or a bug report (bug) about the page,
 * not pinned to an element. Saved as a comment with a `page` position and its kind, so it shows
 * in the inbox like any other thread.
 */
export function ToolbarFeedback({ onOpen, openRequested = false, onOpenRequestHandled }: {
    onOpen?: () => void;
    /** The page asked to give feedback (a "Give feedback" button): the form opens once */
    openRequested?: boolean;
    onOpenRequestHandled?: () => void;
}) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const { create } = useComments();
    const drafts = useDrafts();
    const announce = useAnnounce();
    const [open, setOpen] = useState(false);
    const screenshot = useRef<Promise<string | undefined>>(undefined);
    const device = useRef<ReturnType<typeof getDeviceInfo>>(undefined);
    const [kind, setKind] = useState<FeedbackKind>(() => (drafts.details(`${feedbackDraftKey}:bug`)?.updatedAt ?? 0) > (drafts.details(`${feedbackDraftKey}:feedback`)?.updatedAt ?? 0) ? 'bug' : 'feedback');
    const selected = kinds.find(k => k.value === kind) ?? kinds[0]!;

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (next) {
            device.current = getDeviceInfo();
            screenshot.current = captureCommentScreenshot({ type: 'page' }, rootElement);
            onOpen?.();
        } else {
            create.reset();
        }
    };

    const openOnRequest = useEffectEvent(() => {
        if (!open) {
            handleOpenChange(true);
        }
        onOpenRequestHandled?.();
    });
    useEffect(() => {
        if (openRequested) {
            openOnRequest();
        }
    }, [openRequested]);

    const handleSubmit = async (text: string, mentions?: import('./@types/Comments').Mention[]) => {
        await create.mutateAsync({
            position: { type: 'page' },
            kind,
            text,
            mentions,
            device: device.current,
            screenshot: await screenshot.current
        });
        drafts.delete(`${feedbackDraftKey}:${kind}`);
        handleOpenChange(false);
        announce(selected.sent);
    };

    return (
        <Popper
            container={rootElement}
            open={open}
            onOpenChange={handleOpenChange}
            side="top"
            sideOffset={12}
            aria-label="Send feedback"
            className={cx('flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-xl p-0', floatingShadowClassName)}
            trigger={(
                <IconButton
                    variant="plain"
                    className="rounded-full"
                    title="Send feedback"
                    aria-label="Send feedback">
                    <Megaphone />
                </IconButton>
            )}>
            <div className="bg-card px-3 pt-3">
                <Typography component="h2" level="body2" semiBold className="mb-2 text-foreground">
                    Send feedback
                </Typography>
                {/* Like the inbox's status switch: two pressed/unpressed buttons */}
                <Row role="group" aria-label="Type" className="rounded-md bg-muted p-0.5">
                    {kinds.map((k) => (
                        <Button
                            key={k.value}
                            size="sm"
                            variant="plain"
                            aria-pressed={kind === k.value}
                            className={cx(
                                'flex-1 gap-1.5 rounded-sm',
                                kind === k.value ? 'bg-accent text-foreground' : 'text-muted-foreground'
                            )}
                            startDecorator={<CommentKindIcon kind={k.value} />}
                            onClick={() => setKind(k.value)}>
                            {commentKindLabels[k.value]}
                        </Button>
                    ))}
                </Row>
            </div>
            <CommentComposer
                key={kind}
                label={commentKindLabels[kind]}
                placeholder={selected.placeholder}
                submitLabel={selected.submitLabel}
                draftKey={`${feedbackDraftKey}:${kind}`}
                autoFocus
                pending={create.isPending}
                error={create.error}
                onSubmit={handleSubmit} />
        </Popper>
    );
}
