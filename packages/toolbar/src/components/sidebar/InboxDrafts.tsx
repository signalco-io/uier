import { useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Close, Edit, Send } from '@signalco/ui-icons';
import { useDrafts } from '../../hooks/useDrafts';
import { useCommentPlacement } from '../../hooks/useCommentItemRects';
import { markdownPlainText } from '../../markdown';
import { matchesFeedbackSearch } from '../../triage';
import { ColorText } from '../ColorText';
import { CommentErrorBoundary } from '../CommentErrorBoundary';
import { CommentTime } from '../CommentTime';
import { IconTooltip } from '../IconTooltip';
import { useMessages } from '../../i18n';
import type { CommentDraft } from '../@types/Comments';

/** A new comment or rewrite of this page that is not sent yet (a draft pin, `CommentsGlobal`) */
export type InboxDraft = Pick<CommentDraft, 'kind' | 'position'> & { draftKey: string };

type InboxDraftsProps = {
    /** This page's drafts; those with text are listed, newest first */
    drafts: InboxDraft[];
    /** The inbox's search: the drafts with every word */
    keywords?: string;
    /** Opens its form on its pin */
    onResume: (draftKey: string) => void;
    /** Posts it as it is */
    onSend: (draftKey: string) => void;
    onDiscard: (draftKey: string) => void;
};

/**
 * This page's unsent comments and rewrites (uier #296), above its threads: each with its text, to resume (its form on
 * its pin), post or discard. Kept in this browser like every draft (hooks/useDrafts.tsx).
 */
export function InboxDrafts({ drafts: pageDrafts, keywords = '', onResume, onSend, onDiscard }: InboxDraftsProps) {
    const drafts = useDrafts();
    // Any draft of the page: typed in a form, sent, discarded or back after a failed send
    useSyncExternalStore(drafts.subscribeAll, drafts.version);
    const t = useMessages();
    const headingId = useId();
    const sectionRef = useRef<HTMLElement>(null);
    const listed = pageDrafts.flatMap(draft => {
        const saved = drafts.details(draft.draftKey);
        const text = saved?.text.trim();
        const quote = draft.position.type === 'text' ? draft.position.text : undefined;
        if (!saved || !text || !matchesFeedbackSearch({ path: '', messages: [{ text, quotedText: quote }] }, keywords)) return [];
        return [{ draft, text, quote, updatedAt: saved.updatedAt }];
    }).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!listed.length) return null;

    // The card goes: the focus moves on to the next draft's, else to the drafts' heading (the inbox when none is left)
    const keepFocus = (index: number, act: () => void) => {
        const root = sectionRef.current?.getRootNode() as ShadowRoot | Document | undefined;
        act();
        requestAnimationFrame(() => {
            const active = root?.activeElement;
            if (active && active !== document.body && sectionRef.current?.contains(active)) return;
            const cards = [...sectionRef.current?.querySelectorAll<HTMLElement>('[data-uier-inbox-draft]') ?? []];
            const next = cards[Math.min(index, cards.length - 1)]?.querySelector<HTMLElement>('button');
            (next ?? sectionRef.current?.closest<HTMLElement>('[data-uier-inbox-scroll]'))?.focus();
        });
    };

    return (
        <section ref={sectionRef} aria-labelledby={headingId} data-uier-inbox-drafts="">
            <h3 id={headingId} className="m-0 mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                {t.inbox.drafts}
                <span className="tabular-nums">{listed.length}</span>
            </h3>
            <Stack spacing={2}>
                {listed.map(({ draft, text, quote, updatedAt }, index) => (
                    <CommentErrorBoundary key={draft.draftKey}>
                        <InboxDraftCard
                            draft={draft}
                            text={text}
                            quote={quote}
                            updatedAt={updatedAt}
                            onResume={() => onResume(draft.draftKey)}
                            onSend={() => keepFocus(index, () => onSend(draft.draftKey))}
                            onDiscard={() => keepFocus(index, () => onDiscard(draft.draftKey))} />
                    </CommentErrorBoundary>
                ))}
            </Stack>
        </section>
    );
}

function InboxDraftCard({ draft, text, quote, updatedAt, onResume, onSend, onDiscard }: {
    draft: InboxDraft;
    text: string;
    quote?: string;
    updatedAt: number;
    onResume: () => void;
    onSend: () => void;
    onDiscard: () => void;
}) {
    const t = useMessages();
    // Resumed on its pin, so only while that can be placed (the pin's own placement); else it says why
    const { rects, state } = useCommentPlacement(draft.position);
    const rewriting = draft.kind === 'rewrite';
    const label = rewriting ? t.inbox.draftRewrite : t.inbox.draftComment;
    return (
        <article aria-label={label} data-uier-inbox-draft={draft.draftKey}
            className="overflow-hidden rounded-xl border bg-card">
            <Stack spacing={1} className="px-3 pb-2 pt-2.5">
                <p className="m-0 flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate font-medium text-foreground">{label}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0"><CommentTime date={new Date(updatedAt)} /></span>
                </p>
                {quote && (
                    <blockquote className="m-0 line-clamp-2 border-l-2 border-border pl-2.5 text-xs text-secondary-foreground">{quote}</blockquote>
                )}
                <p className="m-0 line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground"><ColorText text={markdownPlainText(text)} /></p>
                {!rects.length && state !== 'page' && <p className="m-0 text-xs text-muted-foreground">{t.anchor.state[state]}</p>}
            </Stack>
            <div className="flex min-w-0 flex-wrap items-center gap-1 border-t px-2 py-1">
                {rects.length > 0 && (
                    <DraftAction icon={<Edit size={14} aria-hidden="true" />} onClick={onResume}>{t.toolbar.resumeDraft}</DraftAction>
                )}
                <DraftAction icon={<Send size={14} aria-hidden="true" />} onClick={onSend}>
                    {rewriting ? t.pin.postSuggestion : t.pin.postComment}
                </DraftAction>
                {/* An X, as in the form: named by its tooltip */}
                <IconTooltip label={t.composer.discard}>
                    <IconButton variant="plain" size="xs" className="ml-auto size-7 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                        aria-label={t.composer.discard} onClick={onDiscard}>
                        <Close size={14} aria-hidden="true" />
                    </IconButton>
                </IconTooltip>
            </div>
        </article>
    );
}

function DraftAction({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
    return (
        <Button size="xs" variant="plain" className="text-muted-foreground hover:text-foreground" startDecorator={icon} onClick={onClick}>
            {children}
        </Button>
    );
}
