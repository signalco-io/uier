const maxBytes = 4 * 1024 * 1024;

export default {
    async email(message, env) {
        const route = env.UIER_PROOF_EMAIL_ALIAS;
        const recipient = message.to;
        if (!route || !env.UIER_PROOF_EMAIL_SECRET || !env.UIER_PROOF_APP_ORIGIN)
            throw new Error('Proof email ingress is missing required configuration.');
        const [local, host, extra] = recipient.toLowerCase().split('@');
        const [alias, detail, suffix] = (local ?? '').split('+');
        if (extra !== undefined || suffix !== undefined || route !== alias + '@' + host || !/^[a-f0-9]{40}$/.test(detail ?? '')) {
            message.setReject('Unknown test review address.');
            return;
        }
        if (message.rawSize > maxBytes) { message.setReject('The message exceeds 4 MB.'); return; }
        const headers = new Headers({ Authorization: 'Bearer ' + env.UIER_PROOF_EMAIL_SECRET,
            'Content-Type': 'message/rfc822', 'X-Uier-Envelope-To': recipient });
        if (env.UIER_PROOF_VERCEL_BYPASS) headers.set('x-vercel-protection-bypass', env.UIER_PROOF_VERCEL_BYPASS);
        const response = await fetch(new URL('/api/proof-mail', env.UIER_PROOF_APP_ORIGIN), {
            method: 'POST', headers, body: message.raw, redirect: 'error', signal: AbortSignal.timeout(100_000)
        });
        if (response.ok) return;
        if ([400, 403, 404, 413, 415, 422].includes(response.status)) {
            message.setReject('This review address or message is unavailable.');
            return;
        }
        throw new Error('The proof application could not accept this delivery.');
    }
};
