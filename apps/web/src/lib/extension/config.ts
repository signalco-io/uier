export function extensionClientIds() {
    return (process.env.UIER_EXTENSION_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(s => /^[a-p]{32}$/.test(s));
}
