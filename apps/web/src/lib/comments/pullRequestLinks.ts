/** Browser-safe recognition only. Never fetch a URL taken from a message. */
export type PullRequestLink = {
    provider: 'github' | 'gitlab' | 'azure-devops';
    url: string;
    repository: string;
    number: number;
    organization?: string;
    project?: string;
};
export type PullRequestState = 'open' | 'merged' | 'closed' | 'draft';
export type PullRequestStatus = { url: string; state?: PullRequestState };

const segment = (value: string) => value.length <= 200 && !/[\p{Cc}\p{Cf}/\\?#]/u.test(value) && value !== '.' && value !== '..' && Boolean(value);
const number = (value: string) => /^[1-9]\d{0,9}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
const encode = encodeURIComponent;

export function parsePullRequestLink(value: string): PullRequestLink | undefined {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.port) return;
        if (url.username || url.password) return;
        const parts = url.pathname.split('/').slice(1).map(decodeURIComponent);
        const host = url.hostname.toLowerCase();
        if (host === 'github.com') {
            const [owner, repo, kind, id] = parts;
            if (!owner || !repo || kind !== 'pull' || !id || !number(id)
                || !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || !segment(repo)) return;
            return { provider: 'github', repository: `${owner}/${repo}`, number: number(id)!, url: `https://github.com/${owner}/${repo}/pull/${id}` };
        }
        if (host === 'gitlab.com') {
            const at = parts.indexOf('-');
            const repository = parts.slice(0, at);
            const id = parts[at + 2];
            if (at < 2 || parts[at + 1] !== 'merge_requests' || !id || !number(id) || !repository.every(segment)) return;
            return { provider: 'gitlab', repository: repository.join('/'), number: number(id)!,
                url: `https://gitlab.com/${repository.map(encode).join('/')}/-/merge_requests/${id}` };
        }
        const legacy = /^([a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?)\.visualstudio\.com$/.exec(host);
        const [organization, project, git, repository, kind, id] = host === 'dev.azure.com' ? parts : legacy ? [legacy[1]!, ...parts] : [];
        if (!organization || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/.test(organization)
            || !project || !segment(project) || git !== '_git' || !repository || !segment(repository) || kind !== 'pullrequest' || !id || !number(id)) return;
        return { provider: 'azure-devops', organization, project, repository, number: number(id)!,
            url: `https://dev.azure.com/${encode(organization)}/${encode(project)}/_git/${encode(repository)}/pullrequest/${id}` };
    } catch { return; }
}

/** Scan current messages, including Markdown destinations, autolinks and bare URLs. Deleted text contributes nothing. */
export function threadPullRequestLinks(messages: readonly { text: string; deleted?: boolean; deletedAt?: string }[], attached: readonly { url: string }[] = []) {
    const links = new Map<string, PullRequestLink>();
    for (const message of messages) {
        if (message.deleted || message.deletedAt) continue;
        for (const match of message.text.matchAll(/https:\/\/[^\s<>"'`\[\]()]+/gi)) {
            const link = parsePullRequestLink(match[0].replace(/[.,;:!?]+$/, ''));
            if (link) links.set(link.url.toLowerCase(), link);
        }
    }
    for (const saved of attached) {
        const link = parsePullRequestLink(saved.url);
        if (link) links.set(link.url.toLowerCase(), link);
    }
    return [...links.values()];
}
