import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';

/**
 * Checks a built package's audit asset (axe-core and the on-demand page checks) for the browser apps'
 * tests: it is a file of the package, apart from the content script's first payload, and run the way
 * the worker runs it (a world of its own, here a fresh VM context standing in for the reviewed
 * document's isolated world), it hands axe-core and the checks over through that world's global only:
 * never through a script element, and leaving nothing of axe-core on the global.
 */
export async function checkPackagedAudit(directory) {
    const read = file => readFile(join(directory, file), 'utf8');
    const [audit, content] = await Promise.all([read('audit.js'), read('content.js')]);
    // axe-core's MPL notice marks its code (validate.mjs checks every resource)
    assert(audit.includes('Deque Systems'), 'audit.js is missing axe-core and its notice');
    assert(!content.includes('Deque Systems'), 'axe-core is in the content script');

    const key = Symbol.for('uier.toolbar.audit');
    let handedOver, scriptRead = false;
    const world = {
        document: { get currentScript() { scriptRead = true; return null; } },
        navigator: { userAgent: 'uier-extension-test' }, setTimeout, clearTimeout,
        [key]: (axe, checks) => { handedOver = { axe, checks }; }
    };
    world.window = world;
    createContext(world);
    runInContext(audit, world, { filename: 'audit.js' });
    assert(handedOver, 'audit.js did not hand axe-core over through the isolated world');
    assert.match(handedOver.axe.version, /^\d+\.\d+\.\d+$/);
    assert.equal(typeof handedOver.axe.run, 'function');
    assert.equal(typeof handedOver.checks, 'object');
    assert.equal(scriptRead, false, 'audit.js looked for a script element: that is the web handoff');
    assert(!('axe' in world), 'audit.js left axe-core on the global');
    return { auditBytes: Buffer.byteLength(audit), contentBytes: Buffer.byteLength(content), axeVersion: handedOver.axe.version };
}
