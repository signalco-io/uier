import { rewriteEventSchema, type RewriteEvent } from './telemetry';

/** Aggregate only validated operational fields. Duplicate exported log records count once. */
export function dailyRewriteReport(events: unknown[], day: string, environment: RewriteEvent['environment']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new Error('Invalid UTC day');
    const seen = new Set<string>();
    const selected: RewriteEvent[] = [];
    let rejectedRecords = 0, duplicateRecords = 0;
    for (const input of events) {
        const parsed = rewriteEventSchema.safeParse(input);
        if (!parsed.success) { rejectedRecords++; continue; }
        const event = parsed.data;
        if (!event.timestamp.startsWith(day) || event.environment !== environment) continue;
        if (seen.has(event.id)) { duplicateRecords++; continue; }
        seen.add(event.id); selected.push(event);
    }
    const latencies = selected.map(event => event.durationMs).sort((a, b) => a - b);
    const percentile = (p: number) => latencies.length ? latencies[Math.ceil(latencies.length * p) - 1]! : null;
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cache5m: 0, cache1h: 0 };
    const missingTokenCounters = { ...tokens };
    const outcomes: Record<string, number> = {}, limitations: Record<string, number> = {};
    let estimatedUsd = 0, pricedCalls = 0, knownCalls = 0, suggestions = 0, usableCalls = 0, sdkAttempts = 0;
    for (const event of selected) {
        outcomes[event.outcome] = (outcomes[event.outcome] ?? 0) + 1;
        event.limitations.forEach(reason => { limitations[reason] = (limitations[reason] ?? 0) + 1; });
        for (const usage of event.usage) for (const key of Object.keys(tokens) as (keyof typeof tokens)[]) {
            if (usage[key] === null) missingTokenCounters[key]++; else tokens[key] += usage[key];
        }
        if (event.estimatedUsd !== null) { estimatedUsd += event.estimatedUsd; pricedCalls++; }
        if (event.accounting === 'known') knownCalls++;
        suggestions += event.suggestionCount;
        if (event.suggestionCount) usableCalls++;
        sdkAttempts += event.sdkAttempts;
    }
    return { version: 1, dayUtc: day, environment, observedCalls: selected.length, observedSdkAttempts: sdkAttempts,
        outcomes, usableCalls, retainedSuggestions: suggestions, knownTokenTotals: tokens, missingTokenCounters,
        estimatedUsd: pricedCalls ? estimatedUsd : null,
        estimatedUsdPerUsableCall: pricedCalls && usableCalls ? estimatedUsd / usableCalls : null,
        estimatedUsdPerSuggestion: pricedCalls && suggestions ? estimatedUsd / suggestions : null,
        accounting: { knownCalls, partialCalls: selected.filter(e => e.accounting === 'partial').length,
            unknownCalls: selected.filter(e => e.accounting === 'unknown').length,
            knownCallFraction: selected.length ? knownCalls / selected.length : null, limitations },
        latencyMs: { p50: percentile(0.5), p95: percentile(0.95) },
        pricingVersions: [...new Set(selected.map(e => e.pricingVersion))].sort(),
        providerCharges: { status: 'unavailable', usd: null }, rejectedRecords, duplicateRecords,
        scope: 'Observed exported service calls only; estimates exclude unavailable charges. Not a provider invoice.' };
}
