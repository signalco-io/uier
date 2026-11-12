import type { PageFixture } from './types';

const fixture: PageFixture = {
    body: url => url.pathname.endsWith('/banner') ? '<aside id="CybotCookiebotDialog" aria-label="Cookie preferences"><p>Choose your cookie preferences.</p><button type="button">Review preferences</button></aside>' : '',
    csp: policy => policy.replace("connect-src ", 'connect-src https://www.google-analytics.com ')
};
export default fixture;
