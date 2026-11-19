import project from '../vercel-project.json' with { type: 'json' };

const { orgId, projectId } = project;
const appOrigin = 'https://uier.io';
const vercelHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;
const hostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/;
const deploymentId = /^dpl_[a-zA-Z0-9]+$/;

export function origin(value, setting) {
    const url = URL.parse(value ?? '');
    if (!url || url.protocol !== 'https:' || url.origin !== value || url.port
        || url.hostname.length > 253 || !hostname.test(url.hostname))
        throw new Error(setting + ' must be a bare HTTPS origin with a DNS hostname.');
    return url;
}

async function api(path, { body, allowMissingAlias = false } = {}) {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error('Missing Vercel project token.');
    const url = new URL(path, 'https://api.vercel.com');
    url.searchParams.set('teamId', orgId);
    let response;
    let payload;
    try {
        response = await fetch(url, {
            method: body ? 'POST' : 'GET',
            headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            redirect: 'error',
            signal: AbortSignal.timeout(15_000)
        });
        payload = await response.text();
    } catch {
        throw new Error('Could not read the Vercel proof operation response.');
    }
    const missingAlias = allowMissingAlias && response.status === 404;
    if (missingAlias && !payload.trim()) return null;

    let data;
    try {
        data = JSON.parse(payload);
    } catch {
        if (response.ok) throw new Error('Vercel did not return a valid response for the proof operation.');
    }
    if (missingAlias && ['not_found', 'alias_not_found'].includes(data?.error?.code)) return null;
    if (!response.ok || !data || data.error)
        throw new Error('Vercel rejected the proof operation (HTTP ' + response.status + '). Check the project token and provider configuration.');
    return data;
}

async function deployment(idOrHost, target) {
    const data = await api('/v13/deployments/' + encodeURIComponent(idOrHost));
    const expectedTarget = target === 'production' ? data.target === 'production' : data.target === null || data.target === 'preview';
    if (!deploymentId.test(data.id) || (data.id !== idOrHost && data.url !== idOrHost)
        || data.projectId !== projectId || (data.team?.id ?? data.ownerId) !== orgId
        || (data.ownerId != null && data.ownerId !== orgId)
        || data.readyState !== 'READY' || data.deletedAt || data.softDeletedByRetention
        || data.customEnvironment || data.customEnvironmentId || !expectedTarget)
        throw new Error('Expected a ready deployment in the uier Vercel team, project and requested target.');
    return data;
}

async function alias(host) {
    const data = await api('/v4/aliases/' + encodeURIComponent(host), { allowMissingAlias: true });
    if (data && (data.alias !== host || data.projectId !== projectId || !deploymentId.test(data.deploymentId)
        || (data.teamId && data.teamId !== orgId) || (data.ownerId && data.ownerId !== orgId)
        || (data.deployment && data.deployment.id !== data.deploymentId)
        || data.deletedAt || data.redirect || data.microfrontends))
        throw new Error('The hostname is already claimed by an unrelated Vercel alias.');
    return data;
}

async function rejectAppDomain(host, dedicated) {
    const endpoint = '/v9/projects/' + projectId + '/domains?limit=100';
    let next;
    for (let page = 0; page < 20; page++) {
        const result = await api(next ? endpoint + '&until=' + next : endpoint);
        if (!Array.isArray(result.domains) || !result.pagination
            || result.domains.some(domain => typeof domain.name !== 'string'))
            throw new Error('Could not verify the Vercel project domain inventory.');
        if (result.domains.some(({ name, apexName }) => name === host || (name.startsWith('*.') && host.endsWith(name.slice(1)))
            || (!dedicated && apexName && (host === apexName || host.endsWith('.' + apexName)))))
            throw new Error('The proof hostname shares an app domain configured on the Vercel project.');
        if (result.pagination.next === null) return;
        if (!Number.isSafeInteger(result.pagination.next) || result.pagination.next === next) break;
        next = result.pagination.next;
    }
    throw new Error('Could not inspect all Vercel project domains.');
}

async function probeRoot(url, dedicated) {
    const probe = headers => fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const bypass = dedicated && process.env.UIER_PROOF_VERCEL_BYPASS?.trim();
    let status;
    let edgeError;
    try {
        let response = await probe();
        if (response.status === 401 && bypass) {
            await response.body?.cancel();
            response = await probe({ 'x-vercel-protection-bypass': bypass });
        }
        status = response.status;
        edgeError = response.headers.has('x-vercel-error');
        await response.body?.cancel();
    } catch {
        throw new Error('Could not reach the isolated proof hostname. Check DNS and TLS.');
    }
    if (status === 401) {
        if (bypass) throw new Error('Vercel rejected the automation bypass for the isolated proof hostname.');
        return false;
    }
    if (status !== 404 || edgeError)
        throw new Error('The isolated proof host must reach the selected app and reject its root with HTTP 404.');
    return true;
}

export async function configureHtml(target, { requirePublished = false } = {}) {
    const setting = 'UIER_PROOF_HTML_ORIGIN_' + target.toUpperCase();
    const url = origin(process.env[setting], setting);
    const host = url.hostname;
    const dedicated = host === 'uier-proof-' + target + '-signalco.vercel.app';
    const other = target === 'preview' ? 'PRODUCTION' : 'PREVIEW';
    if (/(^|\.)(uier\.io|now\.sh|vercel-dns\.com)$/.test(host)
        || (/(^|\.)vercel\.app$/.test(host) && !dedicated)
        || [process.env['UIER_PROOF_HTML_ORIGIN_' + other], process.env.UIER_PROOF_APP_ORIGIN]
            .some(value => URL.parse(value ?? '')?.hostname === host))
        throw new Error('Choose a dedicated proof hostname for this target outside the app origins.');

    const requested = origin(process.env.UIER_PROOF_DEPLOYMENT, 'UIER_PROOF_DEPLOYMENT');
    if (!vercelHost.test(requested.hostname)) throw new Error('Use the exact generated Vercel deployment URL.');
    const wanted = await deployment(requested.hostname, target);
    if (requirePublished && (target !== 'production' || (await alias(new URL(appOrigin).hostname))?.deploymentId !== wanted.id))
        throw new Error('The release deployment does not match the current uier.io production binding.');
    await rejectAppDomain(host, dedicated);

    const existing = await alias(host);
    if (existing && existing.deploymentId !== wanted.id) {
        await deployment(existing.deploymentId, target);
        if (!dedicated && !await probeRoot(url, false))
            throw new Error('Verify the existing custom proof hostname before moving its protected alias.');
    }
    if (existing?.deploymentId !== wanted.id) {
        const assigned = await api('/v2/deployments/' + wanted.id + '/aliases', { body: { alias: host } });
        if (assigned.alias !== host || (assigned.oldDeploymentId && assigned.oldDeploymentId !== existing?.deploymentId)
            || (await alias(host))?.deploymentId !== wanted.id)
            throw new Error('Vercel alias readback did not confirm the intended binding. Check for a concurrent change.');
    }
    if (await probeRoot(url, dedicated)) {
        console.info('Verified the proof alias binding and the isolated app root rejection.');
    } else {
        console.warn('::warning::Proof alias binding verified. Vercel returned HTTP 401. Complete the isolated root and proof QA with authenticated access.');
    }
}

export async function verifyMailOrigin(target) {
    const url = origin(process.env.UIER_PROOF_APP_ORIGIN, 'UIER_PROOF_APP_ORIGIN');
    if ([process.env.UIER_PROOF_HTML_ORIGIN_PREVIEW, process.env.UIER_PROOF_HTML_ORIGIN_PRODUCTION]
        .some(value => URL.parse(value ?? '')?.hostname === url.hostname))
        throw new Error('Use the app deployment for proof mail delivery.');
    if (target === 'production' && url.origin === appOrigin) {
        const binding = await alias(url.hostname);
        if (!binding) throw new Error('Could not verify the current uier.io production binding.');
        await deployment(binding.deploymentId, target);
    } else {
        if (!vercelHost.test(url.hostname)
            || /^uier-proof-(preview|production)-signalco\.vercel\.app$/.test(url.hostname))
            throw new Error('Use an exact generated deployment URL or the uier.io production origin for proof mail.');
        await deployment(url.hostname, target);
    }
    return url.origin;
}

export async function setMailEnvironment(target, address, secret) {
    const path = '/v10/projects/' + projectId + '/env?upsert=true';
    for (const [key, value, type] of [
        ['UIER_PROOF_EMAIL_ALIAS', address, 'encrypted'],
        ['UIER_PROOF_EMAIL_SECRET', secret, 'sensitive']
    ]) {
        const { created, failed } = await api(path, { body: { key, value, type, target: [target] } });
        if (failed?.length || created?.key !== key || created.type !== type
            || created.target?.length !== 1 || created.target[0] !== target)
            throw new Error('Vercel did not confirm the requested proof mail environment variable.');
    }
}
