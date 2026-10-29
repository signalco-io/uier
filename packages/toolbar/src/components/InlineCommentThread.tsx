import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Divider } from '@signalco/ui-primitives/Divider';
import { useComments } from '../hooks/useComments';
import { useLayoutVersion } from '../hooks/useLayoutVersion';
import { useAnnounce } from './Announcer';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentComposer } from './CommentComposer';
import { CommentThread } from './CommentThread';
import { CommentErrorBoundary } from './CommentErrorBoundary';
import type { CommentItem } from './@types/Comments';
import { adoptToolbarStyles } from '../stylesheet';

/** An optional, live thread in the page's layout; uses the toolbar's styles, cache and identity. */
function InlineCommentThread({ comment, target }: { comment: CommentItem; target: HTMLElement }) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const { reply } = useComments();
    const announce = useAnnounce();
    const [container, setContainer] = useState<HTMLElement>();

    useEffect(() => {
        const toolbarRoot = rootElement?.getRootNode();
        if (!target || !(toolbarRoot instanceof ShadowRoot)) {
            setContainer(undefined);
            return;
        }
        const shadow = target.shadowRoot ?? target.attachShadow({ mode: 'open' });
        const removeStyles = adoptToolbarStyles(shadow);
        const content = document.createElement('div');
        content.dataset.uierRoot = '';
        const scheme = window.matchMedia('(prefers-color-scheme: dark)');
        const applyScheme = () => { content.className = scheme.matches ? 'dark' : ''; };
        applyScheme();
        scheme.addEventListener('change', applyScheme);
        shadow.appendChild(content);
        setContainer(content);
        return () => {
            scheme.removeEventListener('change', applyScheme);
            content.remove();
            removeStyles();
        };
    }, [target, rootElement]);

    return container && createPortal(
        <section aria-label="Headline comment thread" className="overflow-hidden rounded-xl border bg-card text-card-foreground">
            <CommentThread commentItem={comment} />
            <Divider />
            <CommentComposer
                label="Reply to the headline" placeholder="Reply..." submitLabel="Post reply"
                draftKey={comment.id} error={reply.error}
                commentId={comment.id}
                onSubmit={async (text, mentions) => {
                    await reply.mutateAsync({ commentId: comment.id, text, mentions });
                    announce('Reply posted');
                }} />
        </section>, container);
}

/** Resolve inline slots once per layout change, rather than once for every comment. */
export function InlineCommentThreads({ comments }: { comments: CommentItem[] }) {
    useLayoutVersion();
    return [...document.querySelectorAll<HTMLElement>('[data-uier-thread]')].map(target => {
        const comment = comments.find(comment => comment.id === target.dataset.uierThread);
        return comment ? (
            <CommentErrorBoundary key={comment.id} commentId={comment.id}>
                <InlineCommentThread comment={comment} target={target} />
            </CommentErrorBoundary>
        ) : null;
    });
}
