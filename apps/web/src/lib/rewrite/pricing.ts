/** Standard, global, synchronous Claude API USD / million tokens. Never an invoice. */
export const REWRITE_PRICING = {
    version: '2026-11-02.1',
    checkedOn: '2026-11-02',
    currency: 'USD',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    rates: {
        'claude-opus-5-5': { input: 4, output: 20, cache5m: 5, cache1h: 8, cacheRead: 0.2 },
        'claude-sonnet-5-5': { input: 2, output: 10, cache5m: 2.5, cache1h: 4, cacheRead: 0.1 },
    }
} as const;

/** Documented fallback id retained for diagnosis even without a qualified rate schedule. */
export const REWRITE_KNOWN_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-8'] as const;

export function knownModel(model: unknown): typeof REWRITE_KNOWN_MODELS[number] | 'unknown' {
    // Never copy an arbitrary provider string into a log (including error payloads).
    return REWRITE_KNOWN_MODELS.find(known => known === model) ?? 'unknown';
}

export type TokenUsage = {
    model: string;
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    cache5m: number | null;
    cache1h: number | null;
};

export function estimateTokens(usage: TokenUsage): number | null {
    if ([usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.cache5m, usage.cache1h]
        .some(value => value !== null && (!Number.isSafeInteger(value) || value < 0))) return null;
    if (!Object.hasOwn(REWRITE_PRICING.rates, usage.model)) return null;
    const rates = REWRITE_PRICING.rates[usage.model as keyof typeof REWRITE_PRICING.rates];
    if (!rates || usage.input === null || usage.output === null || usage.cacheRead === null || usage.cacheWrite === null)
        return null;
    // A zero aggregate needs no TTL breakdown. Never charge both aggregate and breakdown.
    if (usage.cacheWrite === 0 && ((usage.cache5m ?? 0) !== 0 || (usage.cache1h ?? 0) !== 0)) return null;
    const cache5m = usage.cacheWrite === 0 ? 0 : usage.cache5m;
    const cache1h = usage.cacheWrite === 0 ? 0 : usage.cache1h;
    if (cache5m === null || cache1h === null || cache5m + cache1h !== usage.cacheWrite)
        return null;
    return (usage.input * rates.input + usage.output * rates.output + usage.cacheRead * rates.cacheRead
        + cache5m * rates.cache5m + cache1h * rates.cache1h) / 1_000_000;
}
