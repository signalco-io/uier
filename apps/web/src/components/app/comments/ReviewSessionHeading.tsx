'use client';

import { Fragment, useRef, useState, useTransition } from 'react';
import { SendIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { CommentReviewGroup } from '@/src/lib/app/projectCommentPaging';
import { Button } from '@/src/components/ui/button';
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '@/src/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { sendProjectReviewAction } from './actions';
import { RelativeTime } from './DateTime';

export function ReviewSessionHeading({ projectId, group }: { projectId: string; group?: CommentReviewGroup }) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    const [sending, startSending] = useTransition();
    const attempt = useRef<{ draftId: string; key: string }>(undefined);
    // Send now leaves with the pending comments: the focus comes back to the group's heading
    const headingRef = useRef<HTMLHeadingElement>(null);
    const [sent, setSent] = useState(false);
    if (!group) return <h2 className="px-3 py-2 text-sm font-medium">{t('Ungrouped')}</h2>;
    const title = group.number ? t('Review {number}', { number: group.number }) : t('Review session');
    const send = group.send;
    const sendLabel = t('Send now');
    const submit = () => {
        if (!send) return;
        if (attempt.current?.draftId !== send.draftId) attempt.current = { draftId: send.draftId, key: crypto.randomUUID() };
        const idempotencyKey = attempt.current.key;
        startSending(async () => {
            const result = await sendProjectReviewAction({ projectId, reviewSessionId: group.id, ...send, idempotencyKey }).catch(() => null);
            if (result?.ok) {
                setSent(true);
                setOpen(false);
                toast.success(t('Review sent.'));
            } else toast.error(result?.error || t('Could not send the review. Try again.'));
        });
    };
    const details = [
        <span key="reviewer">{group.reviewer}</span>,
        <span key="count" className="tabular-nums">{group.count === 1 ? t('1 comment') : t('{count} comments', { count: group.count })}</span>,
        group.pendingCount > 0 && <span key="pending" className="tabular-nums">{t('{count} not sent', { count: group.pendingCount })}</span>,
        group.submittedAt && <RelativeTime key="sent" value={group.submittedAt} short />
    ].filter(Boolean);
    return <div data-review-group={group.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
        <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1} className="m-0 text-sm font-medium outline-none">{title}</h2>
            <p className="m-0 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                {details.map((detail, index) => <Fragment key={index}>
                    {index > 0 && <span aria-hidden="true">·</span>}
                    {detail}
                </Fragment>)}
            </p>
        </div>
        {send && <AlertDialog open={open} onOpenChange={value => { if (!sending) { setOpen(value); setSent(false); } }}>
            <Tooltip>
                <TooltipTrigger render={<AlertDialogTrigger render={<Button variant="outline" size="icon-sm" className="pointer-coarse:size-11" aria-label={sendLabel} />} />}>
                    <SendIcon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                </TooltipTrigger>
                <TooltipContent>{sendLabel}</TooltipContent>
            </Tooltip>
            <AlertDialogContent finalFocus={sent ? headingRef : undefined}>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('Send review')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('Send the pending comments to eligible recipients and connected services?')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={sending}>{t('Cancel')}</AlertDialogCancel>
                    <Button disabled={sending} onClick={submit}>{sending ? t('Sending…') : t('Send review')}</Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>}
    </div>;
}
