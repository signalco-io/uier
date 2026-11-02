import { test, expect } from '@playwright/test';
import { extensionDistribution } from '../src/lib/extension/distribution';

test('extension installation requires an enabled and registered production store item', () => {
    const id = 'a'.repeat(32);
    for (const env of [{}, { UIER_EXTENSION_AVAILABLE: '1' },
        { UIER_EXTENSION_AVAILABLE: '1', UIER_EXTENSION_STORE_ID: 'https://example.test' },
        { UIER_EXTENSION_AVAILABLE: '1', UIER_EXTENSION_STORE_ID: id },
        { UIER_EXTENSION_AVAILABLE: '0', UIER_EXTENSION_STORE_ID: id, UIER_EXTENSION_CLIENT_IDS: id }]) {
        expect(extensionDistribution(env)).toEqual({ available: false, storeUrl: undefined });
    }
    expect(extensionDistribution({ UIER_EXTENSION_AVAILABLE: '1', UIER_EXTENSION_STORE_ID: id, UIER_EXTENSION_CLIENT_IDS: ` ${id},${'b'.repeat(32)}` }))
        .toEqual({ available: true, storeUrl: `https://chromewebstore.google.com/detail/uier/${id}` });
});
