/** Public setup and listing copy. Keep capabilities aligned with each provider adapter. */
export const integrationCatalog = {
    notion: {
        name: 'Notion',
        title: 'Website feedback in Notion',
        description: 'Turn shared website feedback into pages in your Notion database.',
        result: 'One page per feedback thread',
        detail: 'uier creates a page for each shared feedback thread, then updates its text, discussion and page context in the background. Saved screenshots can be uploaded to Notion.',
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, find Notion and choose Connect Notion.',
            'Choose your Notion workspace and share the destination database with the uier connection. The database needs a title property and a separate rich text property for the uier id.',
            'Choose the database, map those properties and save. New shared feedback will sync in the background. Use Backfill existing feedback to include up to 1,000 existing shared threads.'
        ],
        access: 'Read, insert and update content in the pages and databases you share with the connection. uier does not request Notion comments or user information.',
        limits: 'This is a one-way copy from uier. Changes in Notion do not update the original feedback. Optional database properties are copied only when their mapping is compatible.',
        removal: 'Making a thread private or deleting it queues cleanup of reachable managed copies. Notion history and retained files can remain. Disconnect stops future sync and keeps existing copies; remove the connection in Notion to revoke its access.'
    },
    github: {
        name: 'GitHub',
        title: 'Website feedback in GitHub',
        description: 'Keep shared website feedback and its discussion together in GitHub issues.',
        result: 'One issue per feedback thread',
        detail: 'uier creates an issue for each shared feedback thread in your chosen repository. It updates the issue, mirrors the discussion and closes or reopens it as the uier status changes.',
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, find GitHub and choose Connect GitHub.',
            'Install uier for GitHub on selected repositories, then authorize your GitHub account. You need administration rights for the repository you choose.',
            'Load repositories, choose one and save. Public repositories require an explicit confirmation. Use Backfill GitHub feedback to include up to 1,000 existing shared threads.'
        ],
        access: 'Issues read and write, and repository metadata read. Customers choose which repositories the app can access. uier does not request source code, pull requests or Actions access.',
        limits: 'This is a one-way copy from uier. GitHub changes do not update the original feedback. Screenshots stay behind protected links to uier rather than being uploaded to GitHub.',
        removal: 'Making a thread private or deleting it queues cleanup of reachable managed issues and comments. GitHub history and notifications can remain. Disconnect keeps existing copies; uninstall the app in GitHub to revoke its wider access.'
    },
    linear: {
        name: 'Linear',
        title: 'Website feedback in Linear',
        description: 'Turn shared website feedback into issues in your Linear team.',
        result: 'One issue per feedback thread',
        detail: 'uier creates an issue for each shared feedback thread, mirrors its discussion and updates its state. Choose a team, optional project, open and done states, and existing labels.',
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, find Linear and choose Connect Linear.',
            'Authorize the uier app in Linear, then choose the destination team and your open and done states. You can also choose a project and existing labels.',
            'Choose whether screenshots may be uploaded and save. New shared feedback will sync in the background. Use Backfill existing feedback to include up to 1,000 existing shared threads.'
        ],
        access: 'Read and write access as the uier app actor. uier does not request administration, agent, assignable or mentionable capabilities.',
        limits: 'This is a one-way copy from uier. Linear changes do not update the original feedback. Screenshot uploads are optional; when off, the issue keeps a protected link to the screenshot in uier.',
        removal: 'Making a thread private or deleting it queues cleanup of reachable managed issues and comments. Linear history and retained files can remain. Disconnect keeps existing copies; remove the app in Linear to revoke its access.'
    },
    'azure-devops': {
        name: 'Azure DevOps',
        title: 'Website feedback in Azure Boards',
        description: 'Turn shared website feedback into work items in your Azure DevOps project.',
        result: 'One work item per feedback thread',
        detail: 'uier creates a work item for each shared feedback thread in the project and area you choose. It keeps the description and discussion up to date and sets your open or done state when the feedback’s status changes.',
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, find Azure DevOps and choose Connect Azure DevOps.',
            'Sign in with your Microsoft work or school account and allow uier to read your profile and read and write work items.',
            'Load your organizations and projects, choose a work item type, its open and done states and an optional area path, then save. Use Backfill existing feedback to include up to 1,000 existing shared threads.'
        ],
        access: 'Work items (read and write) and user profile (read), delegated through Microsoft Entra ID. uier acts as the account that connects and can reach only what that account can. It does not request code, pipelines or administration access.',
        limits: 'This is a one-way copy from uier. Changes in Azure DevOps do not update the original feedback. Screenshots stay behind protected links to uier. Personal Microsoft accounts are not supported.',
        removal: 'Making a thread private or deleting it replaces the work item’s text and moves it to the project’s recycle bin. Azure DevOps keeps earlier revisions in the work item history. Disconnect keeps existing work items; remove uier from your Microsoft account’s apps to revoke its access.'
    },
    slack: {
        name: 'Slack',
        title: 'Website feedback notifications in Slack',
        description: 'Send shared website feedback and change summaries to a Slack channel.',
        result: 'A channel message with context',
        detail: 'uier posts a bounded excerpt and a link for each new shared feedback thread. It updates the root message and can add summaries of replies and status changes. Open uier for the full discussion.',
        steps: [
            'Sign in to uier, open or create a project and add its toolbar to your website.',
            'As a uier workspace admin, open the project’s Settings, find Slack and choose Connect Slack.',
            'Authorize the uier app in your Slack workspace and invite it to the channel you want to use.',
            'Load channels, choose a channel and save. Select which changes should produce summaries. Existing feedback is silent unless you explicitly request a backfill.'
        ],
        access: 'Send messages and list accessible public and private channels: chat:write, channels:read and groups:read. uier does not request message history, user tokens or permission to join channels automatically.',
        limits: 'Notifications can combine changes between background runs. Full discussions and screenshot files are not copied to Slack. Replies written in Slack stay in Slack. Public unlisted distribution is enabled; the app is not listed in Slack Marketplace.',
        removal: 'Making a thread private or deleting it queues removal of reachable managed messages. Delivered notifications and Slack retention can remain. Disconnect keeps existing messages; remove the app in Slack to revoke channel access.'
    }
} as const;

export type IntegrationCatalogKey = keyof typeof integrationCatalog;

export function isIntegrationCatalogKey(value: string): value is IntegrationCatalogKey {
    return Object.hasOwn(integrationCatalog, value);
}
