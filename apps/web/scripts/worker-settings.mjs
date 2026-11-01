const providers = ['NOTION', 'LINEAR', 'SLACK', 'AZURE_DEVOPS'];
export const workerSettingNames = new Set([
    'COSMOSDB_ENDPOINT', 'AZURE_SCREENSHOTS_ENDPOINT', 'UIER_COMMENTS_SECRET',
    'ACS_CONNECTION_STRING', 'UIER_EMAIL_SENDER',
    ...providers.flatMap(name => [`${name}_CLIENT_ID`, `${name}_CLIENT_SECRET`]),
    'SLACK_APP_ID', 'SLACK_DISTRIBUTION_APPROVED', 'AZURE_DEVOPS_TENANT',
    'UIER_GITHUB_APP_ID', 'UIER_GITHUB_APP_SLUG', 'UIER_GITHUB_CLIENT_ID', 'UIER_GITHUB_CLIENT_SECRET',
    'UIER_GITHUB_PRIVATE_KEY', 'UIER_GITHUB_WEBHOOK_SECRET',
    ...['NOTION_TOKEN_KEY', 'LINEAR_TOKEN_KEY', 'SLACK_TOKEN_KEY', 'AZURE_DEVOPS_TOKEN_KEY', 'UIER_GITHUB_SETUP_KEY']
        .flatMap(name => [name, `${name}_ID`, `${name}_PREVIOUS`, `${name}_PREVIOUS_ID`]),
]);

export function parseWorkerSettings(encoded) {
    if (typeof encoded !== 'string' || !encoded || Buffer.byteLength(encoded) > 48_000)
        throw new Error('The worker requires a bounded settings map.');
    let parsed;
    try { parsed = JSON.parse(encoded); } catch { throw new Error('Invalid worker settings map.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid worker settings map.');
    for (const [name, value] of Object.entries(parsed)) {
        if (!workerSettingNames.has(name) || typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 16_384)
            throw new Error('Invalid worker setting.');
    }
    for (const name of ['COSMOSDB_ENDPOINT', 'AZURE_SCREENSHOTS_ENDPOINT', 'UIER_COMMENTS_SECRET'])
        if (!parsed[name]) throw new Error('A required worker setting is missing.');
    return parsed;
}

export function loadWorkerSettings(encoded, environment = process.env, write = value => process.stdout.write(value)) {
    const values = parseWorkerSettings(encoded);
    if (environment.GITHUB_ACTIONS === 'true') {
        for (const value of Object.values(values))
            write(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}\n`);
    }
    Object.assign(environment, values);
    delete environment.UIER_WORKER_SETTINGS;
    return values;
}
