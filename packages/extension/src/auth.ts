import { browser, browserKind } from './browser';

export function redirectURL() {
    return browserKind === 'firefox' ? browser.identity.getRedirectURL() : browser.identity.getRedirectURL('uier');
}

export function launchAuth(url: string): Promise<string | undefined> {
    return browser.identity.launchWebAuthFlow({ url, interactive: true });
}
