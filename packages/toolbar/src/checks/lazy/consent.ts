import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';
import { words } from './locale';

// Page-side evidence only. Never retain cookie values, read storage values, request resources,
// change consent or patch the page's APIs. All returned data is names/metadata and local reports.
const limit = 100;
type Category = 'analytics' | 'marketing' | 'preferences' | 'consent' | 'unknown';
type StoredName = { kind: 'cookie' | 'local' | 'session'; name: string; domain?: string; expires?: number | null; category: Category };
type Inventory = { items: StoredName[]; unavailable: string[]; limited: boolean };

const categories: [RegExp, Category][] = [
    [/^(?:_ga(?:_|$)|_gid$|_gat(?:_|$)|_hj|_clck$|_clsk$|mp_)/, 'analytics'],
    [/^(?:_fbp$|_fbc$|_gcl_|IDE$|test_cookie$)/, 'marketing'],
    [/^(?:CookieConsent$|OptanonConsent$|OptanonAlertBoxClosed$|euconsent-v2$|cookieyes-consent$)/, 'consent'],
    [/^(?:theme$|color-scheme$|uier:)/, 'preferences']
];
const category = (name: string): Category => categories.find(([pattern]) => pattern.test(name))?.[1] ?? 'unknown';

// Deliberately small, documented signatures. A request to a provider is not proof it set a cookie.
const trackers = ['google-analytics.com', 'analytics.google.com', 'doubleclick.net', 'connect.facebook.net', 'hotjar.com', 'hotjar.io', 'clarity.ms'];
const managers = [
    { name: 'Cookiebot', banner: '#CybotCookiebotDialog', script: 'consent.cookiebot.com' },
    { name: 'OneTrust', banner: '#onetrust-banner-sdk', script: 'cdn.cookielaw.org' },
    { name: 'CookieYes', banner: '.cky-consent-container', script: 'cdn-cookieyes.com' },
    { name: 'Didomi', banner: '#didomi-notice', script: 'sdk.privacy-center.org' },
    { name: 'Usercentrics', banner: '#usercentrics-root', script: 'app.usercentrics.eu' },
    { name: 'Klaro', banner: '.klaro .cookie-notice', script: '' }
];
const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const nameKey = (item: StoredName) => JSON.stringify([item.kind, item.name, item.domain]);

function idFor(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(36);
}

async function inventory(signal: AbortSignal): Promise<Inventory> {
    signal.throwIfAborted();
    const result: Inventory = { items: [], unavailable: [], limited: false };
    const add = (kind: StoredName['kind'], name: string, metadata: Pick<StoredName, 'domain' | 'expires'> = {}) => {
        result.items.push({ kind, name: name.slice(0, 160), ...metadata, category: category(name) });
    };
    // Some engines expose optional cookie attributes that document.cookie does not. Select fields explicitly:
    // never spread its items (which also contain values) into a report, console or request.
    let cookieStoreRead = false;
    try {
        if ('cookieStore' in globalThis) {
            const cookies = await new Promise<CookieListItem[]>((resolve, reject) => {
                const clean = () => { clearTimeout(timeout); signal.removeEventListener('abort', aborted); };
                const aborted = () => { clean(); reject(signal.reason); };
                const timeout = setTimeout(() => { clean(); reject(new Error('cookie metadata unavailable')); }, 1000);
                signal.addEventListener('abort', aborted, { once: true });
                globalThis.cookieStore.getAll().then(items => { clean(); resolve(items); }, error => { clean(); reject(error); });
            });
            signal.throwIfAborted();
            cookieStoreRead = true;
            result.limited ||= cookies.length > limit;
            for (const cookie of cookies.slice(0, limit)) {
                if (typeof cookie.name !== 'string') continue;
                // Optional non-standard metadata exists in some engines. Missing is unknown, never session.
                const metadata = cookie as CookieListItem & { domain?: unknown; expires?: unknown };
                const domain = metadata.domain === null ? location.hostname : typeof metadata.domain === 'string' ? metadata.domain : undefined;
                const expires = metadata.expires === null ? null : typeof metadata.expires === 'number' && Number.isFinite(metadata.expires)
                    && Math.abs(metadata.expires) <= 8.64e15 ? metadata.expires : undefined;
                add('cookie', cookie.name, { domain, expires });
            }
        }
    } catch { signal.throwIfAborted(); /* Fall back to names without guessing attributes. */ }
    if (!cookieStoreRead) {
        try {
            const cookies = document.cookie.split(';').filter(part => part.includes('='));
            result.limited ||= cookies.length > limit;
            for (const part of cookies.slice(0, limit)) add('cookie', part.slice(0, part.indexOf('=')).trim());
        } catch { result.unavailable.push('cookie'); }
    }
    for (const kind of ['local', 'session'] as const) {
        try {
            const storage = kind === 'local' ? localStorage : sessionStorage;
            const length = storage.length;
            result.limited ||= length > limit;
            for (let index = 0; index < Math.min(length, limit); index++) {
                const name = storage.key(index);
                if (name !== null) add(kind, name, { domain: location.hostname });
            }
        } catch { result.unavailable.push(kind); }
    }
    // Several paths may expose cookies with the same name/domain. This names-only inventory
    // merges them; conflicting lifetimes stay unknown rather than displaying an arbitrary one.
    const unique = new Map<string, StoredName>();
    for (const item of result.items) {
        const key = nameKey(item);
        const previous = unique.get(key);
        if (previous && previous.expires !== item.expires) previous.expires = undefined;
        else if (!previous) unique.set(key, item);
    }
    result.items = [...unique.values()];
    return result;
}

function trackerHosts(since = 0, until = Infinity) {
    const hosts = new Set<string>();
    // Only the host survives, never paths, query strings, request bodies or identifiers.
    for (const entry of performance.getEntriesByType('resource').slice(-2000)) {
        if (entry.startTime < since || entry.startTime > until) continue;
        try {
            const host = new URL(entry.name).hostname;
            if (trackers.some(domain => onHost(host, domain))) hosts.add(host);
        } catch { /* Not an HTTP resource. */ }
    }
    return [...hosts].slice(0, limit);
}

function storageChecks(context: SectionContext, data: Inventory, observed = false) {
    const t = words().consent;
    return data.items.map(item => {
        const id = `consent-${observed ? 'observed-' : ''}${idFor(nameKey(item))}`;
        const name = item.name.replace(/[\r\n`]/g, ' ');
        const lifetime = item.kind === 'session' ? t.tabSession : item.kind === 'local' ? t.persistent
            : item.expires === null ? t.browserSession : typeof item.expires === 'number' && Number.isFinite(item.expires)
                ? t.expires(new Date(item.expires).toISOString()) : t.unknownLifetime;
        const value = [t.kinds[item.kind], item.domain ?? t.unknownDomain, t.firstParty, lifetime, t.categories[item.category]].join(' · ');
        const reason = observed ? t.newName : t.existingName;
        const issue = pageIssue(context.path, { type: 'consent', id }, undefined, `${name}: ${reason}`,
            `${t.title}: ${reason}\n\`${name}\`\n${value}\n${t.reviewOnly}`.slice(0, 1000));
        issue.review = true;
        return pageCheck(id, item.name, observed || item.category === 'analytics' || item.category === 'marketing' ? 'warn' : 'none', reason, { value, issues: [issue] });
    });
}

function trackerChecks(context: SectionContext, hosts: string[], observed = false) {
    const t = words().consent;
    return hosts.map(host => {
        const id = `consent-tracker-${observed ? 'observed-' : ''}${idFor(host)}`;
        // The known provider's domain is the only party inference for resources. Other requests
        // are not catalogued or classified by a guessed registrable domain.
        const provider = trackers.find(domain => onHost(host, domain))!;
        const providerSite = provider === 'analytics.google.com' ? 'google.com' : provider === 'connect.facebook.net' ? 'facebook.net' : provider;
        const party = onHost(location.hostname, providerSite) ? t.firstParty : t.thirdParty;
        const reason = observed ? t.newRequest : t.existingRequest;
        const issue = pageIssue(context.path, { type: 'consent', id }, undefined, `${host}: ${reason}`,
            `${t.title}: ${reason}\n\`${host}\` · ${party}\n${t.reviewOnly}`);
        issue.review = true;
        return pageCheck(id, host, 'warn', reason, { value: party, issues: [issue] });
    });
}

export async function checkConsent(context: SectionContext): Promise<SectionReport> {
    const t = words().consent;
    const data = await inventory(context.signal);
    context.signal.throwIfAborted();
    const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[src]')].slice(0, 1000);
    const detected = managers.filter(manager => document.querySelector(manager.banner) || manager.script && scripts.some(script => {
        try { return onHost(new URL(script.src).hostname, manager.script); } catch { return false; }
    }));
    // These markers are candidates, never inferred from English words or treated as consent.
    const visible = detected.filter(manager => [...document.querySelectorAll(manager.banner)].some(element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })));
    const bannerValue = detected.length ? detected.map(manager => `${manager.name}: ${visible.includes(manager) ? t.visible : t.detected}`).join(' · ') : t.notDetected;
    const bannerIssue = pageIssue(context.path, { type: 'consent', id: 'consent-banner' }, undefined, bannerValue,
        `${t.title}: ${bannerValue}. ${t.bannerReason} ${t.reviewOnly}`.slice(0, 1000));
    bannerIssue.review = true;
    return { checks: [
        pageCheck('consent-banner', t.banner, 'none', t.bannerReason, { value: bannerValue, issues: [bannerIssue] }),
        pageCheck('consent-timing', t.timing, 'none', t.timingReason, { value: t.timingUnknown }),
        pageCheck('consent-access', t.scope, 'none', t.scopeReason, { value: data.unavailable.length ? t.unavailable(data.unavailable.map(kind => t.kinds[kind as StoredName['kind']]).join(', ')) : t.namesOnly }),
        ...data.limited ? [pageCheck('consent-limit', t.limit, 'none', t.limitReason)] : [],
        ...storageChecks(context, data), ...trackerChecks(context, trackerHosts())
    ] };
}

function pause(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
        const aborted = () => { clean(); reject(signal.reason); };
        const timer = setTimeout(() => { clean(); resolve(); }, 500);
        signal.addEventListener('abort', aborted, { once: true });
    });
}

/** A reviewer starts this while consent is pending, and waits before choosing. No verdict about consent. */
export async function observeConsent(context: SectionContext): Promise<SectionReport> {
    const t = words().consent;
    const initial = await inventory(context.signal);
    const known = new Set(initial.items.map(nameKey));
    const added: Inventory = { items: [], unavailable: [...initial.unavailable], limited: initial.limited };
    const hosts = new Set<string>();
    const start = performance.now();
    const end = start + 15_000;
    while (performance.now() < end) {
        await pause(context.signal);
        // A suspended tab may resume after the window. Do not attribute later storage to it.
        if (performance.now() > end) break;
        const next = await inventory(context.signal);
        context.signal.throwIfAborted();
        for (const item of next.items) {
            const key = nameKey(item);
            if (known.has(key)) continue;
            known.add(key);
            if (added.items.length < limit) added.items.push(item); else added.limited = true;
        }
        for (const kind of next.unavailable) if (!added.unavailable.includes(kind)) added.unavailable.push(kind);
        added.limited ||= next.limited;
        for (const host of trackerHosts(start, end)) hosts.add(host);
    }
    for (const host of trackerHosts(start, end)) hosts.add(host);
    return { checks: [
        pageCheck('consent-observation', t.observation, 'none', t.observationReason, { value: t.observationDone }),
        ...storageChecks(context, added, true), ...trackerChecks(context, [...hosts], true),
        ...!added.items.length && !hosts.size ? [pageCheck('consent-observation-empty', t.noNew, 'none', t.noNewReason)] : [],
        ...added.unavailable.length ? [pageCheck('consent-observation-access', t.scope, 'none', t.scopeReason, { value: t.unavailable(added.unavailable.map(kind => t.kinds[kind as StoredName['kind']]).join(', ')) })] : [],
        ...added.limited ? [pageCheck('consent-observation-limit', t.limit, 'none', t.limitReason)] : []
    ] };
}
