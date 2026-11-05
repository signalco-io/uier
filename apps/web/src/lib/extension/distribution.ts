/** The Chrome Web Store listing of the extension's store item */
export function chromeWebStoreUrl(id: string) {
    return `https://chromewebstore.google.com/detail/uier/${id}`;
}

/** Public installation is enabled only after an owner records the verified live store item. */
export function extensionDistribution(env: Record<string, string | undefined> = process.env) {
    const id = env.UIER_EXTENSION_STORE_ID;
    const registered = (env.UIER_EXTENSION_CLIENT_IDS ?? '').split(',').map(value => value.trim());
    const available = env.UIER_EXTENSION_AVAILABLE === '1' && typeof id === 'string' && /^[a-p]{32}$/.test(id) && registered.includes(id);
    return { available, storeUrl: available ? chromeWebStoreUrl(id!) : undefined };
}
