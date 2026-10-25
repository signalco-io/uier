import { toolbarConfig } from '../config';

// The reviewer of a project (toolbar with `data-uier-project`), kept in the reviewed site's local
// storage: the review token of a signed-in member, or a random visitor id and the name of a guest.
// Headers, not cookies: the API is on another site (uier.io), where cookies would be third-party.
// (The review session itself, which pages show the toolbar, is review.ts.)

/** Single-use code from a project's review link, exchanged for a review token (apps/web/src/lib/app/review.ts) */
export const reviewTokenParam = 'uier-token';

const reviewTokenKey = (project: string) => `uier:review-token:${project}`;
const visitorKey = 'uier:visitor';
const guestNameKey = 'uier:guest-name';
const pendingCodeKey = `uier:review-code:v1:${toolbarConfig.apiUrl}:${toolbarConfig.project}`;
const signInDisabledKey = `uier:auto-sign-in-disabled:${toolbarConfig.apiUrl}:${toolbarConfig.project}`;

function read(key: string) {
    try {
        return window.localStorage.getItem(key) ?? undefined;
    } catch {
        return undefined;
    }
}

function write(key: string, value: string | undefined) {
    try {
        if (value === undefined) {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, value);
        }
    } catch {
        // Storage blocked: the value lives as long as the page
    }
}

const memory = new Map<string, string>();

function readKey(key: string) {
    return read(key) ?? memory.get(key);
}

function writeKey(key: string, value: string | undefined) {
    if (value === undefined) {
        memory.delete(key);
    } else {
        memory.set(key, value);
    }
    write(key, value);
}

/** Reads a query parameter once and removes it from the address bar (and from history) */
function takeUrlParam(name: string) {
    const url = new URL(window.location.href);
    const value = url.searchParams.get(name);
    if (value !== null) {
        url.searchParams.delete(name);
        window.history.replaceState(window.history.state, '', url.toString());
    }
    return value ?? undefined;
}

// Read while the script runs, before the page's own router can rewrite the URL
const initialReviewCode = toolbarConfig.project ? new URL(window.location.href).searchParams.get(reviewTokenParam) : undefined;
if (initialReviewCode && /^[A-Za-z0-9_-]{43}$/.test(initialReviewCode)) {
    // Persist before removing it: a host's own SSO redirect can unload this page during verification.
    try { window.sessionStorage.setItem(pendingCodeKey, JSON.stringify({ code: initialReviewCode, expiresAt: Date.now() + 10 * 60_000 })); } catch { /* Memory fallback below. */ }
}
if (toolbarConfig.project) takeUrlParam(reviewTokenParam);

/** The single-use code of the review link this page was opened with (once) */
export function consumeReviewCode() {
    try {
        const pending = JSON.parse(window.sessionStorage.getItem(pendingCodeKey) ?? 'null');
        if (pending && typeof pending.code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(pending.code) && pending.expiresAt > Date.now()) return pending.code as string;
        window.sessionStorage.removeItem(pendingCodeKey);
    } catch { /* Blocked storage: use this page's code. */ }
    return initialReviewCode ?? undefined;
}

export function clearReviewCode() {
    try { window.sessionStorage.removeItem(pendingCodeKey); } catch { /* No stored handoff. */ }
}

export const backgroundSignInDisabled = () => readKey(signInDisabledKey) === '1';

/** Only a successfully exchanged, authenticated link overrides toolbar sign-out. */
export function enableBackgroundSignIn() {
    writeKey(signInDisabledKey, undefined);
}

export function getReviewToken() {
    return toolbarConfig.project ? readKey(reviewTokenKey(toolbarConfig.project)) : undefined;
}

export function setReviewToken(token: string | undefined) {
    if (toolbarConfig.project) {
        writeKey(reviewTokenKey(toolbarConfig.project), token);
    }
}

/** A random visitor id (32 bytes, base64url), created on first use */
export function getVisitorToken(persist = Boolean(toolbarConfig.project)) {
    let token = readKey(visitorKey);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        memory.set(visitorKey, token);
    }
    if (persist) writeKey(visitorKey, token);
    return token;
}

/** Signs the reviewer out of the project on this site: the review token, guest name and visitor id go */
export function forgetProjectReviewer() {
    setReviewToken(undefined);
    clearReviewCode();
    if (toolbarConfig.project) writeKey(signInDisabledKey, '1');
    writeKey(guestNameKey, undefined);
    writeKey(visitorKey, undefined);
}

export function getGuestName() {
    return readKey(guestNameKey)?.trim() || undefined;
}

export function setGuestName(name: string) {
    writeKey(guestNameKey, name.trim());
}

/** Headers that identify the reviewer to the review API */
export function projectHeaders(): Record<string, string> {
    const token = getReviewToken();
    return token
        ? { Authorization: `Bearer ${token}`, 'X-Uier-Visitor': getVisitorToken() }
        : { 'X-Uier-Visitor': getVisitorToken() };
}
