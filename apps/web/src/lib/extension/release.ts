import { chromeWebStoreUrl } from './distribution';

/**
 * The published desktop browser extension (#268) as its public pages describe it: /browser-extension
 * and /guides/browser-extension (#308). Recheck them against apps/extension and the receipts in
 * docs/browser-extension.md when a release changes labels, permissions, sign-in or capture.
 */
export const extensionRelease = {
    /**
     * The published Chrome Web Store item. The app reads the same ID from hosted
     * `UIER_EXTENSION_STORE_ID` at request time (`extensionDistribution()`); the public pages are
     * static and deploys build without hosted settings, so they name it here.
     */
    storeId: 'kplfcfnpeljpkbcjgpaefpmggipfpemj',
    /** Labels in the extension popup (apps/extension/src/popup.tsx) */
    labels: {
        signIn: 'Sign in to uier',
        start: 'Start review',
        exit: 'Exit review',
        signOut: 'Sign out',
        setup: 'Open project setup',
        retry: 'Try again'
    },
    /** The toolbar's control that sends one comment without its automatic screenshot (ComposerAttachmentsHeader) */
    omitScreenshot: 'Omit screenshot',
    /** The suggested shortcut that opens the popup (`commands` in apps/extension/scripts/build.mjs) */
    shortcut: 'Alt+Shift+U',
    /** `minimum_chrome_version` of the manifest; Edge shares the Chromium version number */
    minimumBrowserVersion: 120
} as const;

/**
 * The newest extension version on main, equal to both browser packages: `pnpm -C apps/extension
 * release:version X.Y.Z` sets all three and the API test compares them. `GET /api/extension/version`
 * reports it.
 * The store can be behind while a submission is in review: the extension asks the browser for
 * the update and offers a restart only once it is downloaded (packages/extension/src/update.ts).
 */
export const latestExtensionVersion = '0.1.5';

/** The store listing, the same address as the app's store link */
export const extensionStoreUrl = chromeWebStoreUrl(extensionRelease.storeId);
