import type { ProjectEnvironment } from '../../../lib/app/environments';

/**
 * One row of a project's site addresses: the address as typed, its label and the shared group it
 * is in (a number local to the form; `null` keeps its feedback to itself). The server keeps one
 * label and group per origin, from the first row on that origin.
 */
export type SiteRow = { url: string; label: string; group: number | null };

const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i;
const loopback = /^(localhost|[^/:]+\.localhost|127(\.\d+){3}|\[::1\])\.?(:\d+)?(\/|$)/i;

/**
 * The origin an address will be saved with, as `normalizeSiteUrl` decides it on the server
 * (schemeless local addresses use HTTP, others HTTPS); `null` while it is not an address yet.
 */
export function siteOrigin(input: string) {
    const trimmed = input.trim();
    if (!trimmed)
        return null;
    try {
        const url = new URL(hasScheme.test(trimmed) ? trimmed : `${loopback.test(trimmed) ? 'http' : 'https'}://${trimmed}`);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
    } catch {
        return null;
    }
}

/** A saved address as it is typed: without its scheme when that is the default one (HTTPS, or HTTP for local addresses) */
export function typedAddress(url: string) {
    const bare = url.replace(/^https?:\/\//i, '');
    return siteOrigin(bare) === siteOrigin(url) ? bare : url;
}

/** Whether any address is a local one typed without a scheme (it opens over HTTP) */
export function hasSchemelessLocal(rows: SiteRow[]) {
    return rows.some(row => !hasScheme.test(row.url.trim()) && loopback.test(row.url.trim()));
}

/**
 * Numbers groups by their first row and leaves out groups of a single site (one origin shares
 * nothing), so equal setups compare equal.
 */
export function normalizeGroups(rows: SiteRow[]): SiteRow[] {
    const sites = new Map<number, Set<string>>();
    rows.forEach((row, index) => {
        if (row.group !== null)
            sites.set(row.group, (sites.get(row.group) ?? new Set()).add(siteOrigin(row.url) ?? `row ${index}`));
    });
    const numbers = new Map<number, number>();
    return rows.map(row => {
        if (row.group === null || (sites.get(row.group)?.size ?? 0) < 2)
            return { ...row, group: null };
        if (!numbers.has(row.group))
            numbers.set(row.group, numbers.size);
        return { ...row, group: numbers.get(row.group)! };
    });
}

/** The saved addresses as rows, each with its origin's label (blank when it is the origin) and group */
export function savedSiteRows(urls: string[], environments: ProjectEnvironment[]): SiteRow[] {
    const groups = new Map<string, number>();
    return normalizeGroups(urls.map(url => {
        const origin = siteOrigin(url);
        const environment = environments.find(item => item.origin === origin);
        if (environment?.group && !groups.has(environment.group))
            groups.set(environment.group, groups.size);
        return {
            url: typedAddress(url),
            label: environment && environment.label !== environment.origin ? environment.label : '',
            group: environment?.group ? groups.get(environment.group)! : null
        };
    }));
}

/** The index of the earlier row on the same origin, whose label and sharing this row follows */
export function sameSiteAs(rows: SiteRow[], index: number) {
    const origin = siteOrigin(rows[index]?.url ?? '');
    if (!origin)
        return -1;
    return rows.findIndex((row, other) => other < index && siteOrigin(row.url) === origin);
}

/** The rows this row can share feedback with: other addresses on other origins, one per origin */
export function shareOptions(rows: SiteRow[], index: number) {
    const own = siteOrigin(rows[index]?.url ?? '');
    return rows
        .map((row, other) => ({ row, other }))
        .filter(({ row, other }) => other !== index && row.url.trim() && sameSiteAs(rows, other) === -1
            && (own === null || siteOrigin(row.url) !== own));
}

/** The other rows in this row's group, in order (only the first of each origin) */
export function sharedWith(rows: SiteRow[], index: number) {
    const group = rows[index]?.group;
    if (group === null || group === undefined)
        return [];
    return shareOptions(rows, index).filter(({ row }) => row.group === group).map(({ other }) => other);
}

/**
 * Puts row `index` in the group of row `other` (a new group of the two when `other` shares with
 * nothing yet), or on its own with `null`. Its former group keeps its other rows.
 */
export function shareWith(rows: SiteRow[], index: number, other: number | null): SiteRow[] {
    if (other === null)
        return normalizeGroups(rows.map((row, i) => i === index ? { ...row, group: null } : row));
    const group = rows[other]?.group ?? Math.max(-1, ...rows.map(row => row.group ?? -1)) + 1;
    return normalizeGroups(rows.map((row, i) => i === index || i === other ? { ...row, group } : row));
}

/** Allowed in a group name (as the server checks it): letters, numbers, spaces, dots, dashes, underscores */
function groupName(text: string) {
    return text.replace(/[^\p{L}\p{N} ._-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
}

/**
 * The rows as the server takes them, each group named. A group keeps a name it was saved with
 * (environment filters link to it); a new one is named after its first row's label or host.
 */
export function siteRowsPayload(rows: SiteRow[], environments: ProjectEnvironment[]) {
    const names = new Map<number, string>();
    const used = new Set<string>();
    const savedGroup = (row: SiteRow) => environments.find(item => item.origin === siteOrigin(row.url))?.group;
    const grouped = rows.filter(row => row.url.trim() && row.group !== null);
    for (const group of new Set(grouped.map(row => row.group!))) {
        const members = grouped.filter(row => row.group === group);
        const kept = members.map(savedGroup).find(name => name && !used.has(name));
        const first = members[0]!;
        const base = kept ?? (groupName(first.label) || groupName(new URL(siteOrigin(first.url) ?? 'https://shared.invalid').host) || 'Shared');
        let name = base;
        for (let suffix = 2; used.has(name); suffix++)
            name = `${base.slice(0, 56)} ${suffix}`;
        used.add(name);
        names.set(group, name);
    }
    return rows.map(row => ({ url: row.url, label: row.label, group: row.group === null ? '' : names.get(row.group) ?? '' }));
}
