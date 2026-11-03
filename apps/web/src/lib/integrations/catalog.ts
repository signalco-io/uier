import type { IntegrationProviderId } from './model';

/**
 * What a service does with shared feedback, shown on its public page and on a project's page for it.
 * `two-way-status` and `reply-sync` follow the adapter's `supportsStatusSync` and `supportsReplySync`.
 */
export type IntegrationFeatureKey = 'items' | 'fields' | 'discussion' | 'status' | 'summaries' | 'screenshots' | 'two-way-status' | 'reply-sync' | 'backfill';
/** `optional`: off until an admin turns it on for the project */
export type IntegrationFeature = { key: IntegrationFeatureKey; title: string; detail: string; optional?: boolean };
/** A choice on a project's page for the service, in that page's order */
export type IntegrationSetting = { name: string; detail: string; required?: boolean };

const twoWayStatusSetting: IntegrationSetting = { name: 'Two-way status sync', detail: 'Off by default. Status changes made in the connected tool are checked in the background, usually every five minutes. Pending uier changes take precedence.' };
const replySyncSetting: IntegrationSetting = { name: 'Reply sync', detail: 'Off by default. Starts with replies added after you turn it on. Imported replies show their source and are read-only in uier.' };

export type IntegrationCatalogEntry = {
    name: string;
    title: string;
    description: string;
    result: string;
    detail: string;
    features: IntegrationFeature[];
    settings: IntegrationSetting[];
    steps: string[];
    access: string;
    limits: string;
    removal: string;
};

/** Public setup and listing copy. Keep capabilities aligned with each provider adapter. */
export const integrationCatalog: Record<IntegrationProviderId, IntegrationCatalogEntry> = {
    notion: {
        name: 'Notion',
        title: 'Website feedback in Notion',
        description: 'Turn shared website feedback into pages in your Notion database.',
        result: 'One page per feedback thread',
        detail: 'uier creates a page for each shared feedback thread, then updates its text, discussion and page context in the background. Saved screenshots can be uploaded to Notion.',
        features: [
            { key: 'items', title: 'A page for each thread', detail: 'Each shared feedback thread becomes a page in the database you choose, with its text, discussion and page context. uier keeps the page up to date.' },
            { key: 'fields', title: 'Mapped properties', detail: 'A title and the uier id are required. Kind, environment, feedback link, reviewed page, created date, assignee and status can fill properties you already have.' },
            { key: 'screenshots', title: 'Screenshots', detail: 'The saved screenshot is uploaded into the page. A files property can hold it too.' },
            { key: 'two-way-status', title: 'Two-way status sync', detail: 'Changing the mapped status in Notion marks the feedback Open or Done in uier.', optional: true },
            { key: 'reply-sync', title: 'Reply sync', detail: 'New replies in uier become page comments, and new page comments come back to the thread. Edit or delete the original to update its copies.', optional: true },
            { key: 'backfill', title: 'Backfill', detail: 'Add up to 1,000 existing shared threads when you are ready. Nothing older is copied until you ask.' }
        ],
        settings: [
            { name: 'Database', detail: 'A database shared with the uier connection. A database with several data sources lists each one.', required: true },
            { name: 'Field mapping', detail: 'A title property and a separate rich text property for the uier id. Other properties can stay unmapped.', required: true },
            { name: 'Status values', detail: 'A Status or Select property and the values for open and done feedback. Needed for two-way status sync.' },
            twoWayStatusSetting,
            { ...replySyncSetting, detail: `${replySyncSetting.detail} The connection needs the read and insert comment capabilities.` },
            { name: 'Sync on or off', detail: 'Pause delivery without disconnecting. Existing pages stay.' }
        ],
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, then Integrations, and choose Connect on Notion.',
            'Choose your Notion workspace and share the destination database with the uier connection. The database needs a title property and a separate rich text property for the uier id.',
            'Choose the database, map those properties and save. New shared feedback will sync in the background. Use Backfill existing feedback to include up to 1,000 existing shared threads.'
        ],
        access: 'Read, insert and update content in the pages and databases you share with the connection. Optional reply sync also needs read and insert comment capabilities. No user-information capability is requested.',
        limits: 'Changes sync in the background. Optional properties need a field of the matching type. Reply sync includes comments on the linked page, not comments on individual content blocks.',
        removal: 'Making a thread private or deleting it queues cleanup of reachable managed copies. Notion history and retained files can remain. Disconnect stops future sync and keeps existing copies; remove the connection in Notion to revoke its access.'
    },
    github: {
        name: 'GitHub',
        title: 'Website feedback in GitHub',
        description: 'Keep shared website feedback and its discussion together in GitHub issues.',
        result: 'One issue per feedback thread',
        detail: 'uier creates an issue for each shared feedback thread in your chosen repository. It updates the issue, mirrors the discussion and closes or reopens it as the uier status changes.',
        features: [
            { key: 'items', title: 'An issue for each thread', detail: 'Each shared feedback thread becomes an issue in the repository you choose, with its text, page context and a link back to uier.' },
            { key: 'discussion', title: 'Discussion', detail: 'Replies in uier are added as issue comments and kept current. Comments people write in GitHub are kept.' },
            { key: 'status', title: 'Open and closed', detail: 'Marking feedback Done closes the issue, and reopening it in uier reopens the issue.' },
            { key: 'screenshots', title: 'Screenshot links', detail: 'Screenshots stay in uier behind protected links. They are not uploaded to GitHub.' },
            { key: 'two-way-status', title: 'Two-way status sync', detail: 'Closing or reopening the issue in GitHub marks the feedback Done or Open in uier.', optional: true },
            { key: 'reply-sync', title: 'Reply sync', detail: 'New issue comments come back to the uier thread. Edit or delete the original to update its copies.', optional: true },
            { key: 'backfill', title: 'Backfill', detail: 'Add up to 1,000 existing shared threads when you are ready. Nothing older is copied until you ask.' }
        ],
        settings: [
            { name: 'Repository', detail: 'A repository the GitHub App can reach and you administer. A public repository needs an explicit confirmation.', required: true },
            twoWayStatusSetting,
            replySyncSetting,
            { name: 'Sync on or off', detail: 'Pause delivery without disconnecting. Existing issues stay.' }
        ],
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, then Integrations, and choose Connect on GitHub.',
            'Install uier for GitHub on selected repositories, then authorize your GitHub account. You need administration rights for the repository you choose.',
            'Load repositories, choose one and save. Public repositories require an explicit confirmation. Use Backfill GitHub feedback to include up to 1,000 existing shared threads.'
        ],
        access: 'Issues read and write, and repository metadata read. Customers choose which repositories the app can access. uier does not request source code, pull requests or Actions access.',
        limits: 'Changes sync in the background. Comments people write in GitHub stay with GitHub unless reply sync is on. Attachments and reactions are not synced.',
        removal: 'Making a thread private or deleting it queues cleanup of reachable managed issues and comments. GitHub history and notifications can remain. Disconnect keeps existing copies; uninstall the app in GitHub to revoke its wider access.'
    },
    linear: {
        name: 'Linear',
        title: 'Website feedback in Linear',
        description: 'Turn shared website feedback into issues in your Linear team.',
        result: 'One issue per feedback thread',
        detail: 'uier creates an issue for each shared feedback thread, mirrors its discussion and updates its state. Choose a team, optional project, open and done states, and existing labels.',
        features: [
            { key: 'items', title: 'An issue for each thread', detail: 'Each shared feedback thread becomes an issue in the team you choose, with its text, page context and a link back to uier.' },
            { key: 'discussion', title: 'Discussion', detail: 'Replies in uier are added as issue comments and kept current. Comments and labels people add in Linear are kept.' },
            { key: 'status', title: 'Workflow states', detail: 'Open and Done in uier move the issue to the open and done states you choose.' },
            { key: 'screenshots', title: 'Screenshots', detail: 'Upload the saved screenshot to the issue, or keep a protected link to it in uier.', optional: true },
            { key: 'two-way-status', title: 'Two-way status sync', detail: 'Completing, canceling or reopening the issue in Linear marks the feedback Done or Open in uier.', optional: true },
            { key: 'reply-sync', title: 'Reply sync', detail: 'New issue comments come back to the uier thread. Edit or delete the original to update its copies.', optional: true },
            { key: 'backfill', title: 'Backfill', detail: 'Add up to 1,000 existing shared threads when you are ready. Nothing older is copied until you ask.' }
        ],
        settings: [
            { name: 'Team', detail: 'A team the uier app can reach in your Linear workspace.', required: true },
            { name: 'Open and done states', detail: 'An open workflow state and a completed or canceled one.', required: true },
            { name: 'Linear project', detail: 'Optional. Issues are added to this project.' },
            { name: 'Labels', detail: 'Up to 20 existing labels for uier issues. Other labels on the issues are kept.' },
            { name: 'Include screenshots', detail: 'Uploads the current screenshot to Linear. When off, the issue links to it in uier.' },
            twoWayStatusSetting,
            replySyncSetting,
            { name: 'Sync on or off', detail: 'Pause delivery without disconnecting. Existing issues stay.' }
        ],
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, then Integrations, and choose Connect on Linear.',
            'Authorize the uier app in Linear, then choose the destination team and your open and done states. You can also choose a project and existing labels.',
            'Choose whether screenshots may be uploaded and save. New shared feedback will sync in the background. Use Backfill existing feedback to include up to 1,000 existing shared threads.'
        ],
        access: 'Read and write access as the uier app actor. uier does not request administration, agent, assignable or mentionable capabilities.',
        limits: 'Changes sync in the background. Changing the team or project starts new issues; existing issues stay where they are. Attachments and reactions are not synced.',
        removal: 'Making a thread private or deleting it queues cleanup of reachable managed issues and comments. Linear history and retained files can remain. Disconnect keeps existing copies; remove the app in Linear to revoke its access.'
    },
    'azure-devops': {
        name: 'Azure DevOps',
        title: 'Website feedback in Azure Boards',
        description: 'Turn shared website feedback into work items in your Azure DevOps project.',
        result: 'One work item per feedback thread',
        detail: 'uier creates a work item for each shared feedback thread in the project and area you choose. It keeps the description and discussion up to date and sets your open or done state when the feedback’s status changes.',
        features: [
            { key: 'items', title: 'A work item for each thread', detail: 'Each shared feedback thread becomes a work item in the project and area you choose, with its text, page context and a link back to uier.' },
            { key: 'discussion', title: 'Discussion', detail: 'The work item’s text keeps the feedback, its page context and the uier discussion up to date.' },
            { key: 'status', title: 'States', detail: 'Open and Done in uier set the states you choose. Moves on your board are kept until the uier status changes.' },
            { key: 'screenshots', title: 'Screenshot links', detail: 'Screenshots stay in uier behind protected links. They are not uploaded to Azure DevOps.' },
            { key: 'two-way-status', title: 'Two-way status sync', detail: 'Resolving, completing or reopening the work item marks the feedback Done or Open in uier.', optional: true },
            { key: 'reply-sync', title: 'Reply sync', detail: 'New replies in uier become work item comments, and new work item comments come back to the thread. Edit or delete the original to update its copies.', optional: true },
            { key: 'backfill', title: 'Backfill', detail: 'Add up to 1,000 existing shared threads when you are ready. Nothing older is copied until you ask.' }
        ],
        settings: [
            { name: 'Organization and project', detail: 'An Azure DevOps organization and project your work or school account can reach.', required: true },
            { name: 'Work item type', detail: 'A type on the project’s boards, such as Issue, Bug or User Story.', required: true },
            { name: 'Open and done states', detail: 'A proposed or in progress state, and a resolved or completed one, of that type.', required: true },
            { name: 'Area path', detail: 'Optional. A team’s board shows work items in its own area paths.' },
            twoWayStatusSetting,
            replySyncSetting,
            { name: 'Sync on or off', detail: 'Pause delivery without disconnecting. Existing work items stay.' }
        ],
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, then Integrations, and choose Connect on Azure DevOps.',
            'Sign in with your Microsoft work or school account and allow uier to read your profile and read and write work items.',
            'Load your organizations and projects, choose a work item type, its open and done states and an optional area path, then save. Use Backfill existing feedback to include up to 1,000 existing shared threads.'
        ],
        access: 'Work items (read and write) and user profile (read), delegated through Microsoft Entra ID. uier acts as the account that connects and can reach only what that account can. It does not request code, pipelines or administration access.',
        limits: 'Changes sync in the background. Changing the organization, project or type starts new work items; existing ones stay where they are. Personal Microsoft accounts are not supported.',
        removal: 'Making a thread private or deleting it replaces the work item’s text and moves it to the project’s recycle bin. Azure DevOps keeps earlier revisions in the work item history. Disconnect keeps existing work items; remove uier from your Microsoft account’s apps to revoke its access.'
    },
    slack: {
        name: 'Slack',
        title: 'Website feedback notifications in Slack',
        description: 'Send shared website feedback and change summaries to a Slack channel.',
        result: 'A channel message with context',
        detail: 'uier posts a bounded excerpt and a link for each new shared feedback thread. It updates the root message and can add summaries of replies and status changes. Optional reply sync copies new replies into the Slack thread and back to uier.',
        features: [
            { key: 'items', title: 'A message for each thread', detail: 'Each new shared feedback thread posts a short excerpt and a link to one channel. uier keeps that message current.' },
            { key: 'summaries', title: 'Reply and status summaries', detail: 'A short reply count or the current status, posted in the Slack thread. Choose either or both.', optional: true },
            { key: 'screenshots', title: 'Screenshots stay in uier', detail: 'Screenshot files are not copied to Slack. The message links to the thread in uier.' },
            { key: 'reply-sync', title: 'Reply sync', detail: 'New replies are copied into the Slack thread, and replies there come back to uier. Edit or delete the original to update its copies.', optional: true },
            { key: 'backfill', title: 'Backfill', detail: 'Existing feedback stays silent. Send up to 100 existing shared threads only if you ask.' }
        ],
        settings: [
            { name: 'Channel', detail: 'A public or private channel the uier app has been invited to. Direct messages and Slack Connect channels are excluded.', required: true },
            { name: 'Notify about new replies', detail: 'Off by default. Sends a short reply count in the Slack thread.' },
            { name: 'Notify about status changes', detail: 'Off by default. Sends the current open or done status in the Slack thread.' },
            { ...replySyncSetting, detail: `${replySyncSetting.detail} Slack asks you to allow reading replies first.` },
            { name: 'Test notification', detail: 'Sends a message to the channel to check the connection.' },
            { name: 'Notifications on or off', detail: 'Pause notifications without disconnecting. Existing messages stay.' }
        ],
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, then Integrations, and choose Connect on Slack.',
            'Authorize the uier app in your Slack workspace and invite it to the channel you want to use.',
            'Load channels, choose a channel and save. Select which changes should produce summaries. Existing feedback is silent unless you explicitly request a backfill.'
        ],
        access: 'Send messages and list accessible public and private channels: chat:write, channels:read and groups:read. Optional reply sync requests channels:history and groups:history through an explicit reconnect. No user tokens or auto-join permission are requested.',
        limits: 'Notifications can combine changes between background runs. Edits and deleted replies do not create alerts. Imported replies are read-only in uier. Public unlisted distribution is enabled; the app is not listed in Slack Marketplace.',
        removal: 'Making a thread private or deleting it queues removal of reachable managed messages. Delivered notifications and Slack retention can remain. Disconnect keeps existing messages; remove the app in Slack to revoke channel access.'
    }
};

export type IntegrationCatalogKey = IntegrationProviderId;

export function isIntegrationCatalogKey(value: string): value is IntegrationCatalogKey {
    return Object.hasOwn(integrationCatalog, value);
}
