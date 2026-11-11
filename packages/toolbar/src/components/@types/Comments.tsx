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

/**
 * The blue focus ring of an input (BRAND.md) for the UI kit's `Input`: its `className` and its
 * `focus-visible` ring go on a wrapper around the `<input>`, which never has the focus itself
 */
export const inputFocusRingClassName = 'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background';

/**
 * A point on an element, as fractions of its box. With `widthNormal` and `heightNormal` it is an
 * area dragged over the page: the point is the area's top-left corner, and toolbars without area
 * support still show a pin there.
 */
export type CommentPoint = {
    type: 'point';
    selector: string;
    xNormal: number;
    yNormal: number;
    widthNormal?: number;
    heightNormal?: number;
    layer?: CommentLayer;
};

/**
 * The anchor is in a menu, popover or dialog that a page element opens (`layerAnchor.ts`): that
 * element's selector and its name ("Account"). While it is closed, the pin is on the opener.
 * On uier's own pages, a toolbar layer inside another (Copy in a thread) adds `nested`: the
 * toolbar buttons that open the inner layers, outside in, each in the layer the one before opens.
 */
export type CommentLayer = {
    opener: string;
    label?: string;
    nested?: string[];
};

/** Whether the point is a dragged area (both sizes set) */
export function isCommentArea(position: CommentItemPosition | null | undefined): position is CommentPoint & { widthNormal: number; heightNormal: number } {
    return position?.type === 'point' && position.widthNormal !== undefined && position.heightNormal !== undefined;
}

export type CommentSelection = {
    type: 'text';
    text: string;
    startSelector: string;
    startOffset: number;
    startType: 'text' | 'element';
    endSelector?: string;
    endOffset: number;
    endType: 'text' | 'element';
    layer?: CommentLayer;
}

/** Feedback about the page as a whole (feedback and bug reports): no pin */
export type CommentPage = {
    type: 'page';
};

/** Where a comment is pinned: an element (point) or selected text */
export type CommentAnchor = CommentPoint | CommentSelection;

export type CommentItemPosition = CommentAnchor | CommentPage;

/**
 * A comment pinned to the page, general feedback or a bug report, or a rewrite suggestion for
 * selected text (its first message is the suggested text, the quote the original)
 */
export type CommentKind = import('../../feedbackTypes').CommentKind;

export type CommentAuthor = {
    /** Display name, `Guest XXXX` for anonymous visitors */
    name: string;
    /** Whether the current visitor wrote this item */
    isMe: boolean;
};

export type Mention = { userId: string; start: number; end: number; name?: string };

export type CommentItemThreadItem = {
    screenshot?: { width: number; height: number };
    mentions?: Mention[];
    id: string;
    text: string;
    quotedText?: string;
    author: CommentAuthor;
    /** ISO 8601, missing on old comments */
    createdAt?: string;
    /** Project comments: whether the reviewer may delete this item (its author or an admin) */
    canDelete?: boolean;
    canEdit?: boolean;
    editedAt?: string;
    deleted?: undefined;
    /** Shown before the API saved it (an optimistic reply, see hooks/useComments.tsx) */
    pending?: boolean;
    /**
     * Project comments: the AI agent that wrote it for its author through a coding tool connection; the
     * author's name already ends with "via <label>". Its model and reasoning level reach members only.
     */
    agent?: import('../../agents').MessageAgentView;
    /** Emoji reactions to the message, in the quick set's order (`@uier/toolbar/reactions`); missing when none */
    reactions?: import('../../reactions').MessageReaction[];
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

/** The primary pointer (`pointer: coarse` is touch), the colour scheme the page's CSS sees */
export type CommentDeviceInput = 'touch' | 'mouse';
export type CommentColorScheme = 'light' | 'dark';

/** Device info sent when creating a comment (`getDeviceInfo`): parsed names and settings, never the user-agent string */
export type CommentDeviceInfo = {
    capturedAt?: string;
    size?: CommentDeviceSize;
    windowSize?: [number, number];
    /** "Safari (18.1)" */
    browser?: string;
    /** "macOS 15.1", "Windows" (no version when the browser reports a frozen one) */
    os?: string;
    pixelRatio?: number;
    /** A phone's or tablet's model, when the browser reports it ("Pixel 8") */
    model?: string;
    input?: CommentDeviceInput;
    colorScheme?: CommentColorScheme;
    reducedMotion?: boolean;
    /** The page's `<html lang>`: language, script and region ("en-GB") */
    pageLanguage?: string;
}

/** The member-only device details of a saved comment, as the API returns them (`ReproductionContext`) */
export type CommentReproduction = {
    browser?: string; os?: string; model?: string; capturedAt?: string;
    windowSize?: [number, number]; pixelRatio?: number;
    input?: CommentDeviceInput; colorScheme?: CommentColorScheme; reducedMotion?: boolean; pageLanguage?: string;
    url?: string; text: string;
};

/** A comment as returned by the comments API (`CommentDto`) */
export type CommentActivity = { sequence: number; lastOtherSequence: number; readSequence: number; unread: boolean };

export type CommentItem = {
    /** Authorized member-only history; no raw actor, account or connector identifiers. */
    history?: { id: string; at: string; description: string }[];
    integrationLinks?: import('../../feedbackContext').ExternalFeedbackLink[];
    source?: { environment: string; label: string; origin?: string; available: boolean };
    notifications?: { member: boolean; eligible: boolean; following: boolean; verified: boolean; pending: boolean; muted: boolean };
    activity?: CommentActivity;
    id: string;
    /** The page key: comments on `/plans` and `/plans/` share it */
    path: string;
    /** The page as it was addressed when that is not `path` (`/plans/`): where links open */
    sourcePath?: string;
    position: CommentItemPosition;
    anchorContext?: { original: CommentItemPosition; previous: CommentItemPosition; revision: string; changedAt: string; changes: number };
    /** Public id, numbered per site (`#12`); missing on old comments */
    number?: number;
    /** A screenshot of the commented part of the page, in pixels (the image is fetched separately) */
    screenshot?: { width: number; height: number; revision?: string };
    /** `feedback` and `bug` have a `page` position */
    kind: CommentKind;
    feedbackType?: import('../../feedbackTypes').FeedbackTypeSnapshot;
    /** The page check it was posted from (the Accessibility and SEO panels); missing on every other comment */
    check?: import('../../feedbackTypes').CommentCheck;
    /** Shapes drawn on the page with it (canvas mode), from its area's top-left corner; only on an area */
    drawing?: import('../../drawing').CommentDrawing;
    thread: CommentItemThread;
    /** The coarse device size and the viewport (width, height) it was left from */
    device?: { size?: CommentDeviceSize; windowSize?: [number, number] };
    /** Detailed, safe reproduction fields returned only to authorized project members. */
    reproduction?: CommentReproduction;
    priority?: import('../../triage').CommentPriority;
    verification?: import('../../verification').VerificationDetails;
    verificationPermissions?: import('../../verification').VerificationPermissions;
    archivedAt?: string;
    resolved: boolean;
    /** In progress, only when set; `feedbackStage` (`../../verification`) gives the status */
    inProgress?: boolean;
    /**
     * Whether the current visitor wrote this comment (only the author can resolve or delete it).
     * Always `false` once the author deleted the first item.
     */
    isMine: boolean;
    createdAt?: string;
    /**
     * Project comments: what the reviewer may do. Members can mark any comment done; the author
     * and the workspace admins can delete it. Without it, only the author can (`isMine`).
     */
    permissions?: { resolve: boolean; delete: boolean; edit?: boolean; assign?: boolean; priority?: boolean };
    /** Project comments: only workspace admins and the author see it */
    private?: boolean;
    /** `agent`: the AI agent working under the assignee (members only) */
    assignee?: CommentAssignee;
    assignees?: CommentAssignee[];
    /** Shown before the API saved it (an optimistic comment with a temporary id, see hooks/useComments.tsx) */
    pending?: boolean;
}

/** A comment being written: device context and screenshot start with the draft. */
export type CommentDraft = {
    device?: CommentDeviceInfo;
    position: CommentAnchor;
    /**
     * A rewrite suggestion for the selected text, instead of a comment; `drawing`, a comment with the
     * shapes drawn in canvas mode (its own draft, posted as a comment)
     */
    kind?: 'comment' | 'rewrite' | 'drawing';
    /** The shapes drawn in canvas mode, from the area's top-left corner (kept in memory, like the capture) */
    drawing?: import('../../drawing').CommentDrawing;
    /** Started when the feedback began; retained through collapse and awaited before posting. */
    screenshot?: Promise<string | undefined>;
    /** The reviewer chose to send only the text (kept in memory, like the capture) */
    omitScreenshot?: boolean;
    /** The reviewer's own image, sent instead of the screenshot (kept in memory, never in draft storage) */
    image?: { name: string; dataUrl: string };
    /** Why it was not posted: the draft is back on the page with its text (see CommentComposer) */
    sendError?: unknown;
}

export type CommentsGlobalProps = {
    mode: ToolbarMode;
    /** The review this page is part of (`review` mode, see review.ts) */
    review?: ReviewSession | null;
    rootElement?: HTMLElement;
    /** Ends the review and removes the toolbar from the page (`review` mode only) */
    onExitReview?: () => void;
}

export type CommentAssignee = { id?: string; name: string; isMe: boolean; unavailable: boolean; agent?: import('../../agents').AssigneeAgentView; agents?: import('../../agents').AssigneeAgentView[] };
