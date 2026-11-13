import { cloneElement, type ReactElement, useState } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ThreadLabel } from '@/src/lib/app/threadLabel';
import { labelLaneMatches } from '@/src/lib/app/projectCommentPaging';
import { BoardRowScope } from './CommentRow';
import type { CommentBoard } from './CommentBoard';
import type { ComponentProps } from 'react';
type Board = ReactElement<ComponentProps<typeof CommentBoard>>;
/** A multi-label thread appears in each matching lane. Only the board opened from owns its sheet. */
export function LabelBoards({ grouped, labels, renderBoard }: { grouped: boolean; labels: ThreadLabel[]; renderBoard: (group?: string) => Board }) {
    const { t } = useAppI18n();
    const [active, setActive] = useState<string>();
    if (!grouped) return renderBoard();
    const groups = [...labels.map(label => ({ id: label.id, name: label.name })), { id: 'unlabeled', name: t('Ungrouped') }];
    const sample = renderBoard(groups[0]!.id);
    const opened = sample.props.allComments.find(comment => comment.id === sample.props.openComment.openId);
    const owner = groups.find(group => group.id === active && opened && labelLaneMatches(opened.labels, group.id, labels.map(label => label.id)))?.id
        ?? groups.find(group => opened && labelLaneMatches(opened.labels, group.id, labels.map(label => label.id)))?.id;
    return <div className="space-y-8">{groups.map(group => {
        const board = renderBoard(group.id);
        return <section key={group.id} aria-label={group.name} data-label-lane={group.id}>
            <h2 className="page-reading mb-3 text-sm font-medium">{group.name}</h2>
            <BoardRowScope value={`${group.id}-`}>{cloneElement(board, { openComment: { ...board.props.openComment,
                openId: owner === group.id ? board.props.openComment.openId : undefined,
                open: (...args: Parameters<typeof board.props.openComment.open>) => { setActive(group.id); return board.props.openComment.open(...args); }
            } })}</BoardRowScope>
        </section>;
    })}</div>;
}
