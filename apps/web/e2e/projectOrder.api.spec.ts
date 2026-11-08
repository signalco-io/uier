import { expect, test } from '@playwright/test';
import { defaultProjectOrder, formatProjectOrder, listsProject, orderProjects, parseProjectOrder, projectGroupings, projectSorts, type ProjectOrder } from '../src/lib/app/projectOrder';

// The sidebar's project order (uier #32, Sort and Group in uier #49): the saved choice and the order the server and
// the browser both render.

test('the saved project order reads back, and anything else is the default', () => {
    for (const sort of projectSorts)
        for (const group of projectGroupings)
            expect(parseProjectOrder(formatProjectOrder({ sort, group }))).toEqual({ sort, group });
    expect(formatProjectOrder({ sort: 'recent', group: 'none' })).toBe('recent');
    expect(formatProjectOrder({ sort: 'created', group: 'status' })).toBe('created.status');
    for (const value of [undefined, '', 'newest', 'name', 'recent.team', 'recent.none', 'recent.client.client', 'Alphabetical', '.client', 'status'])
        expect(parseProjectOrder(value)).toEqual(defaultProjectOrder);
    expect(defaultProjectOrder).toEqual({ sort: 'recent', group: 'none' });
});

test('the values saved before Sort and Group read as the same choice', () => {
    // From the Sort by radios and the Group by client checkbox
    expect(parseProjectOrder('recent')).toEqual({ sort: 'recent', group: 'none' });
    expect(parseProjectOrder('alphabetical')).toEqual({ sort: 'alphabetical', group: 'none' });
    expect(parseProjectOrder('recent.client')).toEqual({ sort: 'recent', group: 'client' });
    expect(parseProjectOrder('alphabetical.client')).toEqual({ sort: 'alphabetical', group: 'client' });
});

const zeta = { id: 'client_zeta', name: 'Zeta Co' };
const acme = { id: 'client_acme', name: 'acme' };
const projects = [
    { id: 'p1', name: 'Charlie', createdAt: '2026-10-01T10:00:00.000Z', activityAt: '2026-11-08T10:00:00.000Z', client: zeta },
    { id: 'p2', name: 'alpha', createdAt: '2026-10-04T10:00:00.000Z', activityAt: '2026-11-01T10:00:00.000Z' },
    { id: 'p3', name: 'Delta', createdAt: '2026-10-03T10:00:00.000Z', activityAt: '2026-11-05T10:00:00.000Z', client: acme },
    { id: 'p4', name: 'Bravo 10', createdAt: '2026-10-02T10:00:00.000Z', activityAt: '2026-11-07T10:00:00.000Z', client: zeta },
    { id: 'p5', name: 'Bravo 9', createdAt: '2026-10-02T10:00:00.000Z', activityAt: '2026-11-07T10:00:00.000Z' }
];
const done = [
    { id: 'p6', name: 'Echo', status: 'done' as const, createdAt: '2026-10-05T10:00:00.000Z', activityAt: '2026-11-09T10:00:00.000Z', client: acme },
    { id: 'p7', name: 'Foxtrot', status: 'done' as const, createdAt: '2026-09-01T10:00:00.000Z', activityAt: '2026-09-02T10:00:00.000Z' }
];
type Project = typeof projects[number] | typeof done[number];
const names = (groups: ReturnType<typeof orderProjects<Project>>) =>
    groups.map(group => [group.client?.name ?? group.status ?? null, group.projects.map(project => project.name)]);
const order = (sort: ProjectOrder['sort'], group: ProjectOrder['group'] = 'none') => ({ sort, group });

test('projects sort by latest activity, by creation or by name, ignoring case and reading numbers as numbers', () => {
    // Equal times fall back to the name
    expect(names(orderProjects(projects, order('recent'))))
        .toEqual([[null, ['Charlie', 'Bravo 9', 'Bravo 10', 'Delta', 'alpha']]]);
    expect(names(orderProjects(projects, order('created'))))
        .toEqual([[null, ['alpha', 'Delta', 'Bravo 9', 'Bravo 10', 'Charlie']]]);
    expect(names(orderProjects(projects, order('alphabetical'))))
        .toEqual([[null, ['alpha', 'Bravo 9', 'Bravo 10', 'Charlie', 'Delta']]]);
    // The input is left as it was
    expect(projects.map(project => project.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
});

test('only grouping by status lists the done projects', () => {
    const all: Project[] = [...projects, ...done];
    for (const sort of projectSorts)
        for (const group of ['none', 'client'] as const)
            expect(names(orderProjects(all, order(sort, group))).flatMap(([, listed]) => listed)).not.toContain('Echo');
    expect(listsProject(order('recent'), done[0]!)).toBe(false);
    expect(listsProject(order('recent', 'status'), done[0]!)).toBe(true);
    // A project without a status is active
    expect(listsProject(order('recent'), { status: undefined })).toBe(true);
});

test('grouped by status, Active comes first and Done second, each in the chosen order', () => {
    const all: Project[] = [...done, ...projects];
    expect(names(orderProjects(all, order('recent', 'status'))))
        .toEqual([['active', ['Charlie', 'Bravo 9', 'Bravo 10', 'Delta', 'alpha']], ['done', ['Echo', 'Foxtrot']]]);
    expect(names(orderProjects(all, order('created', 'status'))))
        .toEqual([['active', ['alpha', 'Delta', 'Bravo 9', 'Bravo 10', 'Charlie']], ['done', ['Echo', 'Foxtrot']]]);
    expect(names(orderProjects(all, order('alphabetical', 'status'))))
        .toEqual([['active', ['alpha', 'Bravo 9', 'Bravo 10', 'Charlie', 'Delta']], ['done', ['Echo', 'Foxtrot']]]);
    // A status without projects has no group
    expect(names(orderProjects(projects, order('alphabetical', 'status'))))
        .toEqual([['active', ['alpha', 'Bravo 9', 'Bravo 10', 'Charlie', 'Delta']]]);
    expect(names(orderProjects(done, order('alphabetical', 'status')))).toEqual([['done', ['Echo', 'Foxtrot']]]);
    expect(orderProjects([], order('recent', 'status'))).toEqual([]);
});

test('grouped projects follow their clients, ordered like the projects, with the rest last', () => {
    expect(names(orderProjects(projects, order('alphabetical', 'client'))))
        .toEqual([['acme', ['Delta']], ['Zeta Co', ['Bravo 10', 'Charlie']], [null, ['alpha', 'Bravo 9']]]);
    expect(names(orderProjects(projects, order('recent', 'client'))))
        .toEqual([['Zeta Co', ['Charlie', 'Bravo 10']], ['acme', ['Delta']], [null, ['Bravo 9', 'alpha']]]);
    // By creation, the client of the newest project first
    expect(names(orderProjects(projects, order('created', 'client'))))
        .toEqual([['acme', ['Delta']], ['Zeta Co', ['Bravo 10', 'Charlie']], [null, ['alpha', 'Bravo 9']]]);
    // Every project has a client: no group for the rest
    expect(names(orderProjects(projects.filter(project => project.client), order('alphabetical', 'client'))))
        .toEqual([['acme', ['Delta']], ['Zeta Co', ['Bravo 10', 'Charlie']]]);
    // No client at all: nothing to group by, one list
    expect(names(orderProjects(projects.filter(project => !project.client), order('alphabetical', 'client'))))
        .toEqual([[null, ['alpha', 'Bravo 9']]]);
    expect(orderProjects([], order('recent', 'client'))).toEqual([{ projects: [] }]);
});
