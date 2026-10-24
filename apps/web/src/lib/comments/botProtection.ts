import { checkBotId } from 'botid/server';
import { apiErrors } from './http';

type BotIdVerdict = 'HUMAN' | 'BAD-BOT' | 'GOOD-BOT';

const verdicts: readonly BotIdVerdict[] = ['HUMAN', 'BAD-BOT', 'GOOD-BOT'];

let warnedAboutLocalMode = false;

function isRunningOnVercel() {
    return Boolean(process.env.VERCEL);
}

/**
 * Outside of Vercel only: lets tests simulate a BotID verdict, e.g. `UIER_BOTID_DEV_BYPASS=BAD-BOT`.
 * Defaults to `HUMAN`, like BotID's own development mode.
 */
function localVerdict(): BotIdVerdict {
    const value = process.env.UIER_BOTID_DEV_BYPASS?.trim().toUpperCase();
    return verdicts.find(verdict => verdict === value) ?? 'HUMAN';
}

/**
 * Vercel BotID (basic mode) for all write requests. The client side is `instrumentation-client.ts`.
 *
 * On Vercel BotID always performs the real classification (`checkBotId()`). Outside of Vercel
 * (`next dev`, `next start` in e2e tests, self-hosting) there is no BotID backend to verify against,
 * so - like BotID's documented development mode - requests are treated as human unless
 * `UIER_BOTID_DEV_BYPASS` says otherwise. (Calling `checkBotId()` there would only log a
 * misconfiguration error for every request that doesn't come from the instrumented page.)
 */
export async function assertNotBot() {
    if (isRunningOnVercel()) {
        const verification = await checkBotId();
        if (verification.isBot)
            throw apiErrors.botDetected();
        return;
    }

    if (!warnedAboutLocalMode) {
        warnedAboutLocalMode = true;
        console.warn('[comments] Not running on Vercel - BotID verification is skipped (UIER_BOTID_DEV_BYPASS can simulate a verdict).');
    }

    if (localVerdict() === 'BAD-BOT')
        throw apiErrors.botDetected();
}
