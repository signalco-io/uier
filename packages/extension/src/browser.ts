// Firefox exposes Promise APIs through browser.*, while Chromium also supports them on chrome.*.
// Keep the native extension ID for sender validation, separate from Safari's registered client ID.
declare const __EXTENSION_BROWSER__: 'chrome' | 'firefox' | 'safari';
export const browserKind = __EXTENSION_BROWSER__;
export const browser = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
export const clientId = browserKind === 'safari' ? 'io.uier.safari.Extension' : browser.runtime.id;
export function extensionOrigin() {
    const url = new URL(browser.runtime.getURL(''));
    return `${url.protocol}//${url.host}`;
}
