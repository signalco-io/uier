import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser, findUserByEmail } from '../src/lib/app/users';
import { ensureOwnWorkspace, getMember, getWorkspace } from '../src/lib/app/workspaces';
import { changeTeamState, listAccessEvents, saveTeam } from '../src/lib/app/teams';
import { INVITATION_TTL_SECONDS, removeMember, revokeInvitation } from '../src/lib/app/invitations';
import { bumpAccessGeneration, mutateAccess } from '../src/lib/app/accessMutations';
import {
    addWorkspaceDomain,
    domainJoinOffers,
    emailDomain,
    emailDomainSchema,
    hasDomainJoinOffer,
    isPublicEmailDomain,
    joinWorkspaceByDomain,
    listWorkspaceDomains,
    removeWorkspaceDomain,
    suggestedDomain,
    updateWorkspaceDomainTeams
} from '../src/lib/app/workspaceDomains';
import { joinNextPath, signInDestination } from '../src/lib/app/signInDestination';
import { describeAccessEvent, type ActivityNames } from '../src/components/app/teams/activityText';
import { domainActionSchema } from '../app/(rest)/(app)/app/(shell)/workspace/(tabs)/settings/domainActionSchemas';
import { parseActionInput } from '../src/lib/app/validation';
import { UserFacingError } from '../src/lib/app/actionErrors';
import { MAX_WORKSPACE_DOMAINS } from '../src/lib/app/limits';
import {
    memberId,
    workspacePk,
    type DbAccessEvent,
    type DbDomainWorkspace,
    type DbInvitation,
    type DbMember,
    type DbUser,
    type DbWorkspaceDomain
} from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProjectPolicy';
import { beginGoogleSignIn, finishGoogleSignIn } from '../src/lib/app/google/signIn';
import { googleSubject, startGoogleStub, type GoogleStub, type StubGoogleIdentity } from './support/googleStub';

// Email domains of a workspace (`workspaceDomains.ts`): who can add one, which sign-ins match, and what
// joining through one does. Every rule here has a test.

const managedEnv = ['UIER_LOCAL', 'VERCEL', 'VERCEL_ENV', 'UIER_DEPLOYMENT_ENV', 'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_AUTHORIZE_URL', 'GOOGLE_OAUTH_TOKEN_URL', 'GOOGLE_OAUTH_ISSUER'];
const saved = Object.fromEntries(managedEnv.map(name => [name, process.env[name]]));
const test = base.extend<{ google: GoogleStub }>({ google: async ({}, use) => {
    const stub = await startGoogleStub();
    Object.assign(process.env, { GOOGLE_CLIENT_ID: stub.clientId, GOOGLE_CLIENT_SECRET: stub.clientSecret,
        GOOGLE_OAUTH_AUTHORIZE_URL: `${stub.url}/o/oauth2/v2/auth`, GOOGLE_OAUTH_TOKEN_URL: `${stub.url}/token`, GOOGLE_OAUTH_ISSUER: stub.url });
    try { await use(stub); } finally { await stub.close(); }
} });

test.beforeAll(() => {
    for (const name of ['VERCEL', 'VERCEL_ENV', 'UIER_DEPLOYMENT_ENV']) delete process.env[name];
    process.env.UIER_LOCAL = '1';
});
test.afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
});

const short = () => randomUUID().slice(0, 8);
/** A new domain for every test: the store is shared by the tests of this worker */
const newDomain = () => `d${short()}.example`;
const person = (domain: string, label = 'maya') => findOrCreateUser(`${label}-${short()}@${domain}`);

async function contextOf(user: DbUser, workspaceId: string): Promise<AppContext> {
    const [member, workspace] = await Promise.all([getMember(workspaceId, user.id), getWorkspace(workspaceId)]);
    return { user, member: member!, workspace: workspace!, isAdmin: member?.role === 'admin', memberships: [{ member: member!, workspace: workspace! }] };
}

/** An admin at `domain` in a workspace of their own */
async function adminAt(domain: string, label = 'admin') {
    const user = await person(domain, label);
    const member = await ensureOwnWorkspace(user);
    return await contextOf(user, member.workspaceId);
}

/** Puts an existing account into the workspace directly, as an invitation acceptance would */
async function addMember(context: AppContext, user: DbUser, role: DbMember['role'] = 'commenter') {
    const member: DbMember = { ...context.member, id: memberId(user.id), userId: user.id, email: user.email, role, projects: [], createdAt: new Date().toISOString() };
    await getAppStore().create(member);
    return await contextOf(user, context.workspace.id);
}

/** `inviteToWorkspace`'s write, without its email (the link needs a request): the invitation and the recipient's new generation */
async function invite(context: AppContext, email: string) {
    const workspaceId = context.workspace.id;
    const now = Date.now();
    const invitation: DbInvitation = { type: 'invitation', id: `invitation_${short()}`, pk: workspacePk(workspaceId), workspaceId, email,
        role: 'commenter', projects: 'all', invitedBy: context.user.id, createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + INVITATION_TTL_SECONDS * 1000).toISOString(), tokenHash: randomUUID(), ttl: INVITATION_TTL_SECONDS };
    await mutateAccess(workspaceId, context.user.id, async store => {
        const generation = await bumpAccessGeneration(workspaceId, email, store);
        invitation.recipientGeneration = generation.doc.generation;
        return { operations: [generation, { kind: 'create', doc: invitation }], action: 'invitation.created', targetIds: [invitation.id],
            before: {}, after: { role: 'commenter', projects: 'all', teamIds: [] } };
    });
    return invitation;
}

const events = async (workspaceId: string) => (await listAccessEvents(workspaceId)).events;
const lookup = (domain: string, workspaceId: string) => getAppStore().get<DbDomainWorkspace>(`domain:${domain}`, workspaceId);

test('domains are parsed exactly and public email providers are recognized', () => {
    expect(emailDomainSchema.parse(' @Example.COM. ')).toBe('example.com');
    expect(emailDomainSchema.parse('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
    for (const invalid of ['', 'example', '.example.com', 'example..com', '-a.example', 'a-.example', 'http://example.com',
        'maya@example.com', 'example.com/path', '10.0.0.1', 'exa mple.com', 'bücher.example', `${'a'.repeat(64)}.example`])
        expect(emailDomainSchema.safeParse(invalid).success, invalid).toBe(false);

    expect(emailDomain('maya@example.com')).toBe('example.com');
    expect(emailDomain('maya@eu.example.com')).toBe('eu.example.com');
    expect(emailDomain('"a@b"@example.com')).toBe('example.com');
    expect(emailDomain('no-at-sign')).toBeNull();

    for (const domain of ['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.de', 'hotmail.co.uk', 'yahoo.co.uk', 'icloud.com',
        'proton.me', 'gmx.net', 'yandex.com.tr', 'mailinator.com'])
        expect(isPublicEmailDomain(domain), domain).toBe(true);
    // A provider's name as a company's subdomain is not the provider
    for (const domain of ['example.com', 'live.example.com', 'outlook.acme.example', 'acme-gmail.com', 'gmail.com.example'])
        expect(isPublicEmailDomain(domain), domain).toBe(false);
});

test('an admin adds only the domain of their own email, and it is suggested until added', async () => {
    const domain = newDomain();
    const context = await adminAt(domain);
    expect(suggestedDomain(context.user.email, [])).toBe(domain);

    for (const other of ['other.example', domain.replace(/^d/, 'x'), `eu.${domain}`, `${domain}.evil.example`, `my${domain}`])
        await expect(addWorkspaceDomain(context, { domain: other, teamIds: [] }), other).rejects.toThrow(`sign in with an email address at ${other}`);
    // An address at a subdomain does not verify its parent domain either
    const subdomainAdmin = await adminAt(`eu.${domain}`);
    expect(suggestedDomain(subdomainAdmin.user.email, [])).toBe(`eu.${domain}`);
    await expect(addWorkspaceDomain(subdomainAdmin, { domain, teamIds: [] })).rejects.toThrow(`sign in with an email address at ${domain}`);
    expect(await listWorkspaceDomains(context.workspace.id)).toEqual([]);

    expect(await addWorkspaceDomain(context, { domain: ` @${domain.toUpperCase()}. `, teamIds: [] })).toBe(domain);
    const [added] = await listWorkspaceDomains(context.workspace.id);
    expect(added).toMatchObject({ type: 'workspace-domain', domain, workspaceId: context.workspace.id, teamIds: [],
        verification: 'admin-email', addedBy: context.user.id });
    expect((await lookup(domain, context.workspace.id))?.doc.workspaceId).toBe(context.workspace.id);
    expect(suggestedDomain(context.user.email, [added!])).toBeNull();
    await expect(addWorkspaceDomain(context, { domain, teamIds: [] })).rejects.toThrow(`${domain} is already added.`);

    const [event] = (await events(context.workspace.id)).filter(event => event.action === 'domain.added');
    expect(event).toMatchObject({ actorId: context.user.id, targetIds: [`domain_${domain}`], before: {}, after: { domain, teamIds: [] } });
    expect((await getWorkspace(context.workspace.id))?.accessRevision).toBe(1);
});

test('public email providers are refused even for an admin with an address there', async () => {
    for (const provider of ['gmail.com', 'outlook.de', 'yahoo.co.uk', 'mailinator.com']) {
        const context = await adminAt(provider);
        expect(suggestedDomain(context.user.email, []), provider).toBeNull();
        await expect(addWorkspaceDomain(context, { domain: provider, teamIds: [] }), provider).rejects.toThrow('is a public email provider');
        expect(await listWorkspaceDomains(context.workspace.id)).toEqual([]);
    }
});

test('only current admins add, change or remove domains, and never in the uier workspace', async () => {
    const domain = newDomain();
    const owner = await adminAt(domain);
    const commenter = await addMember(owner, await person(domain, 'commenter'));
    await expect(addWorkspaceDomain(commenter, { domain, teamIds: [] })).rejects.toThrow('Only workspace admins can add domains.');
    // A context that claims admin is rechecked against the stored membership
    await expect(addWorkspaceDomain({ ...commenter, isAdmin: true }, { domain, teamIds: [] })).rejects.toThrow('your access changed');
    expect(await listWorkspaceDomains(owner.workspace.id)).toEqual([]);

    await addWorkspaceDomain(owner, { domain, teamIds: [] });
    await expect(updateWorkspaceDomainTeams(commenter, { domain, teamIds: [] })).rejects.toThrow('Only workspace admins can change domains.');
    await expect(removeWorkspaceDomain(commenter, domain)).rejects.toThrow('Only workspace admins can remove domains.');
    await expect(removeWorkspaceDomain({ ...commenter, isAdmin: true }, domain)).rejects.toThrow('your access changed');
    expect(await listWorkspaceDomains(owner.workspace.id)).toHaveLength(1);

    const workspace = (await getWorkspace(PUBLIC_WORKSPACE_ID)) ?? owner.workspace;
    await expect(addWorkspaceDomain({ ...owner, workspace: { ...workspace, id: PUBLIC_WORKSPACE_ID } }, { domain, teamIds: [] }))
        .rejects.toThrow('Everyone joins the uier workspace automatically.');
});

test('a workspace has at most ten domains, and only active teams of its own are chosen', async () => {
    const domain = newDomain();
    const context = await adminAt(domain);
    await expect(addWorkspaceDomain(context, { domain, teamIds: ['team_000000000000000000000'] })).rejects.toThrow('A selected team is unavailable.');
    const other = await adminAt(newDomain());
    const foreign = await saveTeam(other, { name: 'Elsewhere' });
    await expect(addWorkspaceDomain(context, { domain, teamIds: [foreign] })).rejects.toThrow('A selected team is unavailable.');
    const archived = await saveTeam(context, { name: 'Old' });
    await changeTeamState(context, archived, 'archived');
    await expect(addWorkspaceDomain(context, { domain, teamIds: [archived] })).rejects.toThrow('A selected team is unavailable.');

    const store = getAppStore();
    for (let index = 0; index < MAX_WORKSPACE_DOMAINS; index++) {
        const filler = `f${index}.${newDomain()}`;
        await store.create<DbWorkspaceDomain>({ type: 'workspace-domain', id: `domain_${filler}`, pk: workspacePk(context.workspace.id),
            workspaceId: context.workspace.id, domain: filler, teamIds: [], teamGenerations: {}, verification: 'admin-email',
            addedBy: context.user.id, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    await expect(addWorkspaceDomain(context, { domain, teamIds: [] })).rejects.toThrow(`up to ${MAX_WORKSPACE_DOMAINS} domains`);
});

test('a sign-in matches the exact domain of the account email, never a subdomain or look-alike', async () => {
    const domain = newDomain();
    const context = await adminAt(domain);
    await saveTeam(context, { name: 'Design' });
    await addWorkspaceDomain(context, { domain, teamIds: [] });

    const maya = await person(domain);
    expect(await hasDomainJoinOffer(maya)).toBe(true);
    const offers = await domainJoinOffers(maya);
    // The workspace's name, the domain and who added it: nothing about its people, teams or projects
    expect(offers).toEqual([{ workspaceId: context.workspace.id, workspaceName: context.workspace.name, domain, addedByName: context.user.name }]);

    for (const email of [`maya@eu.${domain}`, `maya@${domain}.evil.example`, `maya@x${domain}`, `maya@${domain.replace('.example', '.test')}`,
        `${domain}@other.example`]) {
        const other = await findOrCreateUser(email);
        expect(await hasDomainJoinOffer(other), email).toBe(false);
        expect(await domainJoinOffers(other), email).toEqual([]);
        await expect(joinWorkspaceByDomain(other, context.workspace.id), email).rejects.toThrow('no longer open to your email domain');
        expect(await getMember(context.workspace.id, other.id), email).toBeNull();
    }
});

test('a public provider domain never matches, even with records written around the checks', async () => {
    const context = await adminAt(newDomain());
    const store = getAppStore();
    const now = new Date().toISOString();
    await store.create<DbDomainWorkspace>({ type: 'domain-workspace', id: context.workspace.id, pk: 'domain:gmail.com', workspaceId: context.workspace.id, createdAt: now });
    await store.create<DbWorkspaceDomain>({ type: 'workspace-domain', id: 'domain_gmail.com', pk: workspacePk(context.workspace.id),
        workspaceId: context.workspace.id, domain: 'gmail.com', teamIds: [], teamGenerations: {}, verification: 'admin-email',
        addedBy: context.user.id, addedAt: now, updatedAt: now });
    const gmail = await findOrCreateUser(`maya-${short()}@gmail.com`);
    expect(await hasDomainJoinOffer(gmail)).toBe(false);
    await expect(joinWorkspaceByDomain(gmail, context.workspace.id)).rejects.toThrow('no longer open to your email domain');
    expect(await getMember(context.workspace.id, gmail.id)).toBeNull();
});

test('nobody joins on sign-in: the sign-in goes to the join page, and only the click adds them', async () => {
    const domain = newDomain();
    const context = await adminAt(domain);
    await addWorkspaceDomain(context, { domain, teamIds: [] });
    const maya = await person(domain);

    expect(await signInDestination(maya, '/app/welcome')).toBe('/app/join?next=%2Fapp%2Fwelcome');
    expect(await signInDestination(maya.id, '/app/projects/abc123def456?x=1')).toBe(`/app/join?${new URLSearchParams({ next: '/app/projects/abc123def456?x=1' })}`);
    // The join page itself and an account without an offer continue as before
    expect(await signInDestination(maya, '/app/join?next=%2Fapp')).toBe('/app/join?next=%2Fapp');
    expect(await signInDestination(await person(newDomain()), '/app')).toBe('/app');
    expect(await getMember(context.workspace.id, maya.id)).toBeNull();

    expect(joinNextPath('/app/welcome')).toBe('/app/welcome');
    for (const unsafe of ['https://evil.example/app', '//evil.example', '/app/join', '/app/join?next=/app', '/brand', undefined, 42])
        expect(joinNextPath(unsafe), String(unsafe)).toBe('/app');
});

test('joining adds a commenter with the domain teams that still apply, once, with an Activity event', async () => {
    const domain = newDomain();
    const context = await adminAt(domain);
    const [design, support, archived] = [await saveTeam(context, { name: 'Design' }), await saveTeam(context, { name: 'Support' }), await saveTeam(context, { name: 'Archived' })];
    await addWorkspaceDomain(context, { domain, teamIds: [design, archived] });
    await updateWorkspaceDomainTeams(context, { domain, teamIds: [design, support, archived] });
    // Archived, then restored: a restored team starts empty and does not come back through the domain
    await changeTeamState(context, archived, 'archived');
    await changeTeamState(context, archived, 'active');

    const maya = await person(domain);
    const member = await joinWorkspaceByDomain(maya, context.workspace.id);
    expect(member).toMatchObject({ userId: maya.id, email: maya.email, role: 'commenter', projects: [], teamIds: [design, support], relationship: 'internal' });
    expect(await getMember(context.workspace.id, maya.id)).toEqual(member);
    expect(await hasDomainJoinOffer(maya)).toBe(false);

    // A second click (or another tab) changes nothing
    expect(await joinWorkspaceByDomain(maya, context.workspace.id)).toEqual(member);
    const joined = (await events(context.workspace.id)).filter(event => event.action === 'member.joined');
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ actorId: maya.id, targetIds: [member.id, design, support],
        after: { domain, role: 'commenter', projects: [], teamIds: [design, support] } });
});

test('people already in the workspace, invited, or removed by an admin get no offer and cannot join', async () => {
    const domain = newDomain();
    const context = await adminAt(domain);
    await addWorkspaceDomain(context, { domain, teamIds: [] });

    // An admin's own workspace offers nothing to them
    expect(await hasDomainJoinOffer(context.user)).toBe(false);
    const existing = await person(domain, 'existing');
    await addMember(context, existing);
    expect(await hasDomainJoinOffer(existing)).toBe(false);

    // A pending invitation is accepted from its link instead; a revoked one stays the admin's decision
    const invited = await person(domain, 'invited');
    const invitation = await invite(context, invited.email);
    expect(await hasDomainJoinOffer(invited)).toBe(false);
    await expect(joinWorkspaceByDomain(invited, context.workspace.id)).rejects.toThrow('no longer open');
    await revokeInvitation(context, invitation.id);
    expect(await hasDomainJoinOffer(invited)).toBe(false);
    expect(await getMember(context.workspace.id, invited.id)).toBeNull();

    // A removal is never undone by the domain
    const removed = await person(domain, 'removed');
    await joinWorkspaceByDomain(removed, context.workspace.id);
    await removeMember(await contextOf(context.user, context.workspace.id), removed.id);
    expect(await hasDomainJoinOffer(removed)).toBe(false);
    await expect(joinWorkspaceByDomain(removed, context.workspace.id)).rejects.toThrow('no longer open');
    expect(await getMember(context.workspace.id, removed.id)).toBeNull();
});

test('removing a domain stops new joins at once; people who joined stay, and it can be added again', async () => {
    const domain = newDomain();
    const context = await adminAt(domain);
    const second = await addMember(context, await person(newDomain(), 'second-admin'), 'admin');
    await addWorkspaceDomain(context, { domain, teamIds: [] });
    const joined = await person(domain, 'joined');
    await joinWorkspaceByDomain(joined, context.workspace.id);
    const later = await person(domain, 'later');
    expect(await hasDomainJoinOffer(later)).toBe(true);

    // Any admin can remove it, also one with an email elsewhere
    await removeWorkspaceDomain(second, domain);
    expect(await listWorkspaceDomains(context.workspace.id)).toEqual([]);
    expect(await lookup(domain, context.workspace.id)).toBeNull();
    expect(await hasDomainJoinOffer(later)).toBe(false);
    await expect(joinWorkspaceByDomain(later, context.workspace.id)).rejects.toThrow('no longer open');
    expect(await getMember(context.workspace.id, joined.id)).not.toBeNull();
    await expect(updateWorkspaceDomainTeams(context, { domain, teamIds: [] })).rejects.toThrow(`${domain} was removed.`);

    const removedEvents = (await events(context.workspace.id)).filter(event => event.action === 'domain.removed');
    expect(removedEvents).toHaveLength(1);
    expect(removedEvents[0]).toMatchObject({ actorId: second.user.id, before: { domain, teamIds: [] }, after: {} });
    // Removing again is a no-op without another event
    await removeWorkspaceDomain(second, domain);
    expect((await events(context.workspace.id)).filter(event => event.action === 'domain.removed')).toHaveLength(1);

    await addWorkspaceDomain(context, { domain, teamIds: [] });
    expect(await hasDomainJoinOffer(later)).toBe(true);
});

test('a lookup without its workspace domain matches nobody', async () => {
    const domain = newDomain();
    const context = await adminAt(domain);
    await getAppStore().create<DbDomainWorkspace>({ type: 'domain-workspace', id: context.workspace.id, pk: `domain:${domain}`,
        workspaceId: context.workspace.id, createdAt: new Date().toISOString() });
    const maya = await person(domain);
    expect(await hasDomainJoinOffer(maya)).toBe(false);
    await expect(joinWorkspaceByDomain(maya, context.workspace.id)).rejects.toThrow('no longer open');
});

test('several workspaces can offer one domain; each join is the person’s own choice', async () => {
    const domain = newDomain();
    const first = await adminAt(domain, 'first');
    const second = await adminAt(domain, 'second');
    await addWorkspaceDomain(first, { domain, teamIds: [] });
    await addWorkspaceDomain(second, { domain, teamIds: [] });
    const maya = await person(domain);
    expect((await domainJoinOffers(maya)).map(offer => offer.workspaceId).sort()).toEqual([first.workspace.id, second.workspace.id].sort());

    await joinWorkspaceByDomain(maya, first.workspace.id);
    expect(await getMember(second.workspace.id, maya.id)).toBeNull();
    expect((await domainJoinOffers(maya)).map(offer => offer.workspaceId)).toEqual([second.workspace.id]);
    // A workspace that offers another domain is not joinable by naming its id
    const elsewhere = await adminAt(newDomain());
    await addWorkspaceDomain(elsewhere, { domain: emailDomain(elsewhere.user.email)!, teamIds: [] });
    await expect(joinWorkspaceByDomain(maya, elsewhere.workspace.id)).rejects.toThrow('no longer open');
    await expect(joinWorkspaceByDomain(maya, PUBLIC_WORKSPACE_ID)).rejects.toThrow('no longer open');
    await expect(joinWorkspaceByDomain(maya, 'w_missing')).rejects.toThrow('no longer open');
});

test('an unverified Google address never becomes an account, so it never matches a domain', async ({ google }) => {
    const domain = newDomain();
    const context = await adminAt(domain);
    await addWorkspaceDomain(context, { domain, teamIds: [] });
    const viaGoogle = async (identity: StubGoogleIdentity) => {
        const started = await beginGoogleSignIn({ baseUrl: 'http://localhost:4004' });
        const { code, state } = google.approve(started.url, identity);
        return await finishGoogleSignIn({ binding: started.binding, state, code, error: null, baseUrl: 'http://localhost:4004', session: null });
    };

    const unverified = `maya-${short()}@${domain}`;
    expect(await viaGoogle({ sub: googleSubject(), email: unverified, email_verified: false, hd: domain })).toMatchObject({ kind: 'problem', problem: 'unverified' });
    // A verified address outside Gmail and its own Workspace domain proves the inbox first
    expect(await viaGoogle({ sub: googleSubject(), email: unverified, email_verified: true })).toMatchObject({ kind: 'confirm_email' });
    expect(await findUserByEmail(unverified)).toBeNull();

    // Google is authoritative for its Workspace domain: that account can join
    const outcome = await viaGoogle({ sub: googleSubject(), email: unverified, email_verified: true, hd: domain });
    expect(outcome).toMatchObject({ kind: 'signed_in' });
    const user = (await findUserByEmail(unverified))!;
    expect(await signInDestination((outcome as { userId: string }).userId, '/app')).toBe('/app/join?next=%2Fapp');
    expect(await hasDomainJoinOffer(user)).toBe(true);
});

test('domain events read as sentences in Activity', () => {
    const names: ActivityNames = {
        people: new Map([['u_maya', 'Maya'], ['u_admin', 'Ada']]),
        invitations: new Map(),
        teams: new Map([['team_design', 'Design'], ['team_support', 'Support']]),
        projects: new Map()
    };
    const event = (action: string, actorId: string, before: Record<string, unknown>, after: Record<string, unknown>, targetIds: string[] = []): DbAccessEvent => ({
        type: 'access-event', id: `access_${short()}`, pk: 'workspace:w_test', workspaceId: 'w_test', actorId, at: new Date().toISOString(),
        action, targetIds, before, after, ttl: 1
    });
    expect(describeAccessEvent(event('domain.added', 'u_admin', {}, { domain: 'acme.example', teamIds: ['team_design'] }), names))
        .toEqual({ actor: 'Ada', text: 'added the email domain acme.example', details: ['Teams for people who join: the Design team'] });
    expect(describeAccessEvent(event('domain.updated', 'u_admin', { domain: 'acme.example', teamIds: ['team_design'] }, { domain: 'acme.example', teamIds: ['team_support'] }), names))
        .toEqual({ actor: 'Ada', text: 'changed the teams for acme.example', details: ['added Support, removed Design'] });
    expect(describeAccessEvent(event('domain.removed', 'u_admin', { domain: 'acme.example', teamIds: [] }, {}), names))
        .toEqual({ actor: 'Ada', text: 'removed the email domain acme.example', details: [] });
    expect(describeAccessEvent(event('member.joined', 'u_maya', {}, { domain: 'acme.example', role: 'commenter', projects: [], teamIds: ['team_design'] }, ['member_u_maya', 'team_design']), names))
        .toEqual({ actor: 'Maya', text: 'joined through acme.example as a commenter', details: ['Teams: the Design team'] });
});

test('the remove action validates its argument before it is used', () => {
    expect(parseActionInput(domainActionSchema, { domain: 'Acme.example' })).toEqual({ domain: 'acme.example' });
    for (const domain of [{}, [], 'acme', 'https://acme.example', null])
        expect(() => parseActionInput(domainActionSchema, { domain })).toThrow(UserFacingError);
});
