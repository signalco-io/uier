import type axe from 'axe-core';
import type { LazyChecks } from './lazy';

/** The axe-core API the audit asset hands over */
export type AxeApi = typeof axe;

/** What the audit asset hands over: axe-core, and the page checks that run on demand (`lazy/index.ts`) */
export type AuditAsset = { axe: AxeApi; checks: LazyChecks };

/**
 * A property of the audit script element, never a window global: the review bundle puts its
 * callback there and the audit asset (`auditEntry.ts`) calls it with axe-core and the on-demand
 * checks while it runs.
 */
export const auditHandoffKey = Symbol.for('uier.toolbar.audit');
export type AuditScript = HTMLScriptElement & { [auditHandoffKey]?: (api: AxeApi, checks: LazyChecks) => void };
