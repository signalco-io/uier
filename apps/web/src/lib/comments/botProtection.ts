import { checkBotId } from 'botid/server';
import { isLocalRuntime } from './environment';
import { apiErrors } from './http';

type BotIdVerdict = 'HUMAN' | 'BAD-BOT' | 'GOOD-BOT';

const verdicts: readonly BotIdVerdict[] = ['HUMAN', 'BAD-BOT', 'GOOD-BOT'];

let warnedAboutLocalMode = false;

/**
 * Local runtime only: lets tests simulate a BotID verdict, e.g. `UIER_BOTID_DEV_BYPASS=BAD-BOT`.
 * Defaults to `HUMAN`, like BotID's own development mode.
 */
function localVerdict(): BotIdVerdict {
    const value = process.env.UIER_BOTID_DEV_BYPASS?.trim().toUpperCase();
    return verdicts.find(verdict => verdict === value) ?? 'HUMAN';
}

/**
 * Vercel BotID (basic mode) for all write requests. The client side is `instrumentation-client.ts`.
 *
 * BotID always performs the real classification (`checkBotId()`), unless the app runs locally
 * (`next dev`, or `next start` with `UIER_LOCAL=1` in the e2e tests, see `isLocalRuntime`). There
 * is no BotID backend to verify against locally, so - like BotID's documented development mode -
 * requests are treated as human unless `UIER_BOTID_DEV_BYPASS` says otherwise. Anything else, such
 * as a deployment without Vercel's system environment variables, fails closed.
 */
export async function assertNotBot() {
    if (!isLocalRuntime()) {
        const verification = await checkBotId();
        if (verification.isBot)
            throw apiErrors.botDetected();
        return;
    }

    if (!warnedAboutLocalMode) {
        warnedAboutLocalMode = true;
        console.warn('[comments] Running locally - BotID verification is skipped (UIER_BOTID_DEV_BYPASS can simulate a verdict).');
    }

    if (localVerdict() === 'BAD-BOT')
        throw apiErrors.botDetected();
}
