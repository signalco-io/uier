import { expect, test } from '@playwright/test';
import { KnownPages } from '../src/knownPages';
import { extensionDistribution } from '../src/lib/extension/distribution';
import { extensionRelease, extensionStoreUrl } from '../src/lib/extension/release';
import { guides } from '../src/lib/guides';

// The browser extension pages (#308) link the published store item. seo.api.spec.ts and
// social-cards.api.spec.ts check them with the other public pages; browser-extension.spec.ts checks content.

test('browser extension pages link the store item the app links', async ({ request }) => {
    const id = extensionRelease.storeId;
    expect(id).toMatch(/^[a-p]{32}$/);
    // The app's store link for the same ID (hosted UIER_EXTENSION_STORE_ID)
    const app = extensionDistribution({ UIER_EXTENSION_AVAILABLE: '1', UIER_EXTENSION_STORE_ID: id, UIER_EXTENSION_CLIENT_IDS: id });
    expect(extensionStoreUrl).toBe(app.storeUrl);
    for (const path of [KnownPages.BrowserExtension, guides.browserExtension.path]) {
        const response = await request.get(path);
        expect(response.status(), path).toBe(200);
        expect(await response.text(), path).toContain(`href="${extensionStoreUrl}"`);
    }
});
