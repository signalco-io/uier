import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
    defaultProjectLanguage, readToolbarLanguageInfo, resolveToolbarLanguage, toolbarLanguageLabel, toolbarLanguages
} from '@uier/toolbar/languages';
import { projectRefPk, workspacePk, type DbProject, type DbProjectRef, type DbWorkspace } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import { getProject, updateProject } from '../src/lib/app/projects';
import { getUser, findOrCreateUser } from '../src/lib/app/users';
import { getWorkspace, setWorkspaceToolbarLanguage } from '../src/lib/app/workspaces';
import {
    projectToolbarLanguageMode, projectToolbarLanguageModeSchema, setUserToolbarLanguage, toolbarLanguageInfo, workspaceToolbarLanguage
} from '../src/lib/app/toolbarLanguage';
import { signToken } from '../src/lib/app/tokens';
import { reviewApiHandler } from '../src/lib/review/http';
import { setReviewLanguage } from '../src/lib/review/routes';
import { provisionPublicProject } from '../src/lib/comments/publicProject';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { GET as visitorGet } from '../app/api/visitor/route';
import { POST as visitorLanguage } from '../app/api/visitor/language/route';
import { persistProjectAccess } from './support/projectAccess';

// Toolbar language (docs/project-settings.md#toolbar-language): the person's choice > the project's >
// the workspace's > English. Settings are admin-only and validated before writes; a signed-in account's
// choice is saved on the account, a guest's never reaches the server.

const previous = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_STAFF_EMAILS: process.env.UIER_STAFF_EMAILS };
test.beforeEach(() => {
    process.env.UIER_LOCAL = '1';
    delete process.env.UIER_STAFF_EMAILS;
});
test.afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

async function fixture(access: DbProject['access'] = 'guests') {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const actors = [
        { userId: `lang_member_${suffix}`, name: 'Member', isAdmin: false },
        { userId: `lang_admin_${suffix}`, name: 'Admin', isAdmin: true }
    ];
    const project = await persistProjectAccess({ id: suffix, access } as DbProject, actors);
    // The review API finds a project by its id through its reference
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id: project.id, pk: projectRefPk(project.id), workspaceId: project.workspaceId });
    const workspace: DbWorkspace = { type: 'workspace', id: project.workspaceId, pk: workspacePk(project.workspaceId), name: 'Languages',
        createdBy: actors[1]!.userId, createdAt: new Date().toISOString(), aiTitles: false };
    await getAppStore().create(workspace);
    return { project, workspace, member: actors[0]!, admin: actors[1]! };
}

const save = reviewApiHandler(setReviewLanguage, { comments: false, verifyWrites: false });
const reviewRequest = (project: DbProject, path: string, init: RequestInit & { userId?: string } = {}) => {
    const { userId, headers, ...rest } = init;
    return new Request(`https://uier.io/api/review/${project.id}/${path}`, { ...rest, headers: {
        Origin: 'https://reviewed.example', 'Content-Type': 'application/json',
        ...(userId ? { Authorization: `Bearer ${signToken('review', { uid: userId, pid: project.id }, 3600)}` } : {}),
        ...headers as Record<string, string>
    } });
};
const params = (project: DbProject) => ({ params: Promise.resolve({ projectId: project.id }) });
/**
 * The `language` of `GET /api/review/<project>` (`getReviewInfo`, which imports `next/headers` and runs only
 * in the app): the current workspace and project documents, and a member's account (a guest has none)
 */
const readInfo = async (project: DbProject, userId?: string) => toolbarLanguageInfo(await getWorkspace(project.workspaceId),
    await getProject(project.workspaceId, project.id), userId ? await getUser(userId) ?? {} : undefined);
const choose = (project: DbProject, body: unknown, userId?: string) =>
    save(reviewRequest(project, 'language', { method: 'POST', body: JSON.stringify(body), userId }), params(project));

test('the person’s choice wins over the project’s, the project’s over the workspace’s, and English is the fallback', () => {
    expect(toolbarLanguages).toEqual(['en', 'de', 'fr', 'es', 'it', 'hr']);
    expect(toolbarLanguageLabel('hr')).toBe('Croatian (Hrvatski)');
    // Existing workspaces and projects have no language: English
    expect(defaultProjectLanguage(undefined, undefined)).toEqual({ language: 'en', source: 'default' });
    expect(defaultProjectLanguage('de', undefined)).toEqual({ language: 'de', source: 'workspace' });
    expect(defaultProjectLanguage('de', 'fr')).toEqual({ language: 'fr', source: 'project' });
    // Unknown stored values are ignored, never shown
    expect(defaultProjectLanguage('xx', 'pt')).toEqual({ language: 'en', source: 'default' });
    expect(resolveToolbarLanguage('it', { default: 'fr' })).toBe('it');
    expect(resolveToolbarLanguage(null, { default: 'fr' })).toBe('fr');
    expect(resolveToolbarLanguage('klingon', { default: 'de' })).toBe('de');
    expect(resolveToolbarLanguage(undefined, undefined)).toBe('en');
    expect(readToolbarLanguageInfo({ default: 'hr', source: 'project', preference: 'es' })).toEqual({ default: 'hr', source: 'project', preference: 'es' });
    expect(readToolbarLanguageInfo({ default: 'zz', source: 'project' })).toEqual({ default: 'en', source: 'default' });
    expect(readToolbarLanguageInfo('de')).toBeUndefined();
    // A guest gets no `preference`: their choice stays in their browser
    expect(toolbarLanguageInfo({ toolbarLanguage: 'de' }, {}, undefined)).toEqual({ default: 'de', source: 'workspace' });
    expect(toolbarLanguageInfo({ toolbarLanguage: 'de' }, {}, {})).toEqual({ default: 'de', source: 'workspace', preference: null });
    expect(workspaceToolbarLanguage(null)).toBe('en');
    expect(projectToolbarLanguageMode({ toolbarLanguage: 'xx' as never })).toBe('workspace');
    expect(projectToolbarLanguageModeSchema.safeParse('workspace').success).toBe(true);
    for (const invalid of ['xx', 'EN', '', null, 42])
        expect(projectToolbarLanguageModeSchema.safeParse(invalid).success).toBe(false);
});

test('workspace and project languages are admin-only, validated before writes and inherited at use time', async () => {
    const { project, workspace, member, admin } = await fixture();
    expect(await readInfo(project)).toEqual({ default: 'en', source: 'default' });

    for (const userId of [member.userId, 'outsider'])
        await expect(setWorkspaceToolbarLanguage(workspace.id, userId, 'de')).rejects.toThrow('Only admins');
    await expect(setWorkspaceToolbarLanguage(workspace.id, admin.userId, 'pt')).rejects.toThrow();
    expect((await getWorkspace(workspace.id))!.toolbarLanguage).toBeUndefined();

    await setWorkspaceToolbarLanguage(workspace.id, admin.userId, 'de');
    const saved = (await getWorkspace(workspace.id))!;
    expect(saved).toMatchObject({ toolbarLanguage: 'de', aiTitles: false, name: 'Languages' });
    expect(await readInfo(project)).toEqual({ default: 'de', source: 'workspace' });

    // A project's own language wins; back to the workspace's removes it, and later workspace changes apply
    await updateProject(workspace.id, project.id, { toolbarLanguage: 'hr' });
    expect(await readInfo(project)).toEqual({ default: 'hr', source: 'project' });
    await updateProject(workspace.id, project.id, { toolbarLanguage: undefined });
    await setWorkspaceToolbarLanguage(workspace.id, admin.userId, 'it');
    expect(await readInfo(project)).toEqual({ default: 'it', source: 'workspace' });
});

test('review API: guests are refused before a write; members save, read back and reset their own choice', async () => {
    const { project, workspace, member, admin } = await fixture();
    await setWorkspaceToolbarLanguage(workspace.id, admin.userId, 'fr');

    // Anonymous and guest callers: 401 sign_in_required, even with an invalid body, and nothing stored
    for (const headers of [{}, { 'X-Uier-Visitor': randomUUID() }] as Record<string, string>[]) {
        const refused = await save(reviewRequest(project, 'language', { method: 'POST', body: '{"language":"de"}', headers }), params(project));
        expect(refused.status).toBe(401);
        expect(await refused.json()).toMatchObject({ error: 'sign_in_required' });
        expect((await save(reviewRequest(project, 'language', { method: 'POST', body: 'not json', headers }), params(project))).status).toBe(401);
    }
    // Guests see the project's language and no account choice
    expect(await readInfo(project)).toEqual({ default: 'fr', source: 'workspace' });
    expect(await readInfo(project, member.userId)).toEqual({ default: 'fr', source: 'workspace', preference: null });

    // Validation: only known codes or null, no extra fields
    for (const body of [{ language: 'pt' }, { language: 'DE' }, { language: '' }, {}, { language: 'de', userId: admin.userId }]) {
        const response = await choose(project, body, member.userId);
        expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect((await getUser(member.userId))!.toolbarLanguage).toBeUndefined();

    const saved = await choose(project, { language: 'es' }, member.userId);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ language: 'es' });
    expect((await getUser(member.userId))!).toMatchObject({ toolbarLanguage: 'es', name: 'Member' });
    expect(await readInfo(project, member.userId)).toEqual({ default: 'fr', source: 'workspace', preference: 'es' });
    // Only the member's own account changes
    expect((await getUser(admin.userId))!.toolbarLanguage).toBeUndefined();
    expect(await readInfo(project, admin.userId)).toEqual({ default: 'fr', source: 'workspace', preference: null });

    // Reset to the project's language
    expect(await (await choose(project, { language: null }, member.userId)).json()).toEqual({ language: null });
    expect((await getUser(member.userId))!).not.toHaveProperty('toolbarLanguage');
    expect(await readInfo(project, member.userId)).toEqual({ default: 'fr', source: 'workspace', preference: null });
});

test('a member saves their language even where comments are off, and other sites are refused', async () => {
    const { project, member } = await fixture('disabled');
    expect((await choose(project, { language: 'hr' }, member.userId)).status).toBe(200);
    expect(await readInfo(project, member.userId)).toMatchObject({ preference: 'hr' });
    const foreign = await save(reviewRequest(project, 'language', { method: 'POST', body: '{"language":"de"}', userId: member.userId,
        headers: { Origin: 'https://other.example' } }), params(project));
    expect(foreign.status).toBe(403);
    expect((await getUser(member.userId))!.toolbarLanguage).toBe('hr');
});

test('uier’s own pages: an account’s choice is saved on the account, guests are refused without a cookie', async () => {
    await provisionPublicProject(getAppStore(), getMemoryCommentsStore());
    const user = await findOrCreateUser(`toolbar-language-${randomUUID()}@example.com`);
    const session = `${cookieName(cookieNames.session)}=${signToken('session', { uid: user.id, iat: Math.floor(Date.now() / 1000) }, 3600)}`;
    const request = (method: 'GET' | 'POST', cookie?: string, body?: unknown) => new Request(`http://localhost/api/visitor${method === 'POST' ? '/language' : '?path=/'}`, {
        method, headers: { host: 'localhost', origin: 'http://localhost', 'sec-fetch-site': 'same-origin', 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const none = { params: Promise.resolve({}) };
    const json = async (response: Promise<Response>) => (await (await response).json()) as { language: unknown };

    const guest = await visitorLanguage(request('POST', undefined, { language: 'de' }), none);
    expect(guest.status).toBe(401);
    expect(await guest.json()).toMatchObject({ error: 'sign_in_required' });
    expect(guest.headers.get('set-cookie')).toBeNull();
    expect((await json(visitorGet(request('GET'), none))).language).toEqual({ default: 'en', source: 'default' });

    expect((await visitorLanguage(request('POST', session, { language: 'xx' }), none)).status).toBe(400);
    expect(await (await visitorLanguage(request('POST', session, { language: 'it' }), none)).json()).toEqual({ language: 'it' });
    expect((await getUser(user.id))!.toolbarLanguage).toBe('it');
    expect((await json(visitorGet(request('GET', session), none))).language).toEqual({ default: 'en', source: 'default', preference: 'it' });

    // The same preference as the app's Account → Toolbar language
    await setUserToolbarLanguage(user.id, null);
    expect((await json(visitorGet(request('GET', session), none))).language).toEqual({ default: 'en', source: 'default', preference: null });
});
