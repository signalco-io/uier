import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkills } from '@modelcontextprotocol/server/ext/skills/node';

/*
 * The MCP Skills extension (SEP-2640): the connector serves the skills of the uier plugin
 * (`plugins/uier/skills`, the same files the Claude Code and Codex plugin installs), so a client
 * that supports the extension gets `uier-monitor` and `uier-monitor-script` from the connection it
 * already has, with their scripts, without installing anything. The SDK builds the catalog once
 * per process and checks every read against it; the files are public and the same for everyone.
 */

export type FeedbackSkills = Awaited<ReturnType<typeof loadSkills>>;
let catalog: Promise<FeedbackSkills | null> | undefined;

/** The app runs from `apps/web` (next, Vercel, Playwright); `next.config.ts` traces the files into the deployment. */
function skillsRoot() {
    return [join(process.cwd(), '../../plugins/uier/skills'), join(process.cwd(), 'plugins/uier/skills')]
        .find(root => existsSync(join(root, 'uier-monitor', 'SKILL.md')));
}

/** The skill catalog, or `null` when the files are missing or invalid: the endpoint then works without skills. */
export function feedbackSkills() {
    return catalog ??= (async () => {
        const root = skillsRoot();
        if (!root) { console.warn('[mcp] The plugin skills were not found; skills are not offered.'); return null; }
        try { return await loadSkills(root, { cacheHint: { ttlMs: 5 * 60_000, cacheScope: 'private' }, onWarning: () => undefined }); }
        catch (error) {
            console.warn(`[mcp] The plugin skills could not be loaded (${error instanceof Error ? error.name : 'Error'}); skills are not offered.`);
            return null;
        }
    })();
}
