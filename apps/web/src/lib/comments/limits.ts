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
export const MAX_THREAD_ITEMS = 50;

/** Maximum number of comments returned by GET /api/comments */
export const MAX_LIST_COMMENTS = 200;
/** Maximum size of a GET /api/comments response (the newest comments that fit are returned) */
export const MAX_LIST_RESPONSE_BYTES = 1_000_000;

/**
 * Rate limits: fixed windows counted with atomic counters (one small document per subject and
 * window, see rateLimits.ts). Per IP means per IPv4 address or per IPv6 /64.
 */
export const RATE_LIMIT_WINDOW_SECONDS = HOUR;
export const RATE_LIMIT_VISITOR_COMMENTS = 10;
export const RATE_LIMIT_VISITOR_REPLIES = 30;
export const RATE_LIMIT_IP_WRITES = 30;
/** New comments on a single page (domain + path) per day, so a burst can't fill the page */
export const PAGE_COMMENTS_WINDOW_SECONDS = DAY;
export const RATE_LIMIT_PAGE_COMMENTS = 100;

/** Rewrite suggestions (an AI model call each): per visitor and IP per hour, per domain per day */
export const RATE_LIMIT_VISITOR_REWRITES = 20;
export const RATE_LIMIT_IP_REWRITES = 40;
export const DOMAIN_REWRITES_WINDOW_SECONDS = DAY;
export const RATE_LIMIT_DOMAIN_REWRITES = 300;
/** Longest instruction a reviewer can give with a rewrite request */
export const MAX_REWRITE_INSTRUCTION_LENGTH = 300;

/** Retention of anonymous comments (Cosmos DB per-item TTL, counted from the last modification) */
export const COMMENT_TTL_SECONDS = 90 * DAY;
/** Retention in the `comments-preview` container (its default TTL; a per-item ttl would override it) */
export const PREVIEW_COMMENT_TTL_SECONDS = 7 * DAY;

/** Visitor identity cookie */
export const VISITOR_COOKIE_NAME = 'uier_visitor';
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 365 * DAY;
export const VISITOR_TOKEN_BYTES = 32;
