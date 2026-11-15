'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';
import { enterMs, motionEasing, onScreen, reducedMotionQuery, slidePx, staggerDelays } from './LayoutMotion';

/** A card on its way out: the thread as it was shown, its column and its place there */
type Leaving = { comment: ProjectCommentView; lane: string; index: number };
type Shown = {
    key: string;
    lanes: Record<string, ProjectCommentView[]>;
    leaving: ReadonlyMap<string, Leaving>;
    /** Columns that their archived cards left empty a moment ago */
    emptied: ReadonlySet<string>;
    /** Cards that came to a column while cards were leaving it (its next page): shown once those have gone */
    held: ReadonlySet<string>;
    /** The cards that came to an emptied column, or were held, in the last change: its next page (`LayoutMotion`'s `appends`) */
    rising: ReadonlySet<string>;
};
/** How long a column emptied by archiving waits for its next page to rise in */
const emptiedMs = 5000;

const keyOf = (lanes: Record<string, ProjectCommentView[]>) => Object.entries(lanes).map(([lane, cards]) => `${lane}:${cards.map(card => card.id).join(',')}`).join('|');

/** A column's cards with the ones leaving it back in their places */
function withLeaving(cards: ProjectCommentView[], lane: string, leaving: ReadonlyMap<string, Leaving>) {
    const back = [...leaving.values()].filter(card => card.lane === lane).sort((a, b) => a.index - b.index);
    if (!back.length) return cards;
    const shown = [...cards];
    for (const { comment, index } of back) shown.splice(Math.min(index, shown.length), 0, comment);
    return shown;
}

/** What a column shows: its cards but the held ones, with the leaving ones in their places */
const shownCards = (state: Pick<Shown, 'lanes' | 'leaving' | 'held'>, lane: string) =>
    withLeaving((state.lanes[lane] ?? []).filter(card => !state.held.has(card.id)), lane, state.leaving);

/** The held cards of columns that no longer have cards leaving them: they rise in now */
function release(lanes: Record<string, ProjectCommentView[]>, leaving: ReadonlyMap<string, Leaving>, held: ReadonlySet<string>) {
    const busy = new Set([...leaving.values()].map(card => card.lane));
    const released = new Set(Object.entries(lanes).flatMap(([lane, cards]) => busy.has(lane) ? [] : cards.filter(card => held.has(card.id)).map(card => card.id)));
    return { held: new Set([...held].filter(id => !released.has(id))), released };
}

/**
 * Archived cards leave the board one after another from the top (uier #444). A card that leaves its column because it
 * was archived (by Archive all, the selection bar, its thread's menu or another person) stays in its place a little
 * longer, `inert` and hidden from assistive technology, and fades out with an 8 px slide, each a moment after the one
 * above it (`staggerDelays`); when the last one has gone they all leave the page together and the cards below slide up
 * (`LayoutMotion`, which needs no copies of `inert` items). Only cards on screen take part; the rest wait unseen.
 *
 * Nothing waits with reduced motion, in a hidden tab or a board that is not shown, or when `enabled` is off (Archive
 * expanded, where the cards travel to it instead). A card that comes back before it has gone (a failed save) stays.
 * The keyboard focus in a leaving card goes to the next card in its column (or the one before it): `onFocus`.
 */
export function useLeavingCards({ lanes, allComments, enabled, container, focusedId, onFocus }: {
    /** Each column's cards, as the board shows them */
    lanes: Record<string, ProjectCommentView[]>;
    /** Every thread the board knows, archived ones too: what tells an archived card from one filtered out */
    allComments: ProjectCommentView[];
    enabled: boolean;
    /** The board's grid, which holds the cards (`data-board-card`) */
    container: RefObject<HTMLElement | null>;
    /** The card that had the keyboard focus last */
    focusedId?: string;
    /** Gives the focus to this card */
    onFocus: (id: string) => void;
}) {
    const key = keyOf(lanes);
    const [shown, setShown] = useState<Shown>(() => ({ key, lanes, leaving: new Map(), emptied: new Set(), held: new Set(), rising: new Set() }));
    let current = shown;
    // During render, from what the board showed last time (React's pattern for information from previous renders),
    // so the cards never leave the page for a frame before they come back to leave slowly
    if (shown.key !== key) {
        const kept = new Set(Object.values(lanes).flat().map(card => card.id));
        const leaving = new Map([...shown.leaving].filter(([id]) => !kept.has(id)));
        if (enabled) {
            const archived = new Set(allComments.filter(comment => comment.archivedAt).map(comment => comment.id));
            for (const lane of Object.keys(shown.lanes)) {
                shownCards(shown, lane).forEach((comment, index) => {
                    if (archived.has(comment.id) && !kept.has(comment.id) && !leaving.has(comment.id)) leaving.set(comment.id, { comment, lane, index });
                });
            }
        }
        // The cards that fill a column its archived cards emptied are its next page (a refresh after Archive all or the
        // selection bar's Archive): they rise in one after another, like a page loaded below the cards that stay
        const filled = [...shown.emptied].filter(lane => lanes[lane]?.length);
        // Cards that come to a column while others leave it wait, and come in below the cards that stay once those have gone
        const before = new Set(Object.values(shown.lanes).flat().map(card => card.id));
        const busy = new Set([...leaving.values()].map(card => card.lane));
        const arrived = Object.entries(lanes).flatMap(([lane, cards]) => busy.has(lane) ? cards.filter(card => !before.has(card.id)).map(card => card.id) : []);
        const { held, released } = release(lanes, leaving, new Set([...shown.held, ...arrived].filter(id => kept.has(id))));
        const rising = new Set([...filled.flatMap(lane => lanes[lane]!.map(card => card.id)), ...released]);
        current = { key, lanes, leaving, emptied: new Set([...shown.emptied].filter(lane => !filled.includes(lane))), held, rising };
        setShown(current);
    }
    const leaving = current.leaving;
    // From the columns as they are now (the stored ones only tell what changed), so every card shows its latest data
    const cardsOf = (lane: string) => shownCards({ lanes, leaving: current.leaving, held: current.held }, lane);

    const running = useRef(new Map<string, Animation>());
    useLayoutEffect(() => {
        // Back before it had gone: shown again
        for (const [id, animation] of running.current) {
            if (!leaving.has(id)) {
                animation.cancel();
                running.current.delete(id);
            }
        }
        const fresh = [...leaving.keys()].filter(id => !running.current.has(id));
        if (!fresh.length) return;
        const root = container.current;
        // Each leaving card's exit; the ones off screen have none to play and wait with the rest
        const animations = new Map(fresh.map(id => [id, new Animation()]));
        for (const [id, animation] of animations) running.current.set(id, animation);
        const finish = () => {
            // Only the cards still leaving with these exits (not those that came back, or left again since)
            const gone = new Set(fresh.filter(id => running.current.get(id) === animations.get(id)));
            for (const id of gone) running.current.delete(id);
            setShown(state => {
                const rest = new Map([...state.leaving].filter(([id]) => !gone.has(id)));
                if (rest.size === state.leaving.size) return state;
                const left = new Set([...state.leaving.values()].filter(card => !rest.has(card.comment.id)).map(card => card.lane));
                const emptied = [...left].filter(lane => !state.lanes[lane]?.length && ![...rest.values()].some(card => card.lane === lane));
                const { held, released } = release(state.lanes, rest, state.held);
                return { ...state, leaving: rest, emptied: new Set([...state.emptied, ...emptied]), held, rising: released };
            });
            window.setTimeout(() => setShown(state => state.emptied.size ? { ...state, emptied: new Set() } : state), emptiedMs);
        };
        const elements = fresh.map(id => [id, root?.querySelector<HTMLElement>(`[data-board-card="${CSS.escape(id)}"]`) ?? null] as const);
        // The focus was in a leaving card (it may have left already, as the card is inert): the next card takes it
        const focused = elements.find(([id, element]) => element?.contains(document.activeElement)
            || (id === focusedId && (!document.activeElement || document.activeElement === document.body)));
        if (focused) {
            const { lane } = leaving.get(focused[0])!;
            const cards = cardsOf(lane);
            const at = cards.findIndex(card => card.id === focused[0]);
            const next = cards.slice(at + 1).find(card => !leaving.has(card.id)) ?? cards.slice(0, at).reverse().find(card => !leaving.has(card.id));
            if (next) onFocus(next.id);
        }
        if (!root?.checkVisibility() || document.visibilityState !== 'visible' || window.matchMedia(reducedMotionQuery).matches) {
            finish();
            return;
        }
        // From the top, then from the left: a selection across columns leaves row by row
        const visible = elements.flatMap(([id, element]) => {
            const rect = element?.getBoundingClientRect();
            return element && rect && onScreen(rect) ? [{ id, element, rect }] : [];
        }).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
        const delays = staggerDelays(visible.length);
        visible.forEach(({ id, element }, index) => {
            const animation = element.animate([
                { opacity: 1, transform: 'none' },
                { opacity: 0, transform: `translateY(-${slidePx}px)` }
            ], { duration: enterMs, delay: delays[index], easing: motionEasing, fill: 'forwards' });
            animations.set(id, animation);
            running.current.set(id, animation);
        });
        // The ones off screen go with the last one, so nothing above the fold moves while the others leave
        void Promise.allSettled(visible.map(({ id }) => animations.get(id)!.finished)).then(finish);
    });

    return { cardsOf, leaving: leaving as ReadonlyMap<string, unknown>, rising: current.rising };
}
