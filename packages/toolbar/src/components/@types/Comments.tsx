import type { ToolbarMode } from '../../config';
import type { ReviewSession } from '../../review';

export const popoverWidth = 288;
export const popoverWindowMargin = 8;

/** Maximum length of a comment or reply text (enforced by the API as well) */
export const commentTextMaxLength = 1000;

/** Most comments the API lists for a page (`GET /api/comments`); a full list may have more */
export const commentsListMaxLength = 200;

/**
 * Destructive text (errors, Delete) from the `--destructive` token (#DC2626, 4.8:1 on paper).
 * On the dark surfaces it is mixed with white so it keeps at least 4.5:1 there too.
 */
export const destructiveTextClassName = 'text-[hsl(var(--destructive))] dark:text-[color-mix(in_srgb,hsl(var(--destructive))_55%,white)]';

/**
 * Floating elevation (packages/brand/BRAND.md, "Borders and elevation"): popovers, menus, the hint
 */
export const floatingShadowClassName = 'shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.08)]';

export type CommentPoint = {
    type: 'point';
    selector: string;
    xNormal: number;
    yNormal: number;
};

export type CommentSelection = {
    type: 'text';
    text: string;
    startSelector: string;
    startOffset: number;
    startType: 'text' | 'element';
    endSelector?: string;
    endOffset: number;
    endType: 'text' | 'element';
}

/** Feedback about the page as a whole (feedback and bug reports): no pin */
export type CommentPage = {
    type: 'page';
};

/** Where a comment is pinned: an element (point) or selected text */
export type CommentAnchor = CommentPoint | CommentSelection;

export type CommentItemPosition = CommentAnchor | CommentPage;

/** A comment pinned to the page, general feedback or a bug report */
export type CommentKind = 'comment' | 'feedback' | 'bug';

export type CommentAuthor = {
    /** Display name, `Guest XXXX` for anonymous visitors */
    name: string;
    /** Whether the current visitor wrote this item */
    isMe: boolean;
};

export type CommentItemThreadItem = {
    id: string;
    text: string;
    quotedText?: string;
    author: CommentAuthor;
    /** ISO 8601, missing on old comments */
    createdAt?: string;
    deleted?: undefined;
} | CommentItemDeletedThreadItem;

/**
 * The first item after its author deleted it while others had replied: the thread stays and the
 * item shows as "Comment deleted". It has no text and no author.
 */
export type CommentItemDeletedThreadItem = {
    id: string;
    deleted: true;
    createdAt?: string;
}

export type CommentItemThread = {
    items: CommentItemThreadItem[];
}

export type CommentDeviceSize = 'desktop' | 'tablet' | 'mobile';

/** Device info sent when creating a comment */
export type CommentDeviceInfo = {
    size?: CommentDeviceSize;
    windowSize?: [number, number];
    browser?: string;
    os?: string;
    pixelRatio?: number;
}

/** A comment as returned by the comments API (`CommentDto`) */
export type CommentItem = {
    id: string;
    path: string;
    position: CommentItemPosition;
    /** `feedback` and `bug` have a `page` position */
    kind: CommentKind;
    thread: CommentItemThread;
    /** The coarse device size and the viewport (width, height) it was left from */
    device?: { size?: CommentDeviceSize; windowSize?: [number, number] };
    resolved: boolean;
    /**
     * Whether the current visitor wrote this comment (only the author can resolve or delete it).
     * Always `false` once the author deleted the first item.
     */
    isMine: boolean;
    createdAt?: string;
}

/** A comment that is being written and is not saved yet (the device is read when it is posted) */
export type CommentDraft = {
    position: CommentAnchor;
}

export type CommentsGlobalProps = {
    mode: ToolbarMode;
    /** The review this page is part of (`review` mode, see review.ts) */
    review?: ReviewSession | null;
    rootElement?: HTMLElement;
    /** Ends the review and removes the toolbar from the page (`review` mode only) */
    onExitReview?: () => void;
}
