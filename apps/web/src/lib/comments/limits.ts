// All limits of the public (anonymous) comments API in one place.

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Maximum accepted request body size in bytes (larger bodies are rejected with 413). */
export const MAX_BODY_BYTES = 16 * 1024;

/** Validation limits */
export const MAX_TEXT_LENGTH = 1000;
export const MAX_QUOTED_TEXT_LENGTH = 1000;
export const MAX_PATH_LENGTH = 512;
export const MAX_SELECTOR_LENGTH = 1024;
export const MAX_SELECTION_TEXT_LENGTH = 2000;
export const MAX_SELECTION_OFFSET = 100_000;
export const MAX_WINDOW_DIMENSION = 20_000;
export const MAX_PIXEL_RATIO = 10;
export const MAX_DEVICE_LABEL_LENGTH = 64;
export const MAX_THREAD_ITEMS = 100;

/** Maximum number of comments returned by GET /api/comments */
export const MAX_LIST_COMMENTS = 200;

/** Rate limits (sliding window, counted from stored documents/thread items by `createdAt`) */
export const RATE_LIMIT_WINDOW_SECONDS = HOUR;
export const RATE_LIMIT_VISITOR_COMMENTS = 10;
export const RATE_LIMIT_VISITOR_REPLIES = 30;
export const RATE_LIMIT_IP_WRITES = 30;
/** Maximum number of unresolved comments on a single page (domain + path) */
export const MAX_UNRESOLVED_COMMENTS_PER_PAGE = 300;
/** `Retry-After` for a full page - it frees up only when comments are resolved, deleted or expire */
export const PAGE_FULL_RETRY_AFTER_SECONDS = HOUR;

/** Retention of anonymous comments (Cosmos DB per-item TTL, counted from the last modification) */
export const COMMENT_TTL_SECONDS = 90 * DAY;
/** Retention on preview deployments (matches the `comments-preview` container default TTL) */
export const PREVIEW_COMMENT_TTL_SECONDS = 7 * DAY;

/** Visitor identity cookie */
export const VISITOR_COOKIE_NAME = 'uier_visitor';
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 365 * DAY;
export const VISITOR_TOKEN_BYTES = 32;
