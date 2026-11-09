// Firefox exposes Promise APIs through browser.*, while Chromium also supports them on chrome.*.
declare const __EXTENSION_BROWSER__: 'chrome' | 'firefox';
export const browserKind = __EXTENSION_BROWSER__;
export const browser = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
export const clientId = browser.runtime.id;
export function extensionOrigin() {
    const url = new URL(browser.runtime.getURL(''));
    return `${url.protocol}//${url.host}`;
}
