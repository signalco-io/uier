// Runs first in the audit asset, before axe-core initializes (imported ahead of it in auditEntry.ts).
// axe-core assigns `window.axe` and registers with a page's AMD loader (`define`). Both are the page's
// globals: they are saved here, `define` is hidden while axe-core initializes, and both are put back.
// Nothing else runs in between, so the page never sees the change.

type PageGlobals = Window & { axe?: unknown; define?: unknown };

const page = window as PageGlobals;
const saved = (['axe', 'define'] as const).map(name => [name, Object.getOwnPropertyDescriptor(page, name)] as const);

try {
    if (saved.some(([name, descriptor]) => name === 'define' && descriptor)) page.define = undefined;
} catch { /* A read-only loader: axe-core then registers with it, as it would on any page. */ }

export function restorePageGlobals() {
    for (const [name, descriptor] of saved) {
        try {
            if (descriptor) Object.defineProperty(page, name, descriptor);
            else delete page[name];
        } catch { /* A property the page made fixed stays as axe-core left it. */ }
    }
}
