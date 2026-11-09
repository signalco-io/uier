import type axe from 'axe-core';

/** The axe-core API the audit asset hands over */
export type AxeApi = typeof axe;

/**
 * A property of the audit script element, never a window global: the review bundle puts its
 * callback there and the audit asset (`auditEntry.ts`) calls it with axe-core while it runs.
 */
export const auditHandoffKey = Symbol.for('uier.toolbar.audit');
export type AuditScript = HTMLScriptElement & { [auditHandoffKey]?: (api: AxeApi) => void };
