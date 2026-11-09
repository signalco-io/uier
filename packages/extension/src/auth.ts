import { browser, browserKind } from './browser';

export function redirectURL(apiOrigin: string) {
    if (browserKind === 'safari') return `${apiOrigin}/extension-callback`;
    return browserKind === 'firefox' ? browser.identity.getRedirectURL() : browser.identity.getRedirectURL('uier');
}

// Safari has no identity API. Observe only the tab we create and only our first-party callback.
// Host permission for the API allows reading that URL without requesting the tabs permission.
export function launchAuth(url: string, redirectUri: string): Promise<string | undefined> {
    if (browserKind !== 'safari') return browser.identity.launchWebAuthFlow({ url, interactive: true });
    return new Promise((resolve, reject) => {
        let tabId: number | undefined;
        let finished = false;
        const finish = (value?: string, error?: Error) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            browser.tabs.onUpdated.removeListener(updated);
            browser.tabs.onRemoved.removeListener(removed);
            if (tabId !== undefined) void browser.tabs.remove(tabId).catch(() => {});
            if (error) reject(error); else resolve(value);
        };
        const check = (id: number, candidate?: string) => {
            if (id !== tabId || !candidate) return;
            try {
                const callback = new URL(candidate);
                if (`${callback.origin}${callback.pathname}` === redirectUri) finish(candidate);
            } catch { /* Ignore unrelated or incomplete navigation. */ }
        };
        const updated = (id: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => check(id, change.url ?? tab.url);
        const removed = (id: number) => { if (id === tabId) finish(); };
        const timeout = setTimeout(() => finish(undefined, new Error('Sign-in timed out. Try again.')), 5 * 60_000);
        browser.tabs.onUpdated.addListener(updated);
        browser.tabs.onRemoved.addListener(removed);
        void browser.tabs.create({ url, active: true }).then(async tab => {
            tabId = tab.id;
            if (tabId === undefined) { finish(undefined, new Error('Sign-in could not open.')); return; }
            if (finished) { await browser.tabs.remove(tabId).catch(() => {}); return; }
            check(tabId, (await browser.tabs.get(tabId)).url);
        }).catch(error => finish(undefined, error));
    });
}
