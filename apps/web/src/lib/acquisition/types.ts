export const channels = ['organic_search', 'ai_search', 'social', 'referral', 'campaign', 'direct', 'unknown'] as const;
export const sources = ['google', 'bing', 'duckduckgo', 'chatgpt', 'copilot', 'perplexity', 'claude', 'github', 'linkedin', 'x', 'other', 'direct', 'unknown'] as const;
export type Attribution = { channel: typeof channels[number]; source: typeof sources[number] };
export const stages = ['sign_in', 'first_project', 'first_review'] as const;
export type AcquisitionStage = typeof stages[number];
export type AcquisitionState = {
    version: 1;
    attribution?: Attribution;
    milestones: Partial<Record<AcquisitionStage, string>>;
    delivered: AcquisitionStage[];
};
export type AcquisitionEvent = Attribution & { stage: AcquisitionStage };

export function allowsAnalytics(preferences: { doNotTrack?: string | null; globalPrivacyControl?: boolean }) {
    return preferences.doNotTrack !== '1' && !preferences.globalPrivacyControl;
}

/** Carry only enum labels across the public → app document boundary. No cookie or storage. */
export function attributionLink(target: URL, attribution: Attribution) {
    const url = new URL(target);
    url.searchParams.set('acq_channel', attribution.channel);
    url.searchParams.set('acq_source', attribution.source);
    return url;
}

export function incomingAttribution(address: string, referrer: string): Attribution {
    const url = new URL(address);
    const app = url.pathname === '/app' || url.pathname.startsWith('/app/');
    if (!app) return classifyAttribution(address, referrer);
    const candidates = [url];
    const next = url.searchParams.get('next');
    if (next?.startsWith('/app')) {
        try {
            const target = new URL(next, url.origin);
            if (target.origin === url.origin) candidates.push(target);
        } catch { /* An invalid return address supplies no attribution. */ }
    }
    for (const candidate of candidates) {
        const channel = candidate.searchParams.get('acq_channel') as Attribution['channel'];
        const source = candidate.searchParams.get('acq_source') as Attribution['source'];
        if (channels.includes(channel) && sources.includes(source)) return { channel, source };
    }
    // OAuth/login referrers describe the sign-in provider, not how someone discovered uier.
    return { channel: 'unknown', source: 'unknown' };
}

const sourceHosts: [RegExp, Attribution][] = [
    [/(^|\.)google\.[a-z.]+$/, { channel: 'organic_search', source: 'google' }],
    [/(^|\.)bing\.com$/, { channel: 'organic_search', source: 'bing' }],
    [/(^|\.)duckduckgo\.com$/, { channel: 'organic_search', source: 'duckduckgo' }],
    [/(^|\.)(?:chatgpt\.com|chat\.openai\.com)$/, { channel: 'ai_search', source: 'chatgpt' }],
    [/(^|\.)(?:copilot\.microsoft\.com|copilot\.com)$/, { channel: 'ai_search', source: 'copilot' }],
    [/(^|\.)perplexity\.ai$/, { channel: 'ai_search', source: 'perplexity' }],
    [/(^|\.)claude\.ai$/, { channel: 'ai_search', source: 'claude' }],
    [/(^|\.)github\.com$/, { channel: 'social', source: 'github' }],
    [/(^|\.)linkedin\.com$/, { channel: 'social', source: 'linkedin' }],
    [/(^|\.)(?:x\.com|twitter\.com|t\.co)$/, { channel: 'social', source: 'x' }]
];

/** Returns labels only. Never returns a URL, arbitrary query value, or referrer path. */
export function classifyAttribution(address: string, referrer: string): Attribution {
    const url = new URL(address);
    const utm = url.searchParams.get('utm_source')?.toLowerCase();
    const known: Record<string, string> = {
        google: 'google.com', bing: 'bing.com', duckduckgo: 'duckduckgo.com',
        chatgpt: 'chatgpt.com', 'chatgpt.com': 'chatgpt.com', copilot: 'copilot.microsoft.com',
        perplexity: 'perplexity.ai', claude: 'claude.ai', github: 'github.com', linkedin: 'linkedin.com', twitter: 'x.com', x: 'x.com'
    };
    if (utm) {
        const match = sourceHosts.find(([pattern]) => pattern.test(known[utm] ?? ''));
        const attribution = match?.[1] ?? { channel: 'campaign', source: 'other' } as Attribution;
        const medium = url.searchParams.get('utm_medium')?.toLowerCase();
        return medium && !['organic', 'referral', 'social'].includes(medium)
            ? { channel: 'campaign', source: attribution.source } : attribution;
    }
    if (!referrer) return { channel: 'direct', source: 'direct' };
    try {
        const from = new URL(referrer);
        if (from.origin === url.origin) return { channel: 'direct', source: 'direct' };
        return sourceHosts.find(([pattern]) => pattern.test(from.hostname))?.[1] ?? { channel: 'referral', source: 'other' };
    } catch { return { channel: 'unknown', source: 'unknown' }; }
}

export function analyticsUrl(address: string) {
    const url = new URL(address);
    url.search = '';
    url.hash = '';
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) url.pathname = '/app';
    else if (url.pathname === '/notifications') url.pathname = '/notifications';
    return url.href;
}
