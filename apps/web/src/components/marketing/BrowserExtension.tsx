import { Button } from '@uier/ui-primitives/Button';
import { brand } from '@uier/brand';
import { KnownPages } from '../../knownPages';
import { extensionRelease, extensionStoreUrl, firefoxExtensionRelease } from '../../lib/extension/release';
import type { PageCard } from '../../lib/social/cards';

// Shared parts of the browser extension pages (/browser-extension, /guides/browser-extension)

/** The extension page's metadata and social card */
export const extensionPage = {
    path: KnownPages.BrowserExtension,
    section: 'Desktop browsers',
    title: 'Browser extension',
    description: `Review your project’s sites in Chrome, Edge or Firefox without adding the ${brand.name} script.`
} satisfies PageCard;

/** The Chrome Web Store listing, labelled like the app's store link */
export function ExtensionStoreButton() {
    return <Button variant="solid" size="lg" href={extensionStoreUrl}>{extensionRelease.storeLabel}</Button>;
}

export function FirefoxExtensionStoreButton() {
    return <Button variant="outlined" size="lg" href={firefoxExtensionRelease.storeUrl}>{firefoxExtensionRelease.storeLabel}</Button>;
}
