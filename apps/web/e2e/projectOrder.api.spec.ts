import { expect, test } from '@playwright/test';
import { defaultProjectOrder, formatProjectOrder, orderProjects, parseProjectOrder } from '../src/lib/app/projectOrder';

// The sidebar's project order (uier #32): the saved choice and the order the server and the browser both render.

test('the saved project order reads back, and anything else is the default', () => {
    for (const order of [
        { sort: 'recent', groupByClient: false },
        { sort: 'recent', groupByClient: true },
        { sort: 'alphabetical', groupByClient: false },
        { sort: 'alphabetical', groupByClient: true }
    ] as const)
        expect(parseProjectOrder(formatProjectOrder(order))).toEqual(order);
    expect(formatProjectOrder({ sort: 'alphabetical', groupByClient: true })).toBe('alphabetical.client');
    for (const value of [undefined, '', 'newest', 'recent.team', 'recent.client.client', 'Alphabetical', '.client'])
        expect(parseProjectOrder(value)).toEqual(defaultProjectOrder);
    expect(defaultProjectOrder).toEqual({ sort: 'recent', groupByClient: false });
});

const zeta = { id: 'client_zeta', name: 'Zeta Co' };
const acme = { id: 'client_acme', name: 'acme' };
const projects = [
    { id: 'p1', name: 'Charlie', activityAt: '2026-11-08T10:00:00.000Z', client: zeta },
    { id: 'p2', name: 'alpha', activityAt: '2026-11-01T10:00:00.000Z' },
    { id: 'p3', name: 'Delta', activityAt: '2026-11-05T10:00:00.000Z', client: acme },
    { id: 'p4', name: 'Bravo 10', activityAt: '2026-11-07T10:00:00.000Z', client: zeta },
    { id: 'p5', name: 'Bravo 9', activityAt: '2026-11-07T10:00:00.000Z' }
];
const names = (groups: ReturnType<typeof orderProjects<typeof projects[number]>>) =>
    groups.map(group => [group.client?.name ?? null, group.projects.map(project => project.name)]);

test('projects sort by latest activity or by name, ignoring case and reading numbers as numbers', () => {
    // Equal activity falls back to the name
    expect(names(orderProjects(projects, { sort: 'recent', groupByClient: false })))
        .toEqual([[null, ['Charlie', 'Bravo 9', 'Bravo 10', 'Delta', 'alpha']]]);
    expect(names(orderProjects(projects, { sort: 'alphabetical', groupByClient: false })))
        .toEqual([[null, ['alpha', 'Bravo 9', 'Bravo 10', 'Charlie', 'Delta']]]);
    // The input is left as it was
    expect(projects.map(project => project.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
});

test('grouped projects follow their clients, ordered like the projects, with the rest last', () => {
    expect(names(orderProjects(projects, { sort: 'alphabetical', groupByClient: true })))
        .toEqual([['acme', ['Delta']], ['Zeta Co', ['Bravo 10', 'Charlie']], [null, ['alpha', 'Bravo 9']]]);
    expect(names(orderProjects(projects, { sort: 'recent', groupByClient: true })))
        .toEqual([['Zeta Co', ['Charlie', 'Bravo 10']], ['acme', ['Delta']], [null, ['Bravo 9', 'alpha']]]);
    // Every project has a client: no group for the rest
    expect(names(orderProjects(projects.filter(project => project.client), { sort: 'alphabetical', groupByClient: true })))
        .toEqual([['acme', ['Delta']], ['Zeta Co', ['Bravo 10', 'Charlie']]]);
    // No client at all: nothing to group by, one list
    expect(names(orderProjects(projects.filter(project => !project.client), { sort: 'alphabetical', groupByClient: true })))
        .toEqual([[null, ['alpha', 'Bravo 9']]]);
    expect(orderProjects([], { sort: 'recent', groupByClient: true })).toEqual([{ projects: [] }]);
});
