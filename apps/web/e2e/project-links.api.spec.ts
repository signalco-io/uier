import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { normalizeProjectLinkUrl, projectLinkName, projectLinkProvider, projectLinks } from '../src/lib/app/projectLinks';
import { projectLinksSchema, updateProject } from '../src/lib/app/projects';
import type { DbProject } from '../src/lib/app/model';

test('link addresses take http and https only, default to HTTPS and keep their path, query and hash', () => {
    for (const [input, expected] of [
        ['github.com/acme/site', 'https://github.com/acme/site'],
        ['  https://dev.azure.com/acme/Site/_boards/board/t/Team/Stories?view=1#top  ', 'https://dev.azure.com/acme/Site/_boards/board/t/Team/Stories?view=1#top'],
        ['http://intranet.example.com:8080/wiki', 'http://intranet.example.com:8080/wiki'],
        ['HTTPS://Figma.com/design/abc/Home', 'https://figma.com/design/abc/Home'],
        ['localhost:3000/docs', 'https://localhost:3000/docs']
    ]) {
        expect(normalizeProjectLinkUrl(input!), input).toBe(expected);
    }
    for (const input of ['', '   ', 'not a link', 'javascript:alert(1)', 'JAVASCRIPT://example.com/%0aalert(1)', 'data:text/html,<script>alert(1)</script>',
        'ftp://files.example.com', 'mailto:team@example.com', 'https://user:secret@example.com', 'https://token@github.com/acme/site',
        'intranet', `https://example.com/${'a'.repeat(2048)}`]) {
        expect(normalizeProjectLinkUrl(input), input).toBeNull();
    }
});

test('recognised services get their own icon, from the host and, for Azure DevOps, the path', () => {
    for (const [url, provider] of [
        ['https://github.com/acme/site', 'github'],
        ['https://gist.github.com/acme/1', 'github'],
        ['https://acme.ghe.com/acme/site', 'github'],
        ['https://gitlab.com/acme/group/site', 'gitlab'],
        ['https://gitlab.acme.example/site', 'gitlab'],
        ['https://dev.azure.com/acme/Site/_boards/board/t/Team/Stories', 'azure-boards'],
        ['https://dev.azure.com/acme/Site/_workitems/edit/12', 'azure-boards'],
        ['https://dev.azure.com/acme/Site/_backlogs/backlog', 'azure-boards'],
        ['https://dev.azure.com/acme/Site/_sprints/taskboard', 'azure-boards'],
        ['https://dev.azure.com/acme/Site/_git/web', 'azure-repos'],
        ['https://acme.visualstudio.com/Site/_git/web', 'azure-repos'],
        ['https://dev.azure.com/acme/Site/_build', 'azure-devops'],
        ['https://dev.azure.com/acme/Site', 'azure-devops'],
        ['https://acme.slack.com/archives/C123', 'slack'],
        ['https://app.slack.com/client/T1/C1', 'slack'],
        ['https://www.notion.so/acme/Plan-123', 'notion'],
        ['https://acme.notion.site/Plan', 'notion'],
        ['https://www.figma.com/design/abc/Home', 'figma'],
        ['https://drive.google.com/drive/folders/abc', 'google-drive'],
        ['https://docs.google.com/document/d/abc/edit', 'google-drive'],
        ['https://discord.gg/acme', 'discord'],
        ['https://discord.com/channels/1/2', 'discord'],
        ['https://linear.app/acme/project/site', 'linear'],
        ['https://example.com/handbook', undefined],
        // Look-alike hosts and Visual Studio's own sites are other addresses
        ['https://github.com.example.com/acme', undefined],
        ['https://notgithub.com/acme', undefined],
        ['https://mygitlab.com/acme', undefined],
        ['https://code.visualstudio.com/docs', undefined],
        ['https://marketplace.visualstudio.com/items?itemName=acme.site', undefined],
        ['https://google.com/drive', undefined]
    ] as const) {
        expect(projectLinkProvider(url), url).toBe(provider);
    }
});

test('a link shows its label, else its service, else its host', () => {
    expect(projectLinkName({ label: ' Sprint board ', url: 'https://dev.azure.com/acme/Site/_boards' })).toBe('Sprint board');
    expect(projectLinkName({ label: '', url: 'https://dev.azure.com/acme/Site/_git/web' })).toBe('Azure Repos');
    expect(projectLinkName({ label: '  ', url: 'https://www.example.com/handbook' })).toBe('example.com');
});

test('saved links validate every row, the label length and the count', () => {
    const links = projectLinksSchema.parse([
        { label: '  Repository ', url: 'github.com/acme/site' },
        { label: '', url: 'https://www.figma.com/design/abc/Home' }
    ]);
    expect(links).toEqual([
        { label: 'Repository', url: 'https://github.com/acme/site' },
        { label: '', url: 'https://www.figma.com/design/abc/Home' }
    ]);
    // Saving what was saved changes nothing
    expect(projectLinksSchema.parse(links)).toEqual(links);
    const issue = (input: unknown) => {
        const result = projectLinksSchema.safeParse(input);
        return result.success ? undefined : result.error.issues[0]?.message;
    };
    expect(issue([{ label: 'Board', url: '' }])).toBe('Enter an address for each link.');
    expect(issue([{ label: '', url: 'javascript:alert(1)' }])).toBe('"javascript:alert(1)" is not a website address.');
    expect(issue([{ label: 'x'.repeat(61), url: 'github.com/acme' }])).toBe('Use at most 60 characters.');
    expect(issue(Array.from({ length: 11 }, (_, index) => ({ label: '', url: `https://example.com/${index}` })))).toBe('A project can have up to 10 links.');
    for (const input of [{}, 'links', [{ url: 'https://example.com' }], [{ label: 1, url: 'https://example.com' }], [{ label: '', url: 'https://example.com', icon: '<svg/>' }]])
        expect(projectLinksSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
});

test('the service validates links before writing, and reads drop stored values that are not web addresses', async () => {
    await expect(updateProject('w_links_test', 'abcdefabcdef', { links: [{ label: '', url: 'javascript:alert(1)' }] })).rejects.toBeInstanceOf(z.ZodError);
    const stored = [
        { label: 'Repository', url: 'https://github.com/acme/site' },
        { label: 'Script', url: 'javascript:alert(1)' },
        { label: 'Unnormalized', url: 'github.com/acme/other' },
        null,
        { label: 3, url: 'https://example.com/' }
    ] as unknown as DbProject['links'];
    expect(projectLinks({ links: stored })).toEqual([
        { label: 'Repository', url: 'https://github.com/acme/site' },
        { label: '', url: 'https://example.com/' }
    ]);
    expect(projectLinks({})).toEqual([]);
    expect(projectLinks({ links: 'https://example.com' as unknown as DbProject['links'] })).toEqual([]);
});
