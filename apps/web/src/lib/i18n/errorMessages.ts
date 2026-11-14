/** Service errors keep their existing English API contract. UI presentation translates known templates. */
const templates = [
    'Use at most {count} characters.',
    'Use at most {count} characters for the review brief.',
    'Use at most {count} characters for the client name.',
    'Use at most {count} characters for the description.',
    'A project can have up to {count} addresses.',
    'A project can have up to {count} links.',
    'A workspace can have up to {count} active teams.',
    'You can create up to {count} workspaces.',
    'You can add up to {count} passkeys. Remove one first.',
    'A workspace can have up to {count} domains.',
    '"{address}" is not a website address.',
    '{domain} is already added.',
    '{domain} was removed. Refresh the page.',
    '{email} is already in this workspace.',
    "{domain} is a public email provider: anyone can have an address there. Add your organization's own domain.",
    'To add {domain}, sign in with an email address at {domain}. You can add only the domain of your own email.'
];
const patterns = templates.map(message => {
    const names: string[] = [];
    const pieces = message.split(/(\{[a-z]+\})/g).map(piece => {
        if (/^\{[a-z]+\}$/.test(piece)) {
            names.push(piece.slice(1, -1));
            return '(.+?)';
        }
        return piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    return { message, names, pattern: new RegExp(`^${pieces.join('')}$`) };
});

export function appErrorMessage(source: string): { message: string; values: Record<string, string> } | undefined {
    for (const { message, names, pattern } of patterns) {
        const match = pattern.exec(source);
        if (match) return { message, values: Object.fromEntries(names.map((name, index) => [name, match[index + 1]!])) };
    }
    return undefined;
}
