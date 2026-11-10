import { sha256Hex } from '../app/tokens';
import { getAppStore, type AppStore } from '../app/store';
import type { AppDoc } from '../app/model';
import {
    PAGE_CHECKS_MAX_PAGES,
    PAGE_CHECKS_TTL_SECONDS,
    pageChecksPk,
    type PageCheckSummary
} from './model';
import type { PageCheckInput } from './schema';

// Page check summaries in the `app` container: one document per page and environment in the
// project's own partition (`page-checks:<projectId>`), so the view is one single-partition query of at
// most PAGE_CHECKS_MAX_PAGES small documents, and deleting the project removes the partition.

export type DbPageCheck = AppDoc & PageCheckSummary & {
    type: 'page-check';
    pk: `page-checks:${string}`;
    projectId: string;
};

/** Stable for a page in an environment: the origin and the canonical path, hashed */
export function pageCheckId(origin: string, path: string) {
    return `page_${sha256Hex(`${origin}\n${path}`).slice(0, 40)}`;
}

/** What the view reads: the summary without the storage fields */
export function toPageCheckSummary(doc: DbPageCheck): PageCheckSummary {
    return {
        id: doc.id, origin: doc.origin, path: doc.path, sourcePath: doc.sourcePath, title: doc.title,
        description: doc.description, noindex: doc.noindex, accessibility: doc.accessibility, seo: doc.seo,
        checks: doc.checks, vitals: doc.vitals, checkedAt: doc.checkedAt, previous: doc.previous
    };
}

/** Room for one more page: the least recently checked ones go (also any a concurrent write left over the cap) */
async function makeRoom(store: AppStore, pk: string) {
    if (await store.count({ type: 'page-check', pk }) < PAGE_CHECKS_MAX_PAGES) return;
    const pages = await store.query<DbPageCheck>({ type: 'page-check', pk });
    const oldest = pages.sort((a, b) => a.checkedAt < b.checkedAt ? -1 : a.checkedAt > b.checkedAt ? 1 : a.id < b.id ? -1 : 1)
        .slice(0, pages.length - PAGE_CHECKS_MAX_PAGES + 1);
    for (const page of oldest) await store.delete(page.pk, page.id);
}

const MAX_ATTEMPTS = 6;

/**
 * Saves a page's latest summary: it replaces the page's previous one, whose counts it keeps as
 * `previous` (the view's change since the check before). A new page beyond the project's cap
 * replaces the least recently checked one.
 */
export async function savePageCheck(projectId: string, page: Omit<PageCheckInput, 'path' | 'sourcePath'> & { origin: string; path: string; sourcePath?: string },
    { now = new Date(), store = getAppStore() }: { now?: Date; store?: AppStore } = {}): Promise<DbPageCheck> {
    const pk = pageChecksPk(projectId);
    const id = pageCheckId(page.origin, page.path);
    const doc: DbPageCheck = {
        type: 'page-check', id, pk, projectId,
        origin: page.origin, path: page.path,
        ...(page.sourcePath ? { sourcePath: page.sourcePath } : {}),
        ...(page.title ? { title: page.title } : {}),
        ...(page.description ? { description: page.description } : {}),
        noindex: page.noindex,
        ...(page.accessibility ? { accessibility: page.accessibility } : {}),
        seo: page.seo,
        checks: page.checks,
        ...(page.vitals && Object.keys(page.vitals).length ? { vitals: page.vitals } : {}),
        checkedAt: now.toISOString(),
        ttl: PAGE_CHECKS_TTL_SECONDS
    };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const stored = await store.get<DbPageCheck>(pk, id);
        if (stored) {
            const before = stored.doc;
            const next: DbPageCheck = { ...doc, previous: { checkedAt: before.checkedAt, seo: before.seo, ...(before.accessibility ? { accessibility: before.accessibility } : {}) } };
            if (await store.replace(next, stored.etag) === 'ok') return next;
            continue;
        }
        await makeRoom(store, pk);
        if (await store.create(doc)) return doc;
    }
    throw new Error('A page check changed too often while saving');
}

/** Every page of the project, for its members' view (one single-partition query, at most the cap) */
export async function listPageChecks(projectId: string, store: AppStore = getAppStore()): Promise<PageCheckSummary[]> {
    const docs = await store.query<DbPageCheck>({ type: 'page-check', pk: pageChecksPk(projectId) });
    return docs.map(toPageCheckSummary);
}

/** With the project's other records (projectDeletion.ts) */
export async function deleteProjectPageChecks(projectId: string, store: AppStore = getAppStore()) {
    for (const doc of await store.query<DbPageCheck>({ type: 'page-check', pk: pageChecksPk(projectId) }))
        await store.delete(doc.pk, doc.id);
}
