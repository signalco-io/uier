import type { PropsWithChildren } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Close } from '@signalco/ui-icons';
import { InkScope } from './InkScope';

type ProjectNoticeProps = PropsWithChildren<{
    text: string;
    action?: { label: string } & ({ onClick: () => void; href?: never } | { href: string; onClick?: never });
    onExitReview?: () => void;
}>;

/** One next step, plus Exit review, in the review layer's ink pill. */
export function ProjectNotice({ text, action, onExitReview, children }: ProjectNoticeProps) {
    return <InkScope>
        <nav aria-label="uier feedback" className="fixed bottom-4 left-1/2 z-[51] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
            <div role="group" aria-label="uier feedback toolbar"
                className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-full border bg-background p-2 pl-4 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                <p className="m-0 min-w-0 flex-1 basis-48 text-sm">{text}</p>
                {(action || onExitReview) && <div className="flex shrink-0 items-center gap-1">
                    {action && <Button variant="solid" size="sm" className="rounded-full"
                        onClick={action.onClick} href={action.href}
                        target={action.href ? '_blank' : undefined} rel={action.href ? 'noopener noreferrer' : undefined}>
                        {action.label}
                    </Button>}
                    {onExitReview && <IconButton variant="plain" className="rounded-full"
                        title="Exit review" aria-label="Exit review" onClick={onExitReview}>
                        <Close />
                    </IconButton>}
                </div>}
            </div>
            {children}
        </nav>
    </InkScope>;
}
