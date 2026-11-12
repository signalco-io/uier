import { isToolbarNode, pageAnchorElement } from '../pageElements';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';
import { words } from './locale';
import { redactName } from './redactName';
import { headerRequestAddress, securityHeaderRules, securityAddress } from './securityRules';

const elementLimit = 1000;
const findingLimit = 100;
const key = (text: string) => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
};

function issue(context: SectionContext, id: string, reason: string, evidence = '', element?: Element) {
    const t = words().security;
    const found = pageIssue(context.path, { type: 'consent', id }, pageAnchorElement(element), reason,
        `${t.title}: ${reason}${evidence ? `\n\`${evidence.replaceAll('`', "'")}\`` : ''}\n${t.review}`.slice(0, 1000));
    found.review = true;
    if (!found.element && evidence) found.key = `consent:${id}:${key(evidence)}@${context.path}`;
    if (evidence) found.summary = `${reason} ${evidence}`;
    if (element) found.label = element.tagName.toLowerCase();
    return found;
}
const parse = (value: string | null) => { try { return value ? new URL(value, document.baseURI) : undefined; } catch { return undefined; } };

async function cookieChecks(context: SectionContext) {
    const t = words().security;
    const visibility = pageCheck('security-cookie-visibility', t.cookies, 'none', t.cookieLimits);
    if (!('cookieStore' in globalThis)) return [visibility];
    const controller = AbortSignal.any([context.signal, AbortSignal.timeout(1000)]);
    let aborted: (() => void) | undefined;
    try {
        controller.throwIfAborted();
        const cookies = await Promise.race([
            globalThis.cookieStore.getAll(),
            new Promise<never>((_resolve, reject) => { aborted = () => reject(controller.reason); controller.addEventListener('abort', aborted, { once: true }); })
        ]);
        context.signal.throwIfAborted();
        const checks = new Map<string, ReturnType<typeof pageCheck>>();
        for (const cookie of cookies.slice(0, findingLimit)) {
            if (typeof cookie.name !== 'string') continue;
            const metadata = cookie as CookieListItem & { secure?: unknown; sameSite?: unknown };
            const name = redactName(cookie.name);
            const secure = typeof metadata.secure === 'boolean' ? metadata.secure : undefined;
            const sameSite = typeof metadata.sameSite === 'string' && ['lax', 'strict', 'none'].includes(metadata.sameSite) ? metadata.sameSite : undefined;
            const value = `Secure: ${secure === undefined ? t.unknown : String(secure)} · SameSite: ${sameSite ?? t.unknown}`;
            const id = `security-cookie-${key(`${name}:${value}`)}`;
            const reason = secure === false ? t.cookieInsecure : t.cookieMetadata;
            checks.set(id, pageCheck(id, name, secure === false ? 'warn' : 'none', reason,
                { value, issues: secure === false ? [issue(context, id, reason, `${name} · ${value}`)] : [] }));
        }
        if (cookies.length > findingLimit) checks.set('security-cookie-limit', pageCheck('security-cookie-limit', t.limit, 'none', t.limited));
        return [visibility, ...checks.values()];
    } catch { context.signal.throwIfAborted(); return [pageCheck('security-cookie-visibility', t.cookies, 'none', t.cookieUnavailable)]; }
    finally { if (aborted) controller.removeEventListener('abort', aborted); }
}

/** A bounded snapshot only. Nothing fetched and no APIs patched. */
export async function checkSecurity(context: SectionContext): Promise<SectionReport> {
    const t = words().security;
    context.signal.throwIfAborted();
    const https = location.protocol === 'https:';
    const nodes = document.querySelectorAll('script[src],img[src],img[srcset],iframe[src],link[href],audio[src],video[src],source[src],track[src],embed[src],object[data],form[action],button[formaction],input[formaction]');
    const mixed = [], scripts = [];
    for (const element of [...nodes].slice(0, elementLimit)) {
        if (isToolbarNode(element)) continue;
        const tag = element.tagName.toLowerCase();
        const isStyle = tag === 'link' && /\bstylesheet\b/i.test(element.getAttribute('rel') ?? '');
        if (tag === 'link' && !isStyle) continue;
        const values = [element.getAttribute('src') ?? element.getAttribute('href') ?? element.getAttribute('data') ?? element.getAttribute('formaction') ?? element.getAttribute('action')];
        if (element instanceof HTMLImageElement && element.currentSrc) values.push(element.currentSrc);
        const urls = values.map(parse).filter(url => url !== undefined);
        const insecure = urls.find(url => url.protocol === 'http:');
        if (https && insecure && mixed.length < findingLimit) mixed.push(issue(context, 'security-mixed-content', t.mixedFound, securityAddress(insecure.href), element));
        if (tag === 'script' && ['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes((element.getAttribute('type') ?? '').trim().toLowerCase())) {
            const url = urls[0];
            if (url && /^https?:$/.test(url.protocol) && url.origin !== location.origin && !element.getAttribute('integrity')?.trim() && scripts.length < findingLimit)
                scripts.push(issue(context, 'security-script-integrity', t.integrityFound, securityAddress(url.href)));
        }
    }
    const timings = performance.getEntriesByType('resource').slice(-2000);
    const maps = [...new Set(timings.flatMap(entry => {
        const url = parse(entry.name);
        return url && /^https?:$/.test(url.protocol) && url.pathname.endsWith('.map') ? [securityAddress(url.href)] : [];
    }))].slice(0, findingLimit);
    const mapIssues = maps.map(address => issue(context, 'security-source-maps', t.mapsFound, address));
    const checks = [
        pageCheck('security-https', t.transport, https ? 'pass' : location.protocol === 'http:' ? 'warn' : 'none', https ? t.https : t.notHttps,
            { issues: location.protocol === 'http:' ? [issue(context, 'security-https', t.notHttps)] : [] }),
        pageCheck('security-mixed-content', t.mixed, mixed.length ? 'warn' : 'none', https ? mixed.length ? t.mixedFound : t.mixedNone : t.mixedUnmeasured, { issues: mixed }),
        pageCheck('security-script-integrity', t.integrity, scripts.length ? 'warn' : 'none', scripts.length ? t.integrityFound : t.integrityNone, { issues: scripts }),
        ...await cookieChecks(context),
        pageCheck('security-source-maps', t.maps, maps.length ? 'warn' : 'none', maps.length ? t.mapsFound : t.mapsNone, { issues: mapIssues }),
        pageCheck('security-sensitive-files', t.files, 'none', t.filesNotChecked)
    ];
    if (nodes.length > elementLimit || timings.length >= 2000 || mixed.length >= findingLimit || scripts.length >= findingLimit || maps.length >= findingLimit)
        checks.push(pageCheck('security-limit', t.limit, 'none', t.limited));
    context.signal.throwIfAborted();
    return { checks };
}

/** One explicit anonymous same-origin GET. No redirects, body reads, persistent cache or credential headers. */
export async function checkSecurityHeaders(context: SectionContext): Promise<SectionReport> {
    const t = words().security;
    const url = headerRequestAddress(new URL(location.href));
    context.signal.throwIfAborted();
    const unavailable = (reason: string) => ({ checks: Object.entries(t.headers).map(([id, label]) => pageCheck(`security-header-${id}`, label, 'none', reason)) });
    if (!url) return unavailable(t.requestSkipped);
    try {
        const response = await fetch(url.href, { method: 'GET', mode: 'same-origin', credentials: 'omit', redirect: 'manual', cache: 'no-store',
            referrerPolicy: 'no-referrer', headers: { Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.any([context.signal, AbortSignal.timeout(5000)]) });
        void response.body?.cancel().catch(() => undefined);
        context.signal.throwIfAborted();
        if (response.type === 'opaqueredirect' || !response.ok || !/^text\/html\b|^application\/xhtml\+xml\b/i.test(response.headers.get('content-type') ?? ''))
            return unavailable(t.responseUnavailable);
        return { checks: securityHeaderRules(response.headers, url.protocol).map(rule => {
            const id = `security-header-${rule.id}`;
            const reason = t.reasons[rule.reason];
            return pageCheck(id, t.headers[rule.id], rule.state, reason,
                { issues: rule.state === 'warn' ? [issue(context, id, `${reason} ${t.anonymous}`)] : [] });
        }) };
    } catch { context.signal.throwIfAborted(); return unavailable(t.requestUnavailable); }
}
