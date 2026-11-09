import { z } from 'zod';
import type { AppContext } from './context';
import { UserFacingError } from './actionErrors';
import { accessGeneration, mutateAccess } from './accessMutations';
import { MAX_DOMAIN_WORKSPACES, MAX_WORKSPACE_DOMAINS } from './limits';
import {
    memberId,
    workspacePk,
    type DbDomainWorkspace,
    type DbMember,
    type DbUser,
    type DbWorkspaceDomain
} from './model';
import { getAppStore, type AppStore, type StoredDoc } from './store';
import { getTeam, validateTeamIds } from './teams';
import { getUser } from './users';
import { isPersonalEmailDomain } from './welcome';
import { getMember, getWorkspace } from './workspaces';
import { assertMutableWorkspace, PUBLIC_WORKSPACE_ID } from '../comments/publicProjectPolicy';

// Email domains of a workspace: people who sign in with an email at one of them can join it.
//
// - Verified by the adding admin's own account email. Every uier account email is proven: an email code
//   or link, an invitation link, or Google's verified address (gmail.com, or the account's Workspace
//   domain). Unverified provider addresses never become an account, so they never match.
// - The match is exact on the part after the @: `example.com` matches `maya@example.com`, never
//   `maya@eu.example.com`, `maya@example.com.evil.test` or `maya@myexample.com`. A subdomain is a
//   domain of its own.
// - Public email providers (gmail.com, outlook.com, ...) are refused: anyone can have an address there.
// - Several workspaces may offer the same domain. Nobody is added on sign-in: the person sees the
//   workspaces they can join (`/app/join`) and joins with a click, as a commenter with the domain's teams.
// - An admin's earlier decision about the address wins: someone who was invited (pending, expired or
//   revoked) or removed has a recipient generation above zero and needs an invitation.

/** Public email providers and shared inboxes where anyone can get an address */
const sharedInboxDomains = new Set([
    'mailinator.com', 'guerrillamail.com', 'sharklasers.com', 'yopmail.com', '10minutemail.com',
    'temp-mail.org', 'tempmail.com', 'maildrop.cc', 'dispostable.com', 'trashmail.com', 'getnada.com',
    'mailnesia.com', 'throwawaymail.com', 'emailondeck.com'
]);

const domainLabel = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** A domain name: lowercase ASCII labels (IDNs as `xn--`), at least two, the last one not a number */
function isDomainName(value: string) {
    const labels = value.split('.');
    return value.length <= 253 && labels.length >= 2 && labels.every(label => domainLabel.test(label))
        && !/^\d+$/.test(labels.at(-1)!);
}

/** What an admin types or picks: `Example.com`, `@example.com` and `example.com.` are `example.com` */
export const emailDomainSchema = z.string()
    .trim()
    .toLowerCase()
    .transform(value => value.replace(/^@/, '').replace(/\.$/, ''))
    .pipe(z.string().refine(isDomainName, 'Enter a domain, such as example.com.'));

/** The domain of a normalized account email (everything after the last @), or `null` */
export function emailDomain(email: string) {
    const at = email.lastIndexOf('@');
    if (at < 1)
        return null;
    const domain = email.slice(at + 1).toLowerCase();
    return isDomainName(domain) ? domain : null;
}

/** Domains nobody can add: anyone can have an address at a public email provider */
export function isPublicEmailDomain(domain: string) {
    return isPersonalEmailDomain(domain) || sharedInboxDomains.has(domain);
}

const domainDocId = (domain: string) => `domain_${domain}`;
const domainPk = (domain: string) => `domain:${domain}` as const;

/** Why an admin with this email can't add the domain, or `null` when they can */
function addRefusal(domain: string, adminEmail: string) {
    if (isPublicEmailDomain(domain))
        return `${domain} is a public email provider: anyone can have an address there. Add your organization's own domain.`;
    if (emailDomain(adminEmail) !== domain)
        return `To add ${domain}, sign in with an email address at ${domain}. You can add only the domain of your own email.`;
    return null;
}

/** The workspace's domains, by name (admins only) */
export async function listWorkspaceDomains(workspaceId: string, store: AppStore = getAppStore()) {
    const domains = await store.query<DbWorkspaceDomain>({ type: 'workspace-domain', pk: workspacePk(workspaceId) });
    return domains.filter(domain => domain.workspaceId === workspaceId).sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * The domain's teams that still apply: active, and not archived and restored since they were chosen
 * (a restored team starts empty and does not revive earlier grants, like invitations).
 */
export async function currentDomainTeams(domain: DbWorkspaceDomain, store: AppStore = getAppStore()) {
    const teams = await Promise.all(domain.teamIds.map(id => getTeam(domain.workspaceId, id, store)));
    return teams.flatMap(team => team?.doc.state === 'active'
        && (domain.teamGenerations[team.doc.id] ?? 0) === (team.doc.invitationGeneration ?? 0) ? [team.doc.id] : []);
}

/** The domain of the admin's own email when they can add it and it isn't added yet: the settings suggest it */
export function suggestedDomain(adminEmail: string, added: readonly { domain: string }[]) {
    const domain = emailDomain(adminEmail);
    return domain && !addRefusal(domain, adminEmail) && !added.some(entry => entry.domain === domain) ? domain : null;
}

/** The lookup for sign-in. Without its workspace's domain document it matches nobody, so it is written first. */
async function ensureLookup(domain: string, workspaceId: string, store: AppStore) {
    await store.create<DbDomainWorkspace>({
        type: 'domain-workspace',
        id: workspaceId,
        pk: domainPk(domain),
        workspaceId,
        createdAt: new Date().toISOString()
    });
}

/** Chosen teams with their current invitation generation, checked in the same retry as the write */
async function teamSelection(workspaceId: string, teamIds: string[], store: AppStore) {
    const selected = await validateTeamIds(workspaceId, teamIds, store);
    const teams = await Promise.all(selected.map(id => getTeam(workspaceId, id, store)));
    return {
        teamIds: selected,
        teamGenerations: Object.fromEntries(teams.map(team => [team!.doc.id, team!.doc.invitationGeneration ?? 0]))
    };
}

/**
 * Adds a domain to the current workspace for an admin whose own account email is at it. People who sign
 * in with an email at the domain can then join, with the chosen teams.
 */
export async function addWorkspaceDomain(context: AppContext, input: { domain: unknown; teamIds: string[] }) {
    assertMutableWorkspace(context.workspace.id);
    if (!context.isAdmin)
        throw new UserFacingError('Only workspace admins can add domains.');
    const domain = emailDomainSchema.parse(input.domain);
    const refusal = addRefusal(domain, context.user.email);
    if (refusal)
        throw new UserFacingError(refusal);
    const workspaceId = context.workspace.id;
    const store = getAppStore();
    await validateTeamIds(workspaceId, input.teamIds, store);

    await ensureLookup(domain, workspaceId, store);
    await mutateAccess(workspaceId, context.user.id, async current => {
        if (await current.get(workspacePk(workspaceId), domainDocId(domain)))
            throw new UserFacingError(`${domain} is already added.`);
        if (await current.count({ type: 'workspace-domain', pk: workspacePk(workspaceId) }) >= MAX_WORKSPACE_DOMAINS)
            throw new UserFacingError(`A workspace can have up to ${MAX_WORKSPACE_DOMAINS} domains.`);
        const teams = await teamSelection(workspaceId, input.teamIds, current);
        const now = new Date().toISOString();
        const doc: DbWorkspaceDomain = {
            type: 'workspace-domain',
            id: domainDocId(domain),
            pk: workspacePk(workspaceId),
            workspaceId,
            domain,
            ...teams,
            verification: 'admin-email',
            addedBy: context.user.id,
            addedAt: now,
            updatedAt: now
        };
        return {
            operations: [{ kind: 'create', doc }],
            action: 'domain.added',
            targetIds: [doc.id, ...teams.teamIds],
            before: {},
            after: { domain, teamIds: teams.teamIds }
        };
    });
    // Again after the write: a removal of the same domain running at once may have deleted the lookup
    await ensureLookup(domain, workspaceId, store);
    return domain;
}

/** Changes the teams people who join through the domain get; people who already joined keep theirs */
export async function updateWorkspaceDomainTeams(context: AppContext, input: { domain: unknown; teamIds: string[] }) {
    assertMutableWorkspace(context.workspace.id);
    if (!context.isAdmin)
        throw new UserFacingError('Only workspace admins can change domains.');
    const domain = emailDomainSchema.parse(input.domain);
    const workspaceId = context.workspace.id;
    await validateTeamIds(workspaceId, input.teamIds);
    await mutateAccess(workspaceId, context.user.id, async store => {
        const existing = await store.get<DbWorkspaceDomain>(workspacePk(workspaceId), domainDocId(domain));
        if (existing?.doc.type !== 'workspace-domain')
            throw new UserFacingError(`${domain} was removed. Refresh the page.`);
        const before = await currentDomainTeams(existing.doc, store);
        const teams = await teamSelection(workspaceId, input.teamIds, store);
        return {
            operations: [{
                kind: 'replace',
                doc: { ...existing.doc, ...teams, updatedAt: new Date().toISOString() },
                etag: existing.etag
            }],
            action: 'domain.updated',
            targetIds: [existing.doc.id, ...new Set([...before, ...teams.teamIds])],
            before: { domain, teamIds: before },
            after: { domain, teamIds: teams.teamIds }
        };
    });
}

/** Removes a domain at once (any admin). People who joined through it stay in the workspace. */
export async function removeWorkspaceDomain(context: AppContext, input: unknown) {
    assertMutableWorkspace(context.workspace.id);
    if (!context.isAdmin)
        throw new UserFacingError('Only workspace admins can remove domains.');
    const domain = emailDomainSchema.parse(input);
    const workspaceId = context.workspace.id;
    const store = getAppStore();
    await mutateAccess(workspaceId, context.user.id, async current => {
        const existing = await current.get<DbWorkspaceDomain>(workspacePk(workspaceId), domainDocId(domain));
        if (existing?.doc.type !== 'workspace-domain')
            return null;
        return {
            operations: [{ kind: 'delete', pk: existing.doc.pk, id: existing.doc.id, etag: existing.etag }],
            action: 'domain.removed',
            targetIds: [existing.doc.id],
            before: { domain, teamIds: existing.doc.teamIds },
            after: {}
        };
    });
    // The domain no longer matches without its document; the lookup goes too, unless it was added again meanwhile
    await store.delete(domainPk(domain), workspaceId);
    if (await store.get(workspacePk(workspaceId), domainDocId(domain)))
        await ensureLookup(domain, workspaceId, store);
}

/**
 * The domain document through which this person can join the workspace, or `null`: the workspace offers
 * their email's domain, they are not a member, and no admin ever invited or removed their address there.
 */
async function joinableDomain(user: DbUser, workspaceId: string, store: AppStore): Promise<StoredDoc<DbWorkspaceDomain> | null> {
    const domain = emailDomain(user.email);
    if (!domain || isPublicEmailDomain(domain) || workspaceId === PUBLIC_WORKSPACE_ID)
        return null;
    const pk = workspacePk(workspaceId);
    const [entry, member, generation] = await Promise.all([
        store.get<DbWorkspaceDomain>(pk, domainDocId(domain)),
        store.get<DbMember>(pk, memberId(user.id)),
        accessGeneration(workspaceId, user.email, store)
    ]);
    if (entry?.doc.type !== 'workspace-domain' || entry.doc.domain !== domain || entry.doc.workspaceId !== workspaceId
        || member || generation !== 0)
        return null;
    return entry;
}

/** The domain documents through which this person can join workspaces, at most `MAX_DOMAIN_WORKSPACES` */
async function joinableDomains(user: DbUser, store: AppStore) {
    const domain = emailDomain(user.email);
    if (!domain || isPublicEmailDomain(domain))
        return [];
    const lookups = await store.query<DbDomainWorkspace>({ type: 'domain-workspace', pk: domainPk(domain), limit: MAX_DOMAIN_WORKSPACES });
    const entries = await Promise.all(lookups.map(lookup => joinableDomain(user, lookup.workspaceId, store)));
    return entries.filter((entry): entry is StoredDoc<DbWorkspaceDomain> => Boolean(entry));
}

/** Whether a workspace offers this person's email domain to them (the sign-in redirect needs no more) */
export async function hasDomainJoinOffer(user: DbUser, store: AppStore = getAppStore()) {
    return (await joinableDomains(user, store)).length > 0;
}

/**
 * What the join page shows: the workspace's name, the domain and the name of the admin who added it
 * while they are still a member. Nothing about its people, teams or projects reaches anyone before they join.
 */
export type DomainJoinOffer = { workspaceId: string; workspaceName: string; domain: string; addedByName?: string };

export async function domainJoinOffers(user: DbUser): Promise<DomainJoinOffer[]> {
    const entries = await joinableDomains(user, getAppStore());
    const offers = await Promise.all(entries.map(async ({ doc }): Promise<DomainJoinOffer | null> => {
        const [workspace, adder] = await Promise.all([getWorkspace(doc.workspaceId), getMember(doc.workspaceId, doc.addedBy)]);
        if (!workspace)
            return null;
        const addedBy = adder ? await getUser(doc.addedBy) : null;
        return { workspaceId: workspace.id, workspaceName: workspace.name, domain: doc.domain, addedByName: addedBy?.name };
    }));
    return offers.filter((offer): offer is DomainJoinOffer => Boolean(offer))
        .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));
}

/**
 * Joins the workspace through the person's email domain: a commenter with the domain's current teams and
 * no direct projects, labelled Internal. Rechecked in the access transaction, so a domain removed, an
 * invitation sent or a removal made meanwhile wins. Joining a workspace they are in already changes nothing.
 */
export async function joinWorkspaceByDomain(user: DbUser, workspaceId: string) {
    const result: { member: DbMember | null } = { member: null };
    if (workspaceId !== PUBLIC_WORKSPACE_ID && await getWorkspace(workspaceId))
        await mutateAccess(workspaceId, user.id, async store => {
            result.member = null;
            const entry = await joinableDomain(user, workspaceId, store);
            if (!entry)
                return null;
            const teamIds = await currentDomainTeams(entry.doc, store);
            const member: DbMember = {
                type: 'member',
                id: memberId(user.id),
                pk: workspacePk(workspaceId),
                workspaceId,
                userId: user.id,
                email: user.email,
                role: 'commenter',
                projects: [],
                teamIds,
                relationship: 'internal',
                createdAt: new Date().toISOString()
            };
            result.member = member;
            return {
                operations: [{ kind: 'create', doc: member }],
                action: 'member.joined',
                targetIds: [member.id, ...teamIds],
                before: {},
                after: { domain: entry.doc.domain, role: member.role, projects: member.projects, teamIds }
            };
        }, { admin: false });
    const member = result.member ?? (workspaceId === PUBLIC_WORKSPACE_ID ? null : await getMember(workspaceId, user.id));
    if (!member)
        throw new UserFacingError('This workspace is no longer open to your email domain. Ask one of its admins to invite you.');
    return member;
}
