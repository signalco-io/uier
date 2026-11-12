import { redactName } from './redactName';
import type { CheckState } from '../types';

export type HeaderReason = 'cspMissing' | 'cspReview' | 'cspWeak' | 'hstsHttps' | 'hstsEnabled' | 'hstsMissing' | 'hstsDisabled'
    | 'mimeEnabled' | 'mimeMissing' | 'frameRestricted' | 'frameBroad' | 'frameReview' | 'frameMissing'
    | 'referrerRestricted' | 'referrerBroad' | 'referrerMissing' | 'referrerInvalid';
export type HeaderRule = { id: 'csp' | 'hsts' | 'mime' | 'frames' | 'referrer'; state: CheckState; reason: HeaderReason };

/** First occurrence wins within each CSP policy. Multiple policies are enforced together. No nonce, hash or URL is retained. */
function policies(value: string) {
    return value.split(',').map(policy => {
        const directives = new Map<string, string[]>();
        for (const part of policy.split(';')) {
            const [name, ...tokens] = part.trim().split(/\s+/);
            if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), tokens);
        }
        return directives;
    });
}
const restrictedAncestors = (tokens: string[]) => tokens.length === 1 && tokens[0] === "'none'"
    || tokens.length > 0 && tokens.every(token => token === "'self'" || /^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(token));

/** Conservative header observations, not a CSP bypass evaluator or a security grade. */
export function securityHeaderRules(headers: Headers, protocol: string): HeaderRule[] {
    const csp = headers.get('content-security-policy') ?? '';
    const parsed = csp.length <= 16_384 ? policies(csp) : [];
    const scriptPolicies = parsed.map(policy => policy.get('script-src-elem') ?? policy.get('script-src') ?? policy.get('default-src')).filter(tokens => tokens !== undefined);
    const evalPolicies = parsed.map(policy => policy.get('script-src') ?? policy.get('default-src'));
    const weak = evalPolicies.some(tokens => tokens?.includes("'unsafe-eval'")) || scriptPolicies.some(tokens => tokens.includes("'unsafe-inline'")
        && !tokens.some(token => /^'(?:nonce-|sha(?:256|384|512)-)/.test(token)));
    const ancestors = parsed.map(policy => policy.get('frame-ancestors')).filter(tokens => tokens !== undefined);
    const frame = headers.get('x-frame-options')?.trim().toUpperCase();
    const hsts = headers.get('strict-transport-security');
    const ages = hsts?.split(';').map(value => /^\s*max-age\s*=\s*(?:"(\d+)"|(\d+))\s*$/i.exec(value)).filter(match => match !== null) ?? [];
    const age = ages.length === 1 && hsts?.split(';').filter(part => /^\s*max-age\b/i.test(part)).length === 1 ? Number(ages[0]![1] ?? ages[0]![2]) : NaN;
    const referrer = headers.get('referrer-policy');
    const knownReferrers = ['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url'];
    const effectiveReferrer = referrer?.split(',').map(value => value.trim().toLowerCase()).filter(value => knownReferrers.includes(value)).at(-1);
    return [
        { id: 'csp', state: !csp || weak ? 'warn' : 'none', reason: !csp ? 'cspMissing' : weak ? 'cspWeak' : 'cspReview' },
        { id: 'hsts', state: protocol !== 'https:' ? 'none' : Number.isSafeInteger(age) && age > 0 ? 'pass' : 'warn',
            reason: protocol !== 'https:' ? 'hstsHttps' : !hsts ? 'hstsMissing' : Number.isSafeInteger(age) && age > 0 ? 'hstsEnabled' : 'hstsDisabled' },
        { id: 'mime', state: headers.get('x-content-type-options')?.trim().toLowerCase() === 'nosniff' ? 'pass' : 'warn',
            reason: headers.get('x-content-type-options')?.trim().toLowerCase() === 'nosniff' ? 'mimeEnabled' : 'mimeMissing' },
        // An enforced frame-ancestors directive overrides X-Frame-Options. Unknown syntax stays undecided.
        { id: 'frames', state: csp.length > 16_384 ? 'none' : ancestors.some(restrictedAncestors) ? 'pass' : ancestors.length ? 'none' : frame === 'DENY' || frame === 'SAMEORIGIN' ? 'pass' : 'warn',
            reason: csp.length > 16_384 ? 'frameReview' : ancestors.some(restrictedAncestors) ? 'frameRestricted' : ancestors.some(tokens => tokens.some(token => ['*', 'http:', 'https:'].includes(token))) ? 'frameBroad'
                : ancestors.length ? 'frameReview' : frame === 'DENY' || frame === 'SAMEORIGIN' ? 'frameRestricted' : 'frameMissing' },
        { id: 'referrer', state: !referrer ? 'none' : !effectiveReferrer || ['unsafe-url', 'no-referrer-when-downgrade'].includes(effectiveReferrer) ? 'warn' : 'pass',
            reason: !referrer ? 'referrerMissing' : !effectiveReferrer ? 'referrerInvalid' : ['unsafe-url', 'no-referrer-when-downgrade'].includes(effectiveReferrer) ? 'referrerBroad' : 'referrerRestricted' }
    ];
}

/** Do not replay action or credential-bearing addresses, even if the page itself was reached with GET. */
export function safeHeaderAddress(address: URL) {
    if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password) return false;
    let written = `${address.pathname}${address.search}`;
    for (let pass = 0; pass < 3; pass++) {
        try { const decoded = decodeURIComponent(written); if (decoded === written) break; written = decoded; } catch { return false; }
    }
    return !/(?:^|[^a-z0-9])(?:log[-_]?out|sign[-_]?out|delete|remove|destroy|unsubscribe|cancel|revoke|deactivate|activate|purge|reset|confirm|approve|reject|accept|decline|verify|nonce|csrf|token|password|secret|signature|authorization|auth|code|key|sig)(?:$|[^a-z0-9])/i.test(written);
}

/** Only host/path metadata, with identifiers shortened. Never credentials, query, fragment, cookie value or script text. */
export function securityAddress(value: string) {
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol)) return url.protocol;
        return `${url.origin}${url.pathname.split('/').map(part => { try { return redactName(decodeURIComponent(part)); } catch { return '…'; } }).join('/')}`.slice(0, 240);
    } catch { return ''; }
}


/** Review-link controls belong to uier, not to the page request. Never replay the single-use sign-in code. */
export function headerRequestAddress(current: URL): URL | undefined {
    const address = new URL(current.href);
    // Preserve the page's raw query encoding/order (including signed query strings).
    const controls = new Set(['toolbar-code', 'uier-token', 'uier-comment', 'review']);
    address.search = address.search.slice(1).split('&').filter(part => {
        try { return !controls.has(decodeURIComponent(part.split('=', 1)[0]!.replaceAll('+', ' '))); }
        catch { return true; }
    }).join('&');
    address.hash = '';
    return safeHeaderAddress(address) ? address : undefined;
}
