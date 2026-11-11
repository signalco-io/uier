'use client';

import { createAppTranslator } from '@/src/lib/i18n/translate';
import { useAppI18n } from '@/src/lib/i18n/client';

import type { MouseEvent } from 'react';
import { UserIcon } from 'lucide-react';
import { Mark } from '@uier/brand/Mark';
import { cn } from '@/src/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/src/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import type { ProjectCommentAuthor } from '../../../lib/app/projectComments';
import { initials } from '../initials';
import { AgentAvatar } from './AgentAvatar';

/** "You", "Ana", "Ana via Claude", "Guest 3F2A", "uier": who wrote a comment, as its avatar's tooltip says */
export function authorText(author: ProjectCommentAuthor, deleted = false, t: import('@/src/lib/i18n/types').AppTranslator = createAppTranslator({})) {
    if (deleted || author.kind === 'deleted') return t("Deleted");
    const name = author.isMe ? t("You") : author.name;
    return author.agent ? t("{name} via {agent}", { name, agent: author.agent.label }) : name;
}

/** The avatar of one author kind, 20px like the assignee's */
function AuthorFace({ author, deleted }: { author: ProjectCommentAuthor; deleted: boolean }) {
    if (!deleted && author.kind === 'uier') {
        return (
            <span aria-hidden="true" data-author-avatar="uier" className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-background text-foreground">
                <Mark size={10} />
            </span>
        );
    }
    // A guest (or a deleted message) has no picture and no name of their own: a person's outline
    const anonymous = deleted || author.kind === 'guest' || author.kind === 'deleted';
    return (
        <Avatar aria-hidden="true" data-author-avatar={deleted ? 'deleted' : author.kind ?? 'member'} className="size-5">
            {!anonymous && author.avatarUrl && <AvatarImage src={author.avatarUrl} alt="" />}
            <AvatarFallback className={cn('text-[10px] font-semibold text-foreground', anonymous && 'text-muted-foreground')}>
                {anonymous ? <UserIcon className="size-3" /> : initials(author.name)}
            </AvatarFallback>
        </Avatar>
    );
}

/**
 * Who wrote a comment, for list rows and board cards: a member's picture (or initial) with the AI agent that
 * wrote it for them stacked on its edge, a person's outline for a guest, the initial of a connected tool's
 * reviewer, uier's mark for its own threads. One image named "By …", with the name in a tooltip. It sits above
 * the link that covers the row (for the tooltip), so a click on it is passed on to that link (`onPress`).
 */
export function AuthorAvatar({ author, deleted = false, onPress }: {
    author: ProjectCommentAuthor;
    deleted?: boolean;
    /** Opens the row's thread, as a click anywhere else on the row does */
    onPress?: (event: MouseEvent<HTMLElement>) => void;
}) {
    const { t } = useAppI18n();
    const text = authorText(author, deleted, t);
    const label = deleted || author.kind === 'deleted' ? t("Author deleted") : t("By {author}", { author: author.agent ? t("{name} via {agent}", { name: author.isMe ? t("you") : author.name, agent: author.agent.label }) : author.isMe ? t("you") : author.name });
    return (
        <Tooltip>
            <TooltipTrigger onClick={event => { event.preventDefault(); onPress?.(event); }}
                render={<span role="img" aria-label={label} data-comment-author="" className="relative z-10 flex shrink-0 items-center" />}>
                <AuthorFace author={author} deleted={deleted} />
                {!deleted && author.agent && <AgentAvatar kind={author.agent.kind} className="-ml-1.5 ring-2 ring-background" />}
            </TooltipTrigger>
            <TooltipContent>{text}</TooltipContent>
        </Tooltip>
    );
}
