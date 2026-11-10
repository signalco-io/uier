import { useEffect, useSyncExternalStore } from 'react';
import { defaultToolbarLanguage, readToolbarLanguage, readToolbarLanguageInfo, resolveToolbarLanguage, type ToolbarLanguage, type ToolbarLanguageInfo } from '../languages';
import { en, type Messages } from './en';
import type { LazyMessages } from './lazy/en';
import type { LanguageAsset } from './languageHandoff';
import { loadLanguageAsset } from './load';

// The toolbar's language (docs/localization.md). One store for the page: the main root, inline threads
// and helpers outside React read the same language. Catalogs are typed against English (`Messages`), so a
// language missing a string does not build. English is part of the review bundle; another language
// shows once its asset loaded (`load.ts`), and until then, or when it can not load, the toolbar stays in
// the language it showed.

/** The languages loaded so far, besides English */
const loaded: Partial<Record<ToolbarLanguage, LanguageAsset>> = {};
const loading = new Map<ToolbarLanguage, Promise<void>>();

/** A guest's choice, kept per browser and site like the shortcuts switch (`uier:shortcuts-off`) */
export const languageStorageKey = 'uier:toolbar-language';

/** The project's (or uier's) language and a signed-in account's own choice, from the API */
let server: ToolbarLanguageInfo | undefined;
/** A guest's choice in this browser; a signed-in account's choice is `server.preference` */
let local: ToolbarLanguage | undefined;
let localRead = false;
/** The language the toolbar shows */
let current: ToolbarLanguage = defaultToolbarLanguage;
/** The language it should show: the same, or one that is loading or could not load */
let wanted: ToolbarLanguage = defaultToolbarLanguage;
let started = false;
const listeners = new Set<() => void>();

function storage() {
    try {
        return globalThis.localStorage as Storage | undefined;
    } catch {
        return undefined;
    }
}

function readLocal() {
    if (localRead) return local;
    localRead = true;
    try {
        local = readToolbarLanguage(storage()?.getItem(languageStorageKey));
    } catch {
        local = undefined;
    }
    return local;
}

/** Whether the API says a signed-in account is reviewing (it then carries the account's choice) */
function signedIn(info: ToolbarLanguageInfo | undefined): info is ToolbarLanguageInfo & { preference: ToolbarLanguage | null } {
    return Boolean(info && 'preference' in info);
}

const available = (language: ToolbarLanguage) => language === 'en' || Boolean(loaded[language]);

/** Which language the toolbar should show; shows it at once when it is loaded, else loads it */
function resolve() {
    const preference = signedIn(server) ? server.preference : readLocal();
    wanted = resolveToolbarLanguage(preference, server);
    if (available(wanted)) current = wanted;
    else void load(wanted);
}

function update() {
    started = true;
    resolve();
    notify();
}

/** The first read: a guest's choice in this browser starts loading before the API answers */
function start() {
    if (started) return;
    started = true;
    resolve();
}

/** Loads a language once (again after a failure), and shows it if it is still the one wanted */
function load(language: ToolbarLanguage): Promise<void> {
    let attempt = loading.get(language);
    if (!attempt) {
        attempt = loadLanguageAsset(language).then(
            asset => { loaded[language] = asset; },
            () => { loading.delete(language); }
        );
        loading.set(language, attempt);
    }
    return attempt.then(() => {
        if (wanted === language && available(language) && current !== language) current = language;
        // Shown, or still English (or the previous language) after a failure: Options says which
        notify();
    });
}

/**
 * Resolves once the language the toolbar should show is ready, or could not load, at most after `wait`
 * milliseconds: a project's toolbar waits for it before it renders, so it does not change language
 * under the reviewer.
 */
export function languageReady(wait = 4000): Promise<void> {
    start();
    if (available(wanted)) return Promise.resolve();
    return Promise.race([load(wanted), new Promise<void>(done => setTimeout(done, wait))]);
}

let snapshot: LanguageState | undefined;
function notify() {
    snapshot = undefined;
    for (const listener of listeners) listener();
}

export function subscribeLanguage(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** The language the toolbar shows now */
export function toolbarLanguage(): ToolbarLanguage {
    start();
    return current;
}

/** The current language's strings, for code outside React (announcements, errors built in hooks) */
export function messages(): Messages {
    const language = toolbarLanguage();
    return language === 'en' ? en : loaded[language]?.messages ?? en;
}

/** The on-demand checks' strings in the current language, handed to the audit asset (English: its own) */
export function checkMessages(): LazyMessages | undefined {
    const language = toolbarLanguage();
    return language === 'en' ? undefined : loaded[language]?.checks;
}

/**
 * What the API said about the language (`GET /api/review/<project>` or `GET /api/visitor`): checked, since
 * an older API sends none (English then). Called as the response arrives, before the toolbar renders it.
 */
export function applyLanguageInfo(info: unknown) {
    server = readToolbarLanguageInfo(info);
    update();
}

/** Tries the chosen language again after it could not load */
export function retryLanguage() {
    update();
}

/** The reviewer signed out: their account's choice no longer applies, a guest choice in this browser does */
export function forgetAccountLanguage() {
    if (!server) return;
    const { preference: _preference, ...rest } = server;
    server = rest;
    update();
}

/**
 * The person's own choice (`null`: the default again). A guest's is kept in this browser; a signed-in
 * account's shows at once and is saved by the caller (`useLanguageChoice`), which calls this again with the
 * previous choice when saving fails.
 */
export function setLanguagePreference(language: ToolbarLanguage | null) {
    if (signedIn(server)) {
        server = { ...server, preference: language };
    } else {
        local = language ?? undefined;
        localRead = true;
        try {
            if (language) storage()?.setItem(languageStorageKey, language);
            else storage()?.removeItem(languageStorageKey);
        } catch {
            // Not remembered: the choice lasts for this page
        }
    }
    update();
}

export type LanguageState = {
    /** The language shown */
    language: ToolbarLanguage;
    /** The language chosen, when it is not shown yet: loading, or it could not load (`failed`) */
    pending: ToolbarLanguage | undefined;
    failed: boolean;
    /** The project's (or workspace's) language: what Use default goes back to */
    defaultLanguage: ToolbarLanguage;
    source: ToolbarLanguageInfo['source'];
    /** The person's own choice, `null` without one */
    preference: ToolbarLanguage | null;
    /** A signed-in account: the choice is saved to it, not to this browser */
    account: boolean;
};

function state(): LanguageState {
    const language = toolbarLanguage();
    snapshot ??= {
        language,
        pending: wanted === language ? undefined : wanted,
        failed: wanted !== language && !loading.has(wanted),
        defaultLanguage: server?.default ?? defaultToolbarLanguage,
        source: server?.source ?? 'default',
        preference: signedIn(server) ? server.preference : readLocal() ?? null,
        account: signedIn(server)
    };
    return snapshot;
}

/** The language, its default and the person's choice, for Options */
export function useLanguageState() {
    return useSyncExternalStore(subscribeLanguage, state, state);
}

/** The current language's strings; components re-render when it changes */
export function useMessages(): Messages {
    return useSyncExternalStore(subscribeLanguage, messages, messages);
}

/** The current language code, for `lang` attributes and `Intl` formats */
export function useToolbarLanguage(): ToolbarLanguage {
    return useSyncExternalStore(subscribeLanguage, toolbarLanguage, toolbarLanguage);
}

/** Names the language of an element the toolbar renders into (its root, an inline thread's), for screen readers and hyphenation */
export function useLangAttribute(element: HTMLElement | null | undefined) {
    const language = useToolbarLanguage();
    useEffect(() => {
        if (element) element.lang = language;
    }, [element, language]);
}

export type { Messages } from './en';
