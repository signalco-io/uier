import type { PageFixture } from './types';

const fixture: PageFixture = {
    head: () => '<script src="https://cdn.security.example/lib.js?token=private-script-token-347"></script><script type="application/ld+json" src="https://cdn.security.example/data.json"></script>',
    body: () => '<p>Security check fixture</p>',
    csp: (policy, url) => url.pathname.endsWith('/blocked')
        ? policy.replace(/connect-src [^;]+/, match => match.replace("'self'", ''))
        : `${policy.replace('script-src ', 'script-src https://cdn.security.example ')}; frame-ancestors \'none\'`,
    headers: () => ({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'unsafe-url' }),
};
export default fixture;
