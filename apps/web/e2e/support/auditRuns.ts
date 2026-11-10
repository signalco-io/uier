import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';

/** The published path of the accessibility audit asset (axe-core) of the built toolbar */
export async function auditAssetPath() {
    return `/toolbar/${createHash('sha256')
        .update(await readFile(new URL('../../../../packages/toolbar/dist/audit.js', import.meta.url))).digest('hex')}.js`;
}

/**
 * Times every axe-core run of the toolbar's audit as a `axe-run` measure in the page's timeline,
 * without changing the toolbar: the audit asset hands axe-core over through a symbol on its script
 * element (`packages/toolbar/src/checks/auditHandoff.ts`), and this wraps the callback the toolbar
 * puts there, then axe-core's `run`.
 */
export async function observeAuditRuns(page: Page) {
    await page.addInitScript(() => {
        const key = Symbol.for('uier.toolbar.audit');
        type Axe = { run: (...args: unknown[]) => Promise<unknown> };
        Object.defineProperty(HTMLScriptElement.prototype, key, {
            configurable: true,
            set(this: HTMLScriptElement, callback: (api: Axe, ...rest: unknown[]) => void) {
                Object.defineProperty(this, key, {
                    configurable: true,
                    writable: true,
                    value: (api: Axe, ...rest: unknown[]) => {
                        const run = api.run;
                        api.run = (...args: unknown[]) => {
                            const start = performance.now();
                            return run(...args).finally(() => performance.measure('axe-run', { start, end: performance.now() }));
                        };
                        // With whatever else the asset hands over (the on-demand checks)
                        callback(api, ...rest);
                    }
                });
            }
        });
    });
}

/** The axe-core runs so far: when each started and how long it took */
export function auditRuns(page: Page) {
    return page.evaluate(() => performance.getEntriesByName('axe-run').map(({ startTime, duration }) => ({ startTime, duration })));
}
