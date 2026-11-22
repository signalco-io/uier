import { brand } from '@uier/brand';

// The component catalog on /brand/components: every component people see, grouped by where it ships.
// The page's index and each specimen read their name and source from here, so an entry without a
// specimen (or a specimen without an entry) fails to render. Add a component here and in the group's
// specimen file in the same change.

export type CatalogEntry = {
    /** The specimen's element id and the prefix of its states' `data-anchor`; keep it once comments exist */
    id: string;
    name: string;
    /** Repository path of the component's source */
    source: string;
    /** What to know before changing it, in a sentence */
    note?: string;
};

export type CatalogGroup = { id: 'brand-marks' | 'site-kit' | 'app-kit' | 'app-patterns'; title: string; lead: string; entries: CatalogEntry[] };

const ui = (file: string) => `apps/web/src/components/ui/${file}.tsx`;
const primitive = (name: string) => `@signalco/ui-primitives/${name}`;

export const catalog: CatalogGroup[] = [
    {
        id: 'brand-marks',
        title: 'Brand marks',
        lead: 'The logo, the mark and the pin. They come from @uier/brand and are never redrawn.',
        entries: [
            { id: 'brand-logo', name: 'Logo', source: 'packages/brand/src/Logo.tsx', note: 'The lockup scales from the wordmark size: the mark is 0.8 of it, the gap 0.4.' },
            { id: 'brand-mark', name: 'Mark', source: 'packages/brand/src/Mark.tsx' },
            { id: 'brand-pin', name: 'Pin', source: 'packages/brand/src/Pin.tsx', note: 'The one filled shape. Its sharp corner sits on the anchor.' }
        ]
    },
    {
        id: 'site-kit',
        title: 'Public site',
        lead: 'The signalco UI kit and the building blocks of uier.io’s public pages.',
        entries: [
            { id: 'site-button', name: 'Button', source: primitive('Button') },
            { id: 'site-icon-button', name: 'Icon button', source: primitive('IconButton') },
            { id: 'site-input', name: 'Input', source: primitive('Input') },
            { id: 'site-checkbox', name: 'Checkbox', source: primitive('Checkbox') },
            { id: 'site-chip', name: 'Chip', source: primitive('Chip') },
            { id: 'site-avatar', name: 'Avatar', source: primitive('Avatar') },
            { id: 'site-typography', name: 'Typography', source: primitive('Typography') },
            { id: 'site-panel', name: 'Panel and tile', source: 'apps/web/src/components/marketing/ContentPage.tsx', note: 'One way to group items on a public page: cells divided by hairlines.' },
            { id: 'site-lists', name: 'Lists and links', source: 'apps/web/src/components/marketing/ContentPage.tsx' },
            { id: 'site-toolbar', name: 'Toolbar illustration', source: 'apps/web/src/components/brand/ToolbarIllustration.tsx', note: 'A picture of the review toolbar for public pages. The real toolbar is at the bottom of this page.' },
            { id: 'site-thread', name: 'Review thread', source: 'apps/web/src/components/marketing/ReviewThreadDemo.tsx' }
        ]
    },
    {
        id: 'app-kit',
        title: 'App UI kit',
        lead: 'The shadcn/ui components the signed-in app is built from, on Base UI and the brand tokens.',
        entries: [
            { id: 'ui-button', name: 'Button', source: ui('button') },
            { id: 'ui-badge', name: 'Badge', source: ui('badge') },
            { id: 'ui-input', name: 'Input', source: ui('input') },
            { id: 'ui-textarea', name: 'Textarea', source: ui('textarea') },
            { id: 'ui-input-group', name: 'Input group', source: ui('input-group') },
            { id: 'ui-field', name: 'Field', source: ui('field'), note: 'Every form control in the app sits in a Field with its label.' },
            { id: 'ui-checkbox', name: 'Checkbox', source: ui('checkbox') },
            { id: 'ui-radio-group', name: 'Radio group', source: ui('radio-group') },
            { id: 'ui-switch', name: 'Switch', source: ui('switch') },
            { id: 'ui-toggle', name: 'Toggle', source: ui('toggle') },
            { id: 'ui-toggle-group', name: 'Toggle group', source: ui('toggle-group') },
            { id: 'ui-select', name: 'Select', source: ui('select') },
            { id: 'ui-autocomplete', name: 'Autocomplete', source: ui('autocomplete') },
            { id: 'ui-tabs', name: 'Tabs', source: ui('tabs') },
            { id: 'ui-card', name: 'Card', source: ui('card') },
            { id: 'ui-alert', name: 'Alert', source: ui('alert') },
            { id: 'ui-avatar', name: 'Avatar', source: ui('avatar') },
            { id: 'ui-breadcrumb', name: 'Breadcrumb', source: ui('breadcrumb') },
            { id: 'ui-item', name: 'Item', source: ui('item') },
            { id: 'ui-empty', name: 'Empty', source: ui('empty') },
            { id: 'ui-table', name: 'Table', source: ui('table') },
            { id: 'ui-kbd', name: 'Kbd', source: ui('kbd') },
            { id: 'ui-progress', name: 'Progress', source: ui('progress') },
            { id: 'ui-loading', name: 'Spinner and skeleton', source: ui('spinner') },
            { id: 'ui-separator', name: 'Separator', source: ui('separator') },
            { id: 'ui-collapsible', name: 'Collapsible', source: ui('collapsible') },
            { id: 'ui-tooltip', name: 'Tooltip', source: ui('tooltip'), note: 'Turn on Keep open to look at, and comment on, the open state.' },
            { id: 'ui-popover', name: 'Popover', source: ui('popover'), note: 'Turn on Keep open to look at, and comment on, the open state.' },
            { id: 'ui-dropdown-menu', name: 'Dropdown menu', source: ui('dropdown-menu'), note: 'Turn on Keep open to look at, and comment on, the open state.' },
            { id: 'ui-dialog', name: 'Dialog', source: ui('dialog'), note: 'Dialogs cover the page, so they open from their button only.' },
            { id: 'ui-alert-dialog', name: 'Alert dialog', source: ui('alert-dialog') },
            { id: 'ui-sheet', name: 'Sheet', source: ui('sheet') },
            { id: 'ui-toast', name: 'Toast', source: ui('sonner') },
            { id: 'ui-sidebar', name: 'Sidebar', source: ui('sidebar'), note: 'Shown fixed open. In the app it docks from 1024 px and is a sheet below that.' }
        ]
    },
    {
        id: 'app-patterns',
        title: 'App patterns',
        lead: 'Components the app composes from the kit: page headers, sections and the pieces of a thread.',
        entries: [
            { id: 'app-page-header', name: 'Page header', source: 'apps/web/src/components/app/PageHeader.tsx', note: 'Each specimen renders its title as a heading, the way the app does.' },
            { id: 'app-section', name: 'Section', source: 'apps/web/src/components/app/PageHeader.tsx' },
            { id: 'app-person-avatar', name: 'Person avatar', source: 'apps/web/src/components/app/PersonAvatar.tsx' },
            { id: 'app-agent-avatar', name: 'Agent avatar', source: 'apps/web/src/components/app/comments/AgentAvatar.tsx' },
            { id: 'app-status', name: 'Status', source: 'apps/web/src/components/app/comments/CommentStatus.tsx', note: 'A dot in the status colour, always beside its name.' },
            { id: 'app-priority', name: 'Priority', source: 'apps/web/src/components/app/comments/PriorityFlag.tsx' },
            { id: 'app-pull-request', name: 'Pull request state', source: 'apps/web/src/components/app/comments/PullRequestStateBadge.tsx' },
            { id: 'app-thread-label', name: 'Thread label', source: 'apps/web/src/components/app/ThreadLabelBadge.tsx' },
            { id: 'app-feedback-type', name: 'Feedback type icon', source: 'apps/web/src/components/app/FeedbackTypeIcon.tsx' },
            { id: 'app-choice-card', name: 'Choice card', source: 'apps/web/src/components/app/ChoiceCard.tsx' }
        ]
    }
];

const entries = new Map(catalog.flatMap(group => group.entries.map(entry => [entry.id, entry] as const)));

export function catalogEntry(id: string): CatalogEntry {
    const entry = entries.get(id);
    if (!entry) throw new Error(`No catalog entry "${id}" in src/components/brand/catalog/catalog.ts`);
    return entry;
}

/** A repository path links to its source on GitHub; a package name links to npm */
export function sourceUrl(source: string) {
    return source.startsWith('@') ? `https://www.npmjs.com/package/${source.split('/').slice(0, 2).join('/')}` : `${brand.repository}/blob/main/${source}`;
}

/** `data-anchor` of a state: unique on the page, so a comment's selector survives reordering */
export function stateAnchor(entryId: string, label: string) {
    return `${entryId}/${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}
