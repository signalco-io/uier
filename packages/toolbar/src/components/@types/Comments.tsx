import type { ToolbarMode } from '../../config';

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

export type CommentItemPosition = CommentPoint | CommentSelection;

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
    thread: CommentItemThread;
    /** Only the coarse device size is returned */
    device?: { size?: CommentDeviceSize };
    resolved: boolean;
    /**
     * Whether the current visitor wrote this comment (only the author can resolve or delete it).
     * Always `false` once the author deleted the first item.
     */
    isMine: boolean;
    createdAt?: string;
}

/** A comment that is being written and is not saved yet */
export type CommentDraft = {
    position: CommentItemPosition;
    device?: CommentDeviceInfo;
}

export type CommentsGlobalProps = {
    mode: ToolbarMode;
    reviewParamKey?: string;
    rootElement?: HTMLElement;
}
