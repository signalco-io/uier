import { Button } from '@signalco/ui-primitives/Button';
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
    description: `Review your project’s sites without adding the ${brand.name} script. ${firefoxExtensionRelease.availabilityMessage}`
} satisfies PageCard;

/** The Chrome Web Store listing, labelled like the app's store link */
export function ExtensionStoreButton() {
    return <Button variant="solid" size="lg" href={extensionStoreUrl}>{extensionRelease.storeLabel}</Button>;
}

export function FirefoxExtensionNotice() {
    return <p className="text-sm leading-relaxed text-muted-foreground">{firefoxExtensionRelease.availabilityMessage}</p>;
}
