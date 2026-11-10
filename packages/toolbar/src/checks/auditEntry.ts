// The audit asset: axe-core and the page checks that run on demand (`lazy/index.ts`), loaded by the
// review bundle only when a panel runs a check (`axeLoader.ts`), never with the review bundle itself
// and never for ordinary visitors. On the web it is `dist/audit.js`, published as
// `/toolbar/<sha256>.js`; packaged clients build it from this file as a file of their package
// (`packages/extension/scripts/build.mjs`). The order of these imports matters: the prelude saves the
// page's globals before axe-core initializes.
import { restorePageGlobals } from './auditPrelude';
import axe from 'axe-core';
import { auditHandoffKey, type AuditReceiver, type AuditScript, type AuditWorld } from './auditHandoff';
import { lazyChecks } from './lazy';

restorePageGlobals();

// How the asset was built says how it runs (`auditHandoff.ts`). With a published path (`tsup.config.ts`),
// it is the web's classic script and the callback is on its script element. Packaged clients build it
// without one: they run it in the toolbar's isolated world, and the callback is on that world's global.
const receiver: AuditReceiver | undefined = __UIER_AUDIT_PATH__
    ? (document.currentScript as AuditScript | null)?.[auditHandoffKey]
    : (globalThis as AuditWorld)[auditHandoffKey];
receiver?.(axe, lazyChecks);
