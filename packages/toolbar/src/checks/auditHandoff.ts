import type axe from 'axe-core';
import type { LazyChecks } from './lazy';

/** The axe-core API the audit asset hands over */
export type AxeApi = typeof axe;

/** What the audit asset hands over: axe-core, and the page checks that run on demand (`lazy/index.ts`) */
export type AuditAsset = { axe: AxeApi; checks: LazyChecks };

/** The toolbar's callback the audit asset (`auditEntry.ts`) calls with axe-core and the on-demand checks while it runs */
export type AuditReceiver = (api: AxeApi, checks: LazyChecks) => void;

/**
 * Where the toolbar puts its callback, never a page global:
 * - on the web, a property of the audit script element (`AuditScript`): the review bundle adds the
 *   asset as a classic script (`axeLoader.ts`);
 * - in packaged clients (the browser extension), a property of the global object of the toolbar's own
 *   isolated world (`AuditWorld`): the client runs the asset as a file of its package in that world,
 *   where there is no script element and whose globals the page's scripts never see.
 */
export const auditHandoffKey = Symbol.for('uier.toolbar.audit');
export type AuditScript = HTMLScriptElement & { [auditHandoffKey]?: AuditReceiver };
export type AuditWorld = typeof globalThis & { [auditHandoffKey]?: AuditReceiver };
