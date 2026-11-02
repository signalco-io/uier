import { open } from 'node:fs/promises';
import { createRewriteService, REWRITE_CANDIDATES, REWRITE_MODEL } from '../src/lib/rewrite/suggest';
import { REWRITE_PRICING } from '../src/lib/rewrite/pricing';
import type { RewriteEvent } from '../src/lib/rewrite/telemetry';
import { rewriteFixture } from '../e2e/support/rewriteFixtures';

/** Versioned, synthetic only. Never load production selections into this benchmark. */
export const REWRITE_EVALUATION_CASES = [
    { id: 'short-en', text: 'Save your changes.', instruction: undefined },
    { id: 'tone-en', text: 'You must complete this form before continuing.', instruction: 'Use a warmer tone.' },
    { id: 'shorter-en', text: 'You can review every change your team has made before publishing the page.', instruction: 'Make it shorter.' },
    { id: 'croatian', text: 'Pregledajte promjene prije objave stranice.', instruction: 'Neka zvuči prirodnije.' },
    { id: 'german', text: 'Prüfen Sie Ihre Änderungen, bevor Sie die Seite veröffentlichen.', instruction: 'Kürzer, aber weiterhin höflich.' },
    { id: 'japanese', text: 'ページを公開する前に、変更内容を確認してください。', instruction: '簡潔で丁寧に。' },
    { id: 'max-length', text: 'Review every change before publishing this page. '.repeat(22).slice(0, 1000), instruction: 'Keep the language and meaning.' },
    { id: 'safety-context', text: 'Security testing is available to approved teams.', instruction: 'Use plain language.' },
] as const;

/** An unpriced call is unknown, including when no call has a known estimated charge. */
export function evaluationAccounting(rows: readonly { event?: RewriteEvent }[]) {
    const amounts = rows.flatMap(row => row.event?.estimatedUsd == null ? [] : [row.event.estimatedUsd]);
    return { estimatedUsd: amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) : null,
        accounting: rows.length && rows.every(row => row.event?.accounting === 'known') ? 'known'
            : amounts.length ? 'partial' : 'unknown' };
}

export async function main(args: string[]) {
    const [mode, output] = args;
    if (!['--stub', '--live'].includes(mode ?? '') || !output || args.length !== 2)
        throw new Error('Choose --stub or --live and an output file');
    const live = mode === '--live';
    if (live && (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_BASE_URL))
        throw new Error('Live evaluation requires a key and the default provider endpoint');
    // Reserve the output before any paid call; rerunning must not pay and then fail to save.
    const artifact = await open(output, 'wx', 0o600);
    try {
        if (!live) process.env.ANTHROPIC_API_KEY = 'synthetic-evaluation-key';
        const rows = [];
        let estimatedUsd = 0;
        let halted = false;
        // Hard limit: 16 logical calls, sequential; unchanged SDK retry/deadline/output/fallback policy.
        // Stop at USD 1 in observed estimates or on incomplete accounting. This is not an invoice cap.
        for (const example of REWRITE_EVALUATION_CASES) {
            for (const model of REWRITE_CANDIDATES) {
                const events: RewriteEvent[] = [];
                let suggestions: string[] = [];
                let failed = false;
                const suggest = createRewriteService({ model, emit: event => events.push(event),
                    ...(!live ? { fetch: async () => Response.json(rewriteFixture('success', model)) } : {}) });
                try { suggestions = await suggest(example.text, example.instruction); } catch { failed = true; }
                const event = events[0];
                estimatedUsd += event?.estimatedUsd ?? 0;
                rows.push({ caseId: example.id, model, failed, event, suggestions,
                    rubric: { distinct: suggestions.length === 3 && new Set(suggestions).size === 3,
                        characterLimit: suggestions.length > 0 && suggestions.every(s => s.length <= 1000),
                        preservesMeaningAndLanguage: null, respectsInstructions: null, dropInReplacement: null },
                    semanticReview: live ? 'pending blinded human scoring' : 'not applicable: canned fixture' });
                if (live && (!event || event.accounting !== 'known' || failed || estimatedUsd >= 1)) { halted = true; break; }
            }
            if (halted) break;
        }
        const result = { version: '2026-11-02.1', mode: live ? 'live' : 'stub', createdAt: new Date().toISOString(),
            pricing: REWRITE_PRICING, logicalCalls: rows.length, ...evaluationAccounting(rows), providerChargesUsd: null,
            providerChargesStatus: 'unavailable; token estimates are not an invoice', halted,
            productionModel: REWRITE_MODEL, modelDecision: 'Evaluation does not change the selected production model; semantic review is required.', rows };
        // Synthetic response content is saved only in this explicitly requested local review artifact, never in telemetry.
        await artifact.writeFile(`${JSON.stringify(result, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify({ mode: result.mode, logicalCalls: rows.length, ...evaluationAccounting(rows), halted,
            semanticQuality: 'unmeasured', providerChargesUsd: null })}\n`);
    } finally { await artifact.close(); }
}
