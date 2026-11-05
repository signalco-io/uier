import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { KnownPages } from '../../knownPages';
import { extensionStoreUrl } from '../../lib/extension/release';
import type { PageCard } from '../../lib/social/cards';

// Shared parts of the browser extension pages (/browser-extension, /guides/browser-extension)

/** The extension page's metadata and social card */
export const extensionPage = {
    path: KnownPages.BrowserExtension,
    section: 'Chrome and Edge',
    title: 'Browser extension',
    description: `Review your project’s sites in desktop Chrome or Edge without adding the ${brand.name} script or changing the site’s security headers.`
} satisfies PageCard;

/** The Chrome Web Store listing, labelled like the app's store link */
export function ExtensionStoreButton() {
    return <Button variant="solid" size="lg" href={extensionStoreUrl}>Get the browser extension</Button>;
}
