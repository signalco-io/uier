import { AsyncLocalStorage } from 'node:async_hooks';
import { getVercelOidcToken } from '@vercel/oidc';

const requests = new AsyncLocalStorage<Request>();

/** Private Fetch functions do not rely on Next.js to install request context. */
export function withWorkerRequest<T>(request: Request, run: () => Promise<T>) {
    return requests.run(request, run);
}

/** Never copy a request's assertion into process.env or a cross-invocation variable. */
export function vercelAzureAssertion() {
    const assertion = requests.getStore()?.headers.get('x-vercel-oidc-token');
    return assertion ? Promise.resolve(assertion) : getVercelOidcToken();
}
