/** Shared browser/server contract for opt-in review views. Defaults retain pathname-only identity. */
export type PageStatePolicy = { queryParameters: string[]; hashRouting: boolean };
export const defaultPageStatePolicy: PageStatePolicy = { queryParameters: [], hashRouting: false };
export const maxPageKeyLength = 2048;

/** Reserved, tracking and identity/credential fields can never be allowlisted. */
export function isMeaningfulQueryKey(key: string) {
    return /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key)
        && !/^(?:utm[_.-]|uier[_.-])/i.test(key)
        && !/^(?:review|toolbar-code|code|key|state|uid|user|username|gclid|dclid|fbclid|msclkid|ref|referrer)$/i.test(key)
        && !/(?:token|secret|password|passcode|session|auth|email|credential|api.?key|access.?key|signature|nonce|login|user.?id)/i.test(key);
}

export function pageStatePolicy(value?: Partial<PageStatePolicy> | null): PageStatePolicy {
    return {
        queryParameters: [...new Set((Array.isArray(value?.queryParameters) ? value.queryParameters : [])
            .filter((key): key is string => typeof key === 'string' && isMeaningfulQueryKey(key)))].sort().slice(0, 12),
        hashRouting: value?.hashRouting === true
    };
}

function pathPart(path: string) {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path)) return '/';
    try {
        const normalized = new URL(path, 'https://page-state.invalid').pathname.replace(/\/+$/, '');
        return (normalized || '/').replace(/%[a-f\d]{2}/gi, escape => escape.toUpperCase());
    } catch { return '/'; }
}

function safeValue(value: string) {
    return value.length <= 128 && /^[\p{L}\p{N} _.,:+/-]*$/u.test(value)
        && !value.includes('://') && !/^eyJ[A-Za-z0-9_-]+\./.test(value)
        && !/^[A-Za-z0-9_-]{40,}$/.test(value);
}

function safeHashPath(pathname: string) {
    try {
        const decoded = decodeURIComponent(pathname);
        return !/[\p{Cc}\p{Cf}@\\]/u.test(decoded)
            && !/(?:^|\/)(?:token|secret|session|auth|reset-password)(?:\/|$)/i.test(decoded)
            && !decoded.split('/').some(segment => /^[A-Za-z0-9_-]{40,}$/.test(segment));
    } catch { return false; }
}

function queryPart(params: URLSearchParams, policy: PageStatePolicy) {
    const selected = new URLSearchParams();
    for (const key of policy.queryParameters) {
        for (const value of [...new Set(params.getAll(key).filter(safeValue))].sort().slice(0, 5)) selected.append(key, value);
    }
    const query = selected.toString();
    return query ? `?${query}` : '';
}

/** A canonical relative URL: sorted approved query values and optional #/ or #!/ routes. */
export function pagePath(input: string, value?: Partial<PageStatePolicy> | null) {
    const policy = pageStatePolicy(value);
    if (!input.startsWith('/') || input.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(input)) return '/';
    const url = new URL(input, 'https://page-state.invalid');
    const pathname = pathPart(url.pathname);
    let hash = '';
    if (policy.hashRouting && /^#!?\//.test(url.hash)) {
        const route = url.hash.replace(/^#!/, '#').slice(1).split('#', 1)[0]!;
        if (!route.startsWith('//') && !route.includes('\\')) {
            const routed = new URL(route, 'https://page-state.invalid');
            if (safeHashPath(routed.pathname)) hash = `${url.hash.startsWith('#!/') ? '#!' : '#'}${pathPart(routed.pathname)}${queryPart(routed.searchParams, policy)}`;
        }
    }
    const result = `${pathname}${queryPart(url.searchParams, policy)}${hash}`;
    return result.length <= maxPageKeyLength ? result : pathname;
}

/** Records marked v1 were filtered at creation. Preserve their approved view after policy changes. */
export function storedPagePath(input: string, version?: number) {
    if (version !== 1) {
        if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\')) return '/';
        return input.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/';
    }
    try {
        const url = new URL(input, 'https://page-state.invalid');
        const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '';
        return pagePath(input, { queryParameters: [...url.searchParams.keys(), ...new URLSearchParams(hashQuery).keys()], hashRouting: true });
    } catch { return '/'; }
}
